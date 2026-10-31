import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://127.0.0.1:4317';
try{
 const health=await fetch(base+'/healthz',{signal:AbortSignal.timeout(5000)});assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
 const login=await fetch(base+'/login');assert.equal(login.status,200);assert.match(await login.text(),/PDF Extractor HDM/);
 for(const path of ['/app.js','/portal.css','/session.js','/password-visibility.js','/icons/pencil.svg','/icons/check.svg','/icons/eye.svg','/icons/eye-off.svg'])assert.equal((await fetch(base+path)).status,200,'Asset unavailable: '+path);
 assert.equal((await fetch(base+'/api/documents')).status,401);assert.equal((await fetch(base+'/admin',{redirect:'manual'})).status,302);
 for(const name of ['Completed claim.pdf','Scanned claim.pdf','Blank claim.pdf'])assert.ok((await fs.stat('demo-samples/'+name)).size>0);
 console.log('PASS: live portal/database health, login, required assets, protected routes and demo PDFs.');
 console.log('Open '+base+'. Use your current administrator password; this check does not test credentials or change data.');
}catch(error){console.error('Demo preflight failed: '+error.message);console.error('Start the portal with start.cmd, then run npm run demo:check again.');process.exitCode=1;}
