// Run explicitly against the local server: node scripts/validate-synthetic.mjs
// Expectations are fixture input values, never used by application extraction.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:4317';
const auth=process.env.TEST_AUTH_FILE?JSON.parse(await fs.readFile(process.env.TEST_AUTH_FILE,'utf8')):null;
const fetch=(url,options={})=>globalThis.fetch(url,{...options,headers:{...options.headers,...(auth?{Cookie:auth.adminCookie,Origin:base,'X-CSRF-Token':auth.csrf}:{})}});
const expected=JSON.parse(await fs.readFile('test/fixtures/expected.json','utf8'));
await fs.mkdir('output/synthetic-validation',{recursive:true});
const results=process.argv.slice(2).length?await fs.readFile('output/synthetic-validation/report.json','utf8').then(JSON.parse).catch(()=>[]):[];
for(const name of process.argv.slice(2).length?process.argv.slice(2):['legacy-A-digital','legacy-B-digital','legacy-B-scan','legacy-B-skew','legacy-blank']){
 const response=await fetch(base+'/api/documents',{method:'POST',headers:{'x-file-name':name+'.pdf'},body:await fs.readFile('test/fixtures/'+name+'.pdf')});
 assert.equal(response.status,202);const {id}=await response.json();let doc;
 const start=Date.now();
 do{await new Promise(r=>setTimeout(r,2000));doc=await (await fetch(base+'/api/documents/'+id)).json();if(Date.now()-start>600000)throw Error('Timed out: '+name);}while(!['complete','error'].includes(doc.status));
 assert.equal(doc.status,'complete',doc.message);assert.ok(!doc.reviewApplied,'Synthetic inputs must run fresh OCR');
 await fs.writeFile('output/synthetic-validation/'+name+'.json',JSON.stringify(doc,null,2));
 const fields=doc.pages[0].fields,checks=[];
 const key=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,'');
 const check=(group,label,want)=>{const found=fields.find(f=>f.group===group&&f.label===label);checks.push({group,label,expected:want,actual:found?.value||'',pass:key(found?.value||'')===key(want)});};
 if(name==='legacy-blank'){
   for(const f of fields)checks.push({group:f.group,label:f.label,expected:f.kind==='checkbox'?'None selected':'',actual:f.value,pass:f.kind==='checkbox'?f.value==='None selected':!f.value});
 }else{
 const c=expected[name.includes('-A-')?0:1];
 for(const [g,l,v] of [['Patient','Patient name',c.patient],['Patient','Date of birth',c.dob],['Patient','Address',c.address],['Patient','City',c.city],['Patient','State',c.state],['Patient','ZIP code',c.zip],['Insurance','Insured ID',c.id],['Insurance','Insured name',c.insured],['Identifiers','Tax ID',c.tax],['Identifiers','Patient account',c.account],['Financial','Total charge',c.total],['Financial','Amount paid on claim',c.paid],['Financial','Balance due',c.balance],['Providers','Service facility','SYNTHETIC CLINIC 10 TEST ROAD DENVER CO 80203'],['Providers','Service facility NPI',c.npi],['Providers','Billing provider NPI',c.npi],['Clinical','ICD-9 diagnosis 1',c.diagnoses[0]],['Clinical','ICD-9 diagnosis 2',c.diagnoses[1]]])check(g,l,v);
 const labels=['Service date from','Service date to','Place of service','CPT / HCPCS','Diagnosis pointer','Charge','Days / units'];
 c.lines.forEach((row,i)=>row.forEach((v,j)=>check('Service '+(i+1),labels[j],v)));
 const groups=['Insurance type','Patient sex','Relationship to insured','Employment-related','Auto accident','Other accident','Insured sex','Another health benefit plan','Outside laboratory','Tax ID type','Accept assignment'];
 const selections=c.checks.map((v,i)=>i>=3&&i!==9?v.split(' ').at(-1):v);
 groups.forEach((g,i)=>{
  check('Checkbox selections',g,selections[i]);
  const field=fields.find(f=>f.kind==='checkbox'&&f.label===g);
  for(const o of field?.options||[])checks.push({group:g,label:o.label,expected:o.label===selections[i]?'selected':'unselected',actual:o.state,pass:o.state===(o.label===selections[i]?'selected':'unselected')});
 });
 const allowed=new Set(checks.map(c=>c.group+'|'+c.label));
 for(const f of fields.filter(f=>f.kind!=='checkbox'&&f.value&&!allowed.has(f.group+'|'+f.label)))checks.push({group:f.group,label:f.label,expected:'',actual:f.value,pass:false});
 }
 const entry={name,id,seconds:Math.round((Date.now()-start)/1000),rotationDegrees:doc.pages[0].rotationDegrees||0,passed:checks.filter(c=>c.pass).length,total:checks.length,failures:checks.filter(c=>!c.pass),checks};const previous=results.findIndex(r=>r.name===name);if(previous>=0)results.splice(previous,1,entry);else results.push(entry);
 console.log(JSON.stringify({...entry,checks:undefined}));
 if(name==='legacy-A-digital'){
 const x=await fetch(base+'/api/documents/'+id+'/export.xlsx');assert.equal(x.status,200);await fs.writeFile('output/synthetic-validation/'+name+'.xlsx',Buffer.from(await x.arrayBuffer()));
 }
 await fs.writeFile('output/synthetic-validation/report.json',JSON.stringify(results,null,2));
}
if(results.some(r=>r.failures.length))process.exitCode=1;
