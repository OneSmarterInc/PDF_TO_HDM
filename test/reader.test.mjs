import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,organize} from '../extract.mjs';

test('separates professional, hospital and payment documents despite partial OCR headings',()=>{
  assert.equal(classify('HEALTH INSURANCE CLAIM FORM\nCALDWELL'),'Professional claim');
  assert.equal(classify('OCCURRENCE\nPAYER NAME\nDOCUMENT CONTROL NUMBER'),'Hospital claim');
  assert.equal(classify('MEDICARE\nCLAIM TOTALS\nGLOSSARY'),'Payment explanation');
  assert.equal(classify('Ordinary letter about a meeting'),'Document');
});
test('keeps complete text and page identity when no layout blocks are available',()=>{
  const text='Patient: Example\nCharge 200.00\nPayment 87.80\nUnreadable mark: ?';
  const p=organize({text,confidence:72},{number:4,width:100,height:200});
  assert.equal(p.number,4);assert.equal(p.text,text);assert.equal(p.sections[0].text,text);
});
test('preserves source values and flags low confidence without silently correcting them',()=>{
  const word={text:'1950',confidence:42,bbox:{x0:20,y0:20,x1:40,y1:28}};
  const p=organize({text:'1950',confidence:42,blocks:[{paragraphs:[{lines:[{text:'1950',words:[word]}]}]}]},{number:1,width:100,height:100});
  assert.equal(p.text,'1950');assert.deepEqual(p.uncertain[0].bbox,word.bbox);assert.equal(p.uncertain[0].confidence,42);
});
test('excludes vertical page-edge labels while retaining nearby patient values',()=>{
 const word=(text,x0,y0,x1,y1)=>({text,confidence:90,bbox:{x0,y0,x1,y1}});
 const words=[word('PATIENT AND INSURED INFORMATION',97,20,99,70),word('CALDWELL',62,20,90,22)];
 const p=organize({text:'HEALTH INSURANCE CLAIM',blocks:[{paragraphs:[{lines:[{words}]}]}]},{number:1,width:100,height:100});
 assert.equal(p.text,'CALDWELL');
});
