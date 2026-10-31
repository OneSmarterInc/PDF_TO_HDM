import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReading,chooseReading,validNpi,applyVerification,extractAccurate} from '../accuracy.mjs';
test('structured-value corroboration requires strong page and crop evidence and rejects competing readings',()=>{
 for(const [label,pageScore,zoomScore,independentText,independentScore,other,want] of [
 ['Charge',99,99,'125.50!',80,'',true],['Charge',97,99,'125.50',80,'',false],['Charge',99,89,'125.50',80,'',false],['Charge',99,99,'125.50',60,'',false],['Charge',99,99,'125.51',80,'',false],['Charge',99,99,'125.50',80,'125.51',false],['Patient name',99,99,'125.50',80,'',false]
 ]){const f={label,value:'125.50',status:'format-checked',sourceReadings:[{text:'125.50',confidence:pageScore},{text:other,confidence:99}],alternatives:['125.50',other]};applyVerification([{number:1,fields:[f],serviceLines:[],warnings:[]}],[{page:1,index:0,variants:[{text:'125.50',confidence:zoomScore}],independent:{text:independentText,confidence:independentScore}}]);assert.equal(f.ocrCorroborated,want);}
});
test('high-confidence independent close-up can corroborate the original neural page reading',()=>{
 const f={label:'Total charge',value:'200.75',status:'format-checked',sourceReadings:[{text:'200.75',confidence:99}],alternatives:['200.75','noise']};
 const p={number:1,fields:[f],serviceLines:[],warnings:[]};
 applyVerification([p],[{page:1,index:0,variants:[{text:'200.75|',confidence:88}],independent:{text:'200.75',confidence:96}}]);assert.equal(f.ocrCorroborated,true);
});
test('optional blank evidence requires no entered value, no valid reading, and no readable ink',()=>{
 for(const [value,ink,reading,confidence,want] of [['',true,'·',10,true],['',false,'',0,false],['401.9',true,'',0,false],['',true,'401.9',10,false],['',true,'AB',80,false]]){
  const f={label:'ICD-9 diagnosis 3',value,alternatives:['','']};
  applyVerification([{number:1,fields:[f],serviceLines:[],warnings:[]}],[{page:1,index:0,blankEvidence:ink,variants:[{text:reading,confidence}],independent:{text:'',confidence:0}}]);assert.equal(f.blankConfirmed,want);
 }
 const f={label:'Date of birth',value:'',alternatives:['','']};applyVerification([{number:1,fields:[f],serviceLines:[],warnings:[]}],[{page:1,index:0,blankEvidence:true,variants:[],independent:{text:'',confidence:0}}]);assert.equal(f.blankConfirmed,false);
});
test('normalizes real calendar dates and rejects impossible dates',()=>{
  assert.equal(normalizeReading('Date of birth','06 05 1959'),'06/05/1959');
  assert.equal(normalizeReading('Date of birth','02 31 1959'),'');
  assert.equal(normalizeReading('Service date from','04:13 26'),'04/13/26');
});
test('requires numeric and code formats instead of copying form labels',()=>{
  assert.equal(normalizeReading('Insured ID','1a. INSURED ID NUMBER'),'');
  assert.equal(normalizeReading('Tax ID','88380877I'),'');
  assert.equal(normalizeReading('CPT / HCPCS','99214.'),'99214');
  assert.equal(normalizeReading('CPT / HCPCS','PROCEDURES'),'');
  assert.equal(normalizeReading('Place of service','111 erm'),'');
  assert.equal(normalizeReading('Diagnosis C','C. L I10'),'I10');
  assert.equal(normalizeReading('Diagnosis A','U07.1'),'U07.1');
});
test('legacy cells discard border punctuation without changing data characters',()=>{
  assert.equal(normalizeReading('Charge','125.50!'),'125.50');
  assert.equal(normalizeReading('Charge','I 125.50!'),'125.50');
  assert.equal(normalizeReading('Charge','I25.50!'),'');
  assert.equal(normalizeReading('Insured name','MORGAN AVERY‘’丨'),'MORGAN AVERY');
  assert.equal(normalizeReading('State','co'),'CO');
  assert.equal(normalizeReading('State','(e{0]'),'');
  assert.equal(normalizeReading('ICD-9 diagnosis 1','V70.0'),'V70.0');
  assert.equal(normalizeReading('ICD-9 diagnosis 1','v70.0'),'V70.0');
  assert.equal(normalizeReading('ICD-9 diagnosis 1','401.9'),'401.9');
  assert.equal(normalizeReading('ICD-9 diagnosis 1','a'),'');
  assert.equal(normalizeReading('Balance due','0.00'),'0.00');
});
test('withholds unsupported forms instead of extracting their printed labels',()=>{
  const result=extractAccurate([],{}, {number:1,type:'Professional claim',text:'FORM CMS-1500 (08-05) SAMPLE',width:100,height:100});
  assert.equal(result.fields.length,0);assert.equal(result.serviceLines.length,0);assert.ok(result.warnings.length);
});
test('does not publish conflicting valid IDs even when both scores are high',()=>{
  const r=chooseReading('Insured ID',{text:'1234567890',confidence:99},{text:'1234567899',confidence:99});
  assert.equal(r.value,'');assert.equal(r.status,'uncertain');
});
test('checks the NPI checksum and preserves leading zeros in identifiers',()=>{
  assert.equal(validNpi('1234567893'),true);assert.equal(validNpi('1234567890'),false);
  assert.equal(normalizeReading('Patient account','001234567'),'001234567');
});
test('a third reading must agree with an earlier valid reading',()=>{
  const pages=[{number:1,type:'Document',fields:[{label:'Insured ID',status:'uncertain',value:'',alternatives:['123456','123457']}],serviceLines:[]}];
  applyVerification(pages,[{page:1,index:0,text:'123458',confidence:99}]);assert.equal(pages[0].fields[0].value,'');
  applyVerification(pages,[{page:1,index:0,text:'123456',confidence:99}]);assert.equal(pages[0].fields[0].value,'123456');
});
test('two conflicting close-ups withhold an earlier reading instead of silently replacing it',()=>{
 const pages=[{number:1,type:'Document',fields:[{label:'Insured ID',status:'matched',value:'123456',alternatives:['123456','123456']}],serviceLines:[]}];
 applyVerification(pages,[{page:1,index:0,variants:[{text:'123457',confidence:99},{text:'123457',confidence:99}],independent:{text:'123457',confidence:99}}]);
 assert.equal(pages[0].fields[0].value,'');assert.equal(pages[0].fields[0].status,'uncertain');
});
test('correlated zoom variants cannot overrule agreement between independent page engines',()=>{
 const pages=[{number:1,type:'Document',fields:[{label:'Insured ID',value:'123456',alternatives:['123456','123456']}],serviceLines:[]}];
 applyVerification(pages,[{page:1,index:0,variants:[{text:'123457',confidence:99},{text:'123457',confidence:99}]}]);
 assert.equal(pages[0].fields[0].value,'123456');
});
test('preserves check amounts, negative adjustments and zero non-covered charges',()=>{
 assert.equal(normalizeReading('Check amount','193.70'),'193.70');
 assert.equal(normalizeReading('Check amount','0.00'),'0.00');
 assert.equal(normalizeReading('Adjustment amount','-185.41'),'-185.41');
 assert.equal(normalizeReading('Non-covered charges','0 00'),'0.00');
 assert.equal(normalizeReading('Beneficiary ID','HIC 001234567'),'001234567');
});
test('can corroborate an adjustment code against the separate printed glossary',()=>{
 const pages=[{number:2,type:'Payment explanation',text:'GLOSSARY C0253 Sequestration',warnings:[],fields:[{group:'Adjustment 1',label:'Adjustment code',rawValue:'CO253',value:'',status:'uncertain'}],serviceLines:[]}];
 applyVerification(pages,[]);
 assert.equal(pages[0].fields[0].value,'CO253');
 assert.equal(normalizeReading('Adjustment code','C0253'),'CO253');
});
