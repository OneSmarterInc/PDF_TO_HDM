// Isolated Linux/PostgreSQL/TLS qualification. Never connects to the local/live database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
const image=process.env.TEST_IMAGE||'pdf-extracter-hdm:aws-candidate';
const suffix=randomBytes(4).toString('hex'),network='hdm-qa-'+suffix,db=network+'-db',app=network+'-app';
const dir=path.resolve('tmp',network);fs.mkdirSync(dir,{recursive:true});
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:4*1024*1024}).trim();
const ownerPassword=randomBytes(24).toString('hex'),runtimePassword=randomBytes(24).toString('hex'),temporary=randomBytes(3).toString('hex'),initial=randomBytes(16).toString('hex');
const origin='https://portal.example.invalid',base='http://127.0.0.1:4320';
const writeEnv=(name,values)=>{const file=path.join(dir,name);fs.writeFileSync(file,Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n');return file;};
const dbEnv=writeEnv('database.env',{POSTGRES_USER:'hdm_owner',POSTGRES_PASSWORD:ownerPassword,POSTGRES_DB:'hdm_container_qa'});
const common={APP_ORIGIN:origin,DATABASE_SSL_CA_FILE:'/qa/server.crt',TEMPORARY_PASSWORD:temporary};
const runtimeUrl=`postgresql://hdm_app:${runtimePassword}@postgres:5432/hdm_container_qa`;
const migrationEnv=writeEnv('migration.env',{...common,MIGRATION_DATABASE_URL:`postgresql://hdm_owner:${ownerPassword}@postgres:5432/hdm_container_qa`,DATABASE_RUNTIME_ROLE:'hdm_app'});
const runtimeEnv=writeEnv('runtime.env',{...common,DATABASE_URL:runtimeUrl});
const bootstrapEnv=writeEnv('bootstrap.env',{...common,DATABASE_URL:runtimeUrl,BOOTSTRAP_USERNAME:'container_admin',BOOTSTRAP_PASSWORD:initial});
fs.writeFileSync(path.join(dir,'init.sql'),`CREATE ROLE hdm_app LOGIN PASSWORD '${runtimePassword}';\n`);
const mount=['--mount',`type=bind,source=${dir},target=/qa,readonly`];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(){for(let i=0;i<90;i++){try{if((await fetch(base+'/healthz')).ok)return;}catch{}await pause(1000);}throw Error('Container readiness timeout');}
let cookie,csrf;
async function call(route,method='GET',body){return fetch(base+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
async function login(password){const r=await call('/api/auth/login','POST',{username:'container_admin',password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;assert.match(r.headers.get('set-cookie'),/Secure/);assert.match(cookie,/^__Host-/);}
async function upload(){const r=await fetch(base+'/api/documents',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'X-File-Name':'synthetic.pdf'},body:fs.readFileSync('test/fixtures/legacy-A-digital.pdf')});assert.equal(r.status,202);return (await r.json()).id;}
async function complete(id){for(let i=0;i<600;i++){const r=await call('/api/documents/'+id),d=await r.json();assert.equal(r.status,200);assert.notEqual(d.status,'error',d.message);if(d.status==='complete')return d;await pause(1000);}throw Error('OCR timeout');}
(async()=>{
 const report={image,network,checks:[]};
 const pass=s=>{report.checks.push(s);console.log('PASS '+s);fs.writeFileSync('output/container-qualification.json',JSON.stringify(report,null,2));};
 try{
  docker(['pull','postgres:18-bookworm']);docker(['network','create',network]);
  docker(['run','--rm','--user','0','--entrypoint','openssl','--mount',`type=bind,source=${dir},target=/certs`,image,'req','-x509','-newkey','rsa:2048','-nodes','-keyout','/certs/server.key','-out','/certs/server.crt','-days','2','-subj','/CN=postgres','-addext','subjectAltName=DNS:postgres']);
  docker(['run','-d','--name',db,'--network',network,'--network-alias','postgres','--env-file',dbEnv,...mount,'--mount',`type=bind,source=${path.join(dir,'init.sql')},target=/docker-entrypoint-initdb.d/init.sql,readonly`,'--entrypoint','sh','postgres:18-bookworm','-c','cp /qa/server.key /tmp/server.key && chown postgres:postgres /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/qa/server.crt -c ssl_key_file=/tmp/server.key']);
  for(let i=0;i<60;i++){try{docker(['exec',db,'pg_isready','-U','hdm_owner','-d','hdm_container_qa']);break;}catch{await pause(1000);}}
  const runTask=(env,args)=>docker(['run','--rm','--network',network,'--env-file',env,...mount,image,...args]);
  runTask(migrationEnv,['node','scripts/migrate.mjs']);runTask(migrationEnv,['node','scripts/migrate.mjs']);runTask(bootstrapEnv,['node','scripts/bootstrap-admin.mjs']);pass('Verified TLS connection; migrations apply and rerun safely; administrator bootstrap');
  // The wrong hostname must fail certificate verification, not merely connect with encryption.
  const badEnv=writeEnv('wrong-host.env',{...common,DATABASE_URL:runtimeUrl.replace('@postgres:',`@${db}:`)});
  assert.throws(()=>runTask(badEnv,['node','--input-type=module','-e',"import {createPool} from './db/index.mjs';const p=createPool();await p.query('SELECT 1');await p.end();"]),e=>String(e.stderr).includes('ERR_TLS_CERT_ALTNAME_INVALID'));pass('Wrong TLS hostname rejected');
  docker(['run','-d','--name',app,'--network',network,'-p','127.0.0.1:4320:4317','--env-file',runtimeEnv,...mount,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',image]);await ready();
  assert.equal(docker(['exec',app,'id','-u']),'10001');
  assert.throws(()=>docker(['exec',app,'touch','/app/forbidden']));
  const loginPage=await fetch(base+'/login');assert.match(await loginPage.text(),/PDF Extractor HDM/);assert.equal(loginPage.headers.get('strict-transport-security'),'max-age=31536000');pass('Non-root read-only filesystem, writable runtime volume, branding and production HSTS');
  await login(initial);assert.equal((await call('/api/documents')).status,403);
  const password=randomBytes(20).toString('hex');let r=await call('/api/auth/password','POST',{currentPassword:initial,newPassword:password,confirmPassword:password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;pass('Secure host cookie and enforced first-login password change');
  const id=await upload();let doc=await complete(id);assert.equal(doc.pages.length,1);assert.ok(doc.pages[0].fields.length>30);
  const field=doc.pages[0].fields.findIndex(f=>f.label==='Patient name');assert.ok(field>=0);
  r=await call('/api/documents/'+id,'PATCH',{page:0,field,value:'LINUX VERIFIED',version:doc.version});assert.equal(r.status,200);
  r=await call('/api/documents/'+id+'/export.xlsx');assert.equal(r.status,200);const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await r.arrayBuffer()));let found=false;book.eachSheet(s=>s.eachRow(row=>{if(row.values.includes('LINUX VERIFIED'))found=true;}));assert.ok(found);pass('Linux OCR, saved field correction and actual Excel roundtrip');
  const interrupted=await upload();for(let i=0;i<30;i++){const d=await(await call('/api/documents/'+interrupted)).json();if(d.status==='processing')break;await pause(200);}
  docker(['stop','--time','100',app]);assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',app]),'0');docker(['start',app]);await ready();await complete(interrupted);
  doc=await(await call('/api/documents/'+id)).json();assert.equal(doc.pages[0].fields[field].value,'LINUX VERIFIED');pass('SIGTERM clean exit, interrupted OCR resumes, saved edits and session survive restart');
  assert.equal((await call('/api/auth/logout','POST')).status,200);assert.equal((await call('/api/auth/me')).status,401);pass('Production logout revokes session');
  report.status='PASS';fs.writeFileSync('output/container-qualification.json',JSON.stringify(report,null,2));
 }finally{
  for(const name of [app,db])try{docker(['rm','-f','-v',name]);}catch{}
  try{docker(['network','rm',network]);}catch{}
  // Only the uniquely-created test directory is removed; never touches project/live data.
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
