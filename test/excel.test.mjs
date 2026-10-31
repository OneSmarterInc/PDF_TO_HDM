import test from 'node:test';
import assert from 'node:assert/strict';
import {money,formVersion,buildExportData} from '../excel-data.mjs';
test('never guesses ambiguous amounts or changes zero to missing',()=>{
  assert.equal(money('116400'),null);assert.equal(money('200 00'),200);assert.equal(money('0.00'),0);assert.equal(money('$1,164.00'),1164);assert.equal(money(') | 8 177 60'),null);
});
test('keeps reserved box 30 separate from legacy balance due',()=>{
  const fields=[{label:'Box 30 value (reserved)',value:'22.40',group:'Financial',confidence:80}];
  const doc={name:'forms.pdf',includeRaw:true,pages:[{number:1,type:'Professional claim',text:'FORM 1500 (02-12)',fields},{number:2,type:'Professional claim',text:'FORM CMS-1500 (08-05)',fields}]};
  assert.equal(formVersion(doc.pages[0]),'02/12');assert.equal(formVersion(doc.pages[1]),'08/05');
  const claims=buildExportData(doc)[0];const balance=claims.headers.findIndex(h=>h.startsWith('Balance due'));const reserved=claims.headers.findIndex(h=>h.startsWith('Reserved box'));
  assert.equal(claims.rows[0][balance],null);assert.equal(claims.rows[0][reserved],'22.40');assert.equal(claims.rows[1][balance],22.4);assert.equal(claims.rows[1][reserved],'');
});
test('exports reviewed values, original OCR, identifiers and full page notes',()=>{
  const doc={name:'test.pdf',includeRaw:true,pages:[{number:1,type:'Professional claim',text:'FORM 1500 (02-12)\nUnmapped note',fields:[{group:'Identifiers',label:'Patient account',value:'001234567890123456',originalValue:'bad OCR',reviewed:true,confidence:50}]}]};
  const result=buildExportData(doc);const claims=result[0];assert.equal(claims.rows[0][claims.headers.indexOf('Patient account number (26)')],'001234567890123456');
  assert.equal(result.find(s=>s.name==='Field review').rows[0][6],'bad OCR');assert.equal(result.find(s=>s.name==='Field review').rows[0][7],'Reviewed by user');
  assert.ok(result.find(s=>s.name==='Page text').rows.some(r=>r.includes('Unmapped note')));
});

test('simple export removes decoration columns and raw text while keeping useful data',()=>{
 const d={name:'claim.pdf',pages:[{number:1,type:'Professional claim',text:'FORM 1500 (02-12)',fields:[{label:'Patient account',value:'0012345'},{label:'Total charge',value:'200.00'},{label:'Billing provider NPI',value:'1225745573'}],serviceLines:[]}]};
 const sheets=buildExportData(d),c=sheets[0];
 assert.deepEqual(sheets.map(s=>s.name),['Claims']);
 assert.ok(!c.headers.includes('Source PDF'));assert.ok(!c.headers.includes('Review status'));
 assert.equal(c.rows[0][c.headers.indexOf('Patient account number')],'0012345');
 assert.equal(c.rows[0][c.headers.indexOf('Billing provider NPI')],'1225745573');
});
test('exports separate check and claim payments, additional fields and all hospital service columns',()=>{
 const fields=[{group:'Claim payment totals',label:'Provider paid',value:'87.80'},{group:'Statement totals',label:'Check amount',value:'193.70'},{group:'Payment details',label:'Check / EFT number',value:'001234567'},{group:'Adjustment 1',label:'Adjustment code',value:'CO-94'},{group:'Adjustment 1',label:'Adjustment amount',value:'-185.41'}];
 const doc={name:'claims.pdf',pages:[{number:2,type:'Payment explanation',fields},{number:3,type:'Hospital claim',fields:[{group:'Admission',label:'Type of bill',value:'0131'}],serviceLines:[{line:1,values:['04/08/2026','','','','36415','PO','','17.00','1','','',''],revenueCode:'0300',description:'Laboratory',nonCovered:'0.00'}]}]};
 const result=buildExportData(doc),p=result.find(s=>s.name==='Payments'),s=result.find(s=>s.name==='Service lines');
 assert.equal(p.rows[0][p.headers.indexOf('Check amount (USD)')],193.7);
 assert.equal(p.rows[0][p.headers.indexOf('Provider paid (USD)')],87.8);
 assert.equal(p.rows[0][p.headers.indexOf('Check / EFT number')],'001234567');
 assert.equal(s.rows[0][s.headers.indexOf('Non-covered charges (USD)')],0);
 assert.equal(s.rows[0][s.headers.indexOf('Service description')],'Laboratory');
 assert.equal(result.find(s=>s.name==='Adjustments').rows[0][3],-185.41);
});
