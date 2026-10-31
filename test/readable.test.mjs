import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReadableExportData} from '../excel-data.mjs';
import {applyCheckboxes} from '../accuracy.mjs';
import {savedReviewMatches} from '../review-cache.mjs';
test('deliberately cleared reviewed fields stay blank in Excel',()=>{
 const tables=buildReadableExportData({pages:[{number:1,fields:[{group:'Insurance',label:'Other insured',value:'',reviewed:true},{group:'Patient',label:'Name',value:'',reviewed:false}]}]});
 assert.equal(tables[0].rows[0][2],'');assert.equal(tables[0].rows[0][3],'Reviewed');assert.equal(tables[0].rows[1][2],'Needs review');
});
test('checkbox value No is distinct from an unselected option',()=>{
 const pages=[{number:1,fields:[]}],bbox={x0:0,y0:0,x1:20,y1:20};
 applyCheckboxes(pages,[{page:1,label:'Outside laboratory',options:[{label:'Yes',state:'unselected',bbox},{label:'No',state:'selected',bbox}]}]);
 assert.equal(pages[0].fields[0].value,'No');
 const tables=buildReadableExportData({pages});
 assert.deepEqual(tables.find(t=>t.name==='Checkboxes').rows.map(r=>r.slice(2)),[['Yes','No'],['No','Yes']]);
});
test('missing boxes and conflicting selections stay uncertain',()=>{
 for(const states of [['uncertain','unselected'],['selected','selected']]){
 const p={number:1,fields:[]},bbox={x0:0,y0:0,x1:20,y1:20};
 applyCheckboxes([p],[{page:1,label:'Question',options:states.map((state,i)=>({label:String(i),state,bbox}))}]);
 assert.equal(p.fields[0].value,'');assert.equal(p.fields[0].status,'uncertain');
 }
});
test('page sheets keep fields readable and preserve IDs and typed money',()=>{
 const doc={pages:[{number:1,fields:[{group:'Identifiers',label:'Patient account',value:'00123',reviewed:true},{group:'Financial',label:'Check amount',value:'0.00',reviewed:true}]}]};
 const t=buildReadableExportData(doc)[0];
 assert.deepEqual(t.headers,['Section','Field','Value','Status']);
 assert.equal(t.rows[0][2],'00123');assert.equal(t.rows[1][2],0);
 assert.equal(t.rows.length,2);assert.deepEqual(t.currencyRows,[1]);
});
test('saved manual review only applies to the identical PDF and matching page geometry',()=>{
 const pages=[{number:1,width:100,height:200}];
 const saved={sourceAudit:{sha256:'abc',fieldsChecked:1},pages:[{...pages[0],fields:[{value:'Verified',reviewed:true}]}]};
 assert.ok(savedReviewMatches(saved,'abc',pages));
 assert.equal(savedReviewMatches(saved,'different',pages),false);
 assert.equal(savedReviewMatches(saved,'abc',[{...pages[0],width:101}]),false);
 assert.equal(savedReviewMatches(saved,'abc',[{...pages[0],rotationDegrees:.8}]),false);
 assert.equal(savedReviewMatches({...saved,sourceAudit:{sha256:'abc',fieldsChecked:2}},'abc',pages),false);
});
