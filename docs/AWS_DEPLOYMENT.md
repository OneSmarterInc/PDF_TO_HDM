# PDF Extractor HDM — AWS deployment runbook

**Security gate:** the final remediated image has zero reported OS, Node.js or Python vulnerabilities, with no suppressions. See [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md) for qualification evidence. Repeat release checks on your image and complete the account-specific AWS staging checklist below before public deployment.

## Architecture and release boundary

Use the supplied Linux AMD64 Docker image, one ECS Fargate task (2 vCPU / 8 GiB initially), HTTPS Application Load Balancer, private RDS PostgreSQL, Secrets Manager and CloudWatch. PDFs, page images, results, sessions and audit events already persist in PostgreSQL; `.runtime` is disposable scratch space. No S3 migration or schema replacement is necessary for this release. Monitor RDS storage growth; large-scale document storage may warrant a separately tested S3 migration later.

The worker deliberately takes a database advisory lease. **Desired task count must remain 1.** Deployments use minimumHealthyPercent=0 / maximumPercent=100: stop the old task, then start its replacement. Expect a maintenance interruption. Do not enable autoscaling or blue/green overlapping workers without redesigning and testing that coordination. SIGTERM rejects new requests, drains HTTP work, checkpoints interrupted OCR as queued, and exits; restart reconstructs work from the original PDF in PostgreSQL. ECS allows 120 seconds; the application bounds shutdown to 90 seconds.

`deploy/aws-cloudformation.json` creates the ALB, HTTP→HTTPS redirect, target group, private ECS service, restricted ingress security groups, execution/task roles, retained logs and an unhealthy-target alarm. It uses an **existing VPC, two public subnets, private subnets, ACM certificate, RDS security group and runtime secret**. It does not create, replace or migrate your database. Deploying it incurs AWS charges; creating this file has not deployed resources.

## Before deployment

1. Select region, public hostname and ACM certificate. Provide public subnets in two availability zones and private subnets with NAT or the necessary ECR/S3/Secrets Manager/CloudWatch endpoints. RDS must be reachable privately from the task subnets. No public database or task IPs.
2. Create encrypted RDS PostgreSQL with backups, point-in-time recovery, deletion protection and appropriate Multi-AZ availability. Use a maintained engine version supported by your region. Require `rds.force_ssl=1`. Never point test scripts at this database.
3. Create a dedicated database owner/migration role and a distinct login-only runtime role. Create the application database owned by the migration role. Use independent randomly generated secrets; do not reuse local passwords. Run `node scripts/migrate.mjs` with MIGRATION_DATABASE_URL, DATABASE_RUNTIME_ROLE, DATABASE_SSL_MODE=verify-full and DATABASE_SSL_CA_FILE. The RDS admin should provision roles; the application must not use its credentials. Historical migrations remain unchanged/checksummed.
4. For an existing-data migration, first back up the source with `pg_dump --format=custom`; restore into a **new** RDS database using `pg_restore --no-owner`, then apply runtime grants with the migration script. Stop writes during the final cutover. Verify per-table counts, original PDF/page asset byte counts, edit/export samples and audit records before changing connections. Keep the original database untouched for rollback. Do not blindly import an entire QA database.
5. Store a JSON secret containing `DATABASE_URL` and `TEMPORARY_PASSWORD` in Secrets Manager. Use the AWS-managed secretsmanager key with the supplied execution policy; custom KMS keys require narrowly scoped kms:Decrypt permission. Encode reserved password characters in the PostgreSQL URL. Do not put SSL query parameters in the URL: `DATABASE_SSL_MODE=verify-full` and the RDS CA bundle explicitly enforce certificate and hostname validation. The image includes the AWS global RDS CA bundle fetched over verified HTTPS at build time. Rebuild periodically and before CA rotations.
6. Keep migration and bootstrap credentials separate from the web task. Initialize the administrator with a one-off task/operator invocation of `node scripts/bootstrap-admin.mjs` using runtime DATABASE_URL plus secret BOOTSTRAP_USERNAME / BOOTSTRAP_PASSWORD; it refuses to replace an existing administrator. In ECS, create a separate operator task definition using Secrets Manager references and narrowly scoped execution-role grants; do not paste credential values into CLI arguments or RunTask environment overrides that may be captured in audit records. Remove bootstrap secrets immediately afterwards. First login requires a change. Use approved private credential delivery. The existing user-requested minimum of 6 characters is preserved; production operators should choose longer randomly generated temporary and administrator passwords. A six-character minimum/shared temporary password remains a policy tradeoff, not a strong enterprise password standard.

## Build and deploy

From the project root:

```powershell
npm ci
npm test
npm run lint
npm run typecheck
npm run build
docker build --platform linux/amd64 -t pdf-extractor-hdm:release .
$env:TEST_IMAGE="pdf-extractor-hdm:release"
node scripts/scan-image.mjs pdf-extractor-hdm:release
$env:TEST_FULL_OCR='1'
node scripts/test-container.cjs
```

The container test defaults to the `pdf-extracter-hdm:aws-candidate` image; set TEST_IMAGE=pdf-extractor-hdm:release to test your release tag. It creates only uniquely named disposable Docker resources, generates temporary test secrets, and exercises PostgreSQL TLS, migrations, login, OCR, Excel and restart recovery. It publishes localhost port 4320, so keep that port free. Dependencies and the Tesseract model are packaged; OCR does not need a runtime model download. The runtime uses digest-pinned Wolfi with Node 24 and Python 3.12; installation-only pip tooling is removed after dependency validation. Full OCR mode adds digital/scanned/skewed/blank fixtures and Excel exports. The scan rejects incomplete inventories and high/critical findings without advisory suppressions. Repeat both checks for every release image.

Push the tested image to a private ECR repository with tag immutability and enhanced vulnerability scanning. Resolve its image digest. Use the digest (not a mutable tag) as ImageUri. Review the CloudFormation template and deploy through your normal change process with CAPABILITY_IAM and these parameters:

| Parameter | Value |
|---|---|
| VpcId / PublicSubnets / PrivateSubnets | Existing network IDs |
| CertificateArn | ACM certificate for the public hostname |
| ImageUri | ECR URI ending `@sha256:...` |
| AppOrigin | Exact `https://your-hostname`, without trailing slash |
| RuntimeSecretArn | JSON runtime secret ARN |
| DatabaseSecurityGroupId / DatabasePort | Private RDS group / 5432 normally |
| DesiredCount | 0 during preparation, 1 after migrations/bootstrap |
| DocumentRetentionHours | Approved retention policy; default 2 hours |

The stack adds database ingress **only from the task security group**. Review existing RDS ingress rules separately; this template cannot remove previously broad rules. It accepts task traffic only from the ALB. TRUST_PROXY=alb is safe only with that restriction and ALB XFF append mode, client-port forwarding disabled. The server uses the last appended IP for audit/rate limiting instead of a spoofable first entry. Do not expose the container port directly to the internet. The task role has no AWS data permissions; the execution role reads only the configured runtime secret in addition to standard ECR/log access.

Map your DNS alias to the ALB after staging checks. Secure cookies and CSRF checks use APP_ORIGIN; the raw ALB hostname will not support normal login unless configured as the public origin with a matching certificate. An RDS/database migration or bootstrap task may run with DesiredCount=0; enable the web service only after those operations complete. Restrict operator access to Secrets Manager and ECS task overrides.

## Mandatory staging acceptance

- Verify browser HTTPS certificate, HTTP redirect, Secure/HttpOnly/SameSite cookies, HSTS, CSRF rejection and admin/client access boundaries through the actual ALB.
- Run admin creation → temporary login → forced password change → normal use → deactivation; check atomic audit history.
- Upload digital, scanned, skewed, blank and original four-page samples. Confirm no processing before confirmation, cancellation/replacement, checkbox interpretation, side-by-side source, individual/Edit all, save/discard, Excel/text/JSON downloads and reload persistence. Use synthetic documents until privacy requirements are satisfied.
- Stop/redeploy a task during OCR; confirm the same document resumes and saved edits remain. Confirm duplicate tasks cannot acquire the OCR lease.
- Verify RDS reports encrypted TLS connections. Test an invalid CA/hostname is rejected. Rehearse restore into a separate database and compare rows/assets before accepting backup readiness.
- Check CloudWatch health, task memory, CPU, restarts, RDS storage and latency under realistic uploads. One OCR job at a time / three queued is the tested default, not a throughput promise. Configure notifications on the supplied alarm plus zero healthy targets, ECS missing tasks, RDS storage/CPU/connections, and error rates. A created alarm without notification actions is not an operational alerting setup.
- Configure WAF/rate controls appropriate to exposure, log access and retention, RDS backup retention and incident response. PDFs may contain personal/health data; validate organizational/legal requirements and applicable AWS agreements before using real client data. Do not log document text or credential values.

## Update, rollback and recovery

Keep the previous image digest and configuration. Back up RDS before schema changes. Deploy a new immutable image during a maintenance window; allow the old task to release its lease. If the task fails health checks, ECS circuit-breaker rollback restores the prior task definition (once a successful deployment exists). Never roll back by deleting data or editing historical migrations. Recover a database into a new instance/database and validate before switching secrets. Changing a Secrets Manager value does not update already-running task environments: redeploy after rotation.

No AWS staging run is claimed by local tests. Account IAM, ACM, DNS, VPC routes, actual RDS TLS, service quotas, ECR scan and operational alerts must be verified in the target AWS account before production sign-off.

References: [AWS ECS service deployment settings](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html), [RDS PostgreSQL TLS verification](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html).
