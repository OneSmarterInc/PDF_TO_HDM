# PDF Extractor HDM

A document-processing portal for uploading PDFs, reviewing automatically extracted information beside the original document, and exporting saved corrections to Excel, JSON or text.

**AWS handoff status:** functional tests pass, but public production deployment is blocked by unresolved container OS vulnerability findings. Read [AWS readiness and test report](docs/AWS_READINESS_REPORT.md) before deployment. The repository does not contain production credentials or client documents.

## AWS team: start here

- [AWS deployment runbook](docs/AWS_DEPLOYMENT.md): network, RDS, secrets, migrations, administrator initialization, deployment and rollback.
- [CloudFormation template](deploy/aws-cloudformation.json): private single-task Fargate service and HTTPS load balancer. Desired count defaults to zero until preparation is complete.
- [Database design](docs/DATABASE_DESIGN.md): schemas, roles, migration and backup procedures.
- [General setup](docs/DEPLOYMENT.md): runtime configuration and local operation.

Build the Linux candidate from the repository root:

```sh
docker build --platform linux/amd64 -t pdf-extractor-hdm:staging .
```

The English OCR model is included for reproducible offline processing. Dependencies are installed during image build. No secrets are baked into the image; supply them through your deployment environment/Secrets Manager. Keep exactly one OCR application instance per database. This candidate is not approved for public production until the documented security and AWS staging gates are satisfied.

## Local setup

Use Node.js 24+, Python 3.12 and a dedicated PostgreSQL database. Install JavaScript dependencies with `npm ci`; create a Python virtual environment and install `requirements.lock.txt`. Configure `.env` from `.env.example` and a separate `.env.migration` from its example. Provision distinct migration/runtime database roles, run `npm run db:migrate`, then initialize the first administrator with `npm run admin:init` and operator-provided bootstrap credentials. See the deployment guide for complete instructions. Run `npm start` after configuration.

`start.cmd` is a convenience launcher for the existing Windows development setup; a fresh clone does not include its local database, accounts or credentials. Never commit real environment files or database dumps.

## Features

- PDF preview and confirmation before processing; progress, cancellation and replacement uploads.
- Local OCR, checkbox reading, automatic verification and review of unclear fields.
- Original PDF beside editable forms; individual pencil controls, Edit all, save/discard and search.
- Saved corrections exported to readable Excel, JSON or text; persistent originals/results with configurable retention.
- Administrator and user authentication, mandatory first-login password change, role and document ownership enforcement.
- User management, searchable/paginated activity history and portal-owned confirmation dialogs.
- Durable queue and restart recovery. One OCR job runs at a time.

## Verification

```sh
npm test
npm run lint
npm run typecheck
npm run build
python -m unittest discover -s test -p 'test_*.py'
```

`node scripts/test-container.cjs` runs isolated Linux/PostgreSQL/TLS qualification using Docker. Set `TEST_IMAGE` to the image tag you built (the default is `pdf-extracter-hdm:aws-candidate`). It uses localhost port 4320 and disposable test containers.

Browser/infrastructure suites require an isolated `.env.qa`, QA accounts and port 4318. Some historical four-page regression scripts refer to the original developer's private sample path; that document is intentionally not committed. Synthetic fixtures under `test/fixtures` and `demo-samples` contain generated example data. OCR fixture assertions do not guarantee perfect extraction for every possible PDF.

[Implementation tracker](docs/IMPLEMENTATION_TRACKER.md) · [Project audit](docs/PROJECT_AUDIT.md) · [Historical implementation report](docs/FINAL_IMPLEMENTATION_REPORT.md)
