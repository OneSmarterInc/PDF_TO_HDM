import './qa-config.cjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4318',qa=JSON.parse(await fs.readFile('tmp/qa-account.json','utf8'));
const headers={Cookie:qa.adminCookie,Origin:base,'X-CSRF-Token':qa.csrf};
const upload=body=>fetch(base+'/api/documents',{method:'POST',headers:{...headers,'Content-Type':'application/pdf','X-File-Name':'synthetic-edge.pdf'},body});
for(const bytes of [Buffer.alloc(0),Buffer.from('plain text')])assert.equal((await upload(bytes)).status,400);
const oversized=Buffer.alloc(30*1024*1024+1);oversized.write('%PDF-1.7');assert.equal((await upload(oversized)).status,413);
for(const name of ['encrypted','too-many-pages','empty','corrupt']){
 const r=await upload(await fs.readFile('tmp/edge-fixtures/'+name+'.pdf'));assert.equal(r.status,202);const {id}=await r.json();let data;const deadline=Date.now()+240000;
 do{await new Promise(resolve=>setTimeout(resolve,500));const response=await fetch(base+'/api/documents/'+id,{headers});assert.equal(response.status,200);data=await response.json();assert.ok(Date.now()<deadline,'Failure must resolve, not remain processing');}while(!['complete','error'].includes(data.status));
 assert.equal(data.status,'error');if(name==='encrypted')assert.match(data.message,/password protected/i);if(name==='too-many-pages')assert.match(data.message,/30 pages/);
 assert.equal((await fetch(base+'/api/documents/'+id+'/export.xlsx',{headers})).status,409);
 assert.equal((await fetch(base+'/api/documents/'+id,{method:'DELETE',headers})).status,200);
 assert.equal((await fetch(base+'/api/documents/'+id,{headers})).status,404);
 console.log('PASS rejected input, error state, blocked export, deletion: '+name);
}
for(const path of ['/healthz','/jobs','/verify','/export'])assert.equal((await fetch('http://127.0.0.1:4320'+path)).status,403);
console.log('PASS empty/non-PDF/oversized upload rejection and unauthenticated private-worker rejection.');
const queued=[];
try{
 for(let i=0;i<3;i++){const response=await upload(await fs.readFile('test/fixtures/legacy-blank.pdf'));assert.equal(response.status,202);queued.push((await response.json()).id);}
 assert.equal((await upload(await fs.readFile('test/fixtures/legacy-blank.pdf'))).status,429);
 console.log('PASS queue capacity: three accepted jobs, fourth rejected without overbooking.');
}finally{for(const id of queued)assert.equal((await fetch(base+'/api/documents/'+id,{method:'DELETE',headers})).status,200);}
