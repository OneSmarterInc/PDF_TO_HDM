import './qa-config.cjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const qa=JSON.parse(await fs.readFile('tmp/qa-account.json','utf8')),info=JSON.parse(await fs.readFile('tmp/migration-document.json','utf8'));
const headers={Cookie:qa.adminCookie,Origin:'http://127.0.0.1:4318','X-CSRF-Token':qa.csrf,'Content-Type':'application/json'};
const url='http://127.0.0.1:4318/api/documents/'+info.id;let response=await fetch(url,{headers});assert.equal(response.status,200);let doc=await response.json();
const field=doc.pages[0].fields.findIndex(f=>f.label==='Patient name');response=await fetch(url,{method:'PATCH',headers,body:JSON.stringify({page:0,field,value:'QA SCREEN USER',version:doc.version})});assert.equal(response.status,200);
await fs.writeFile('tmp/flow-document.json',JSON.stringify(info));
console.log('Prepared isolated synthetic reader document for compatibility tests.');
