import {formVersion} from './excel-data.mjs';
export function classify(text) {
  if (/HEALTH\s+INSURANCE\s+CLAIM|FORM\s*1500/i.test(text)) return 'Professional claim';
  if (/TYPE\s+OF\s+BILL|REVENUE\s+CODE|STATEMENT\s+COVERS|PATIENT\s+CONTROL/i.test(text) || (/OCCURRENCE/i.test(text) && /PAYER\s+NAME|DOCUMENT\s+CONTROL/i.test(text))) return 'Hospital claim';
  if (/REMITTANCE|CLAIM\s+TOTALS|GLOSSARY|PROV\s+PD/i.test(text)) return 'Payment explanation';
  return 'Document';
}

export function getLines(blocks = []) {
  return blocks.flatMap(b => (b.paragraphs || []).flatMap(p => p.lines || []));
}

export function isSideText(token,page){
  const b=token.bbox,x=(b.x0+b.x1)/2/page.width;
  if(page.type==='Professional claim'&&x>.965)return true;
  return (x<.025||x>.96)&&(b.y1-b.y0)>1.6*(b.x1-b.x0);
}

// Normalized value regions for standard CMS-1500 and UB-04 forms.
// Raw OCR and the source image remain available alongside these readings.
export const fieldRegions = {
  'Professional claim': [
    ['Patient','Patient name',[.03,.153,.36,.172]],
    ['Patient','Date of birth',[.39,.155,.50,.171]],
    ['Patient','Address',[.03,.182,.36,.200]],
    ['Patient','City / state',[.03,.214,.36,.232]],
    ['Patient','ZIP / telephone',[.03,.247,.36,.264]],
    ['Insurance','Insured ID',[.61,.125,.95,.143]],
    ['Insurance','Insured name',[.61,.154,.95,.172]],
    ['Insurance','Other insured',[.03,.278,.36,.295]],
    ['Insurance','Other policy / group ID',[.03,.306,.36,.322]],
    ['Insurance','Other plan',[.03,.395,.36,.415]],
    ['Insurance','Insurance plan',[.61,.367,.95,.386]],
    ['Clinical','Illness date / qualifier',[.03,.490,.34,.508]],
    ['Clinical','Diagnosis codes',[.03,.578,.60,.625]],
    ['Services','Service line(s)',[.03,.663,.96,.691]],
    ['Financial','Total charge',[.61,.855,.71,.872]],
    ['Financial','Amount paid on claim',[.72,.855,.84,.872]],
    ['Financial','Box 30 value (reserved)',[.85,.855,.95,.872]],
    ['Identifiers','Tax ID',[.03,.853,.20,.872]],
    ['Identifiers','Patient account',[.29,.853,.45,.872]],
    ['Providers','Signing provider',[.03,.904,.28,.923]],
    ['Providers','Service facility',[.29,.889,.60,.945]],
    ['Providers','Billing provider',[.61,.885,.96,.94]]
  ],
  'Hospital claim': [
    ['Patient','Patient name',[.025,.088,.48,.105]],
    ['Patient','Address',[.50,.076,.96,.107]],
    ['Patient','Date of birth / sex',[.025,.119,.157,.135]],
    ['Facility','Service facility',[.02,.014,.30,.075]],
    ['Facility','Billing address',[.31,.014,.60,.075]],
    ['Identifiers','Patient control number',[.64,.016,.91,.031]],
    ['Identifiers','Medical record number',[.64,.032,.91,.046]],
    ['Identifiers','Tax ID',[.61,.060,.72,.074]],
    ['Services','Statement period',[.72,.060,.96,.074]],
    ['Services','Laboratory service lines',[.019,.272,.95,.351]],
    ['Financial','Total charges',[.77,.607,.84,.621]],
    ['Financial','Prior payment',[.55,.636,.64,.652]],
    ['Financial','Estimated amount due',[.71,.650,.77,.667]],
    ['Insurance','Payers / plan IDs',[.02,.635,.45,.668]],
    ['Insurance','Insured names / IDs',[.02,.694,.60,.724]],
    ['Identifiers','Document control number',[.38,.756,.70,.773]],
    ['Clinical','Diagnosis codes',[.02,.800,.60,.819]],
    ['Providers','Attending provider',[.60,.848,.97,.880]]
  ]
};

function regionText(lines, width, height, box) {
  const words = lines.flatMap(line => line.words || []).filter(w => {
    const x = (w.bbox.x0 + w.bbox.x1) / 2 / width;
    const y = (w.bbox.y0 + w.bbox.y1) / 2 / height;
    return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  }).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows = [];
  for (const word of words) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    let row = rows.find(r => Math.abs(r.y - y) < height * .0045);
    if (!row) rows.push(row = { y, words: [] });
    row.words.push(word);
  }
  return rows.sort((a,b) => a.y-b.y).map(r => r.words.sort((a,b) => a.bbox.x0-b.bbox.x0).map(w => w.text).join(' ')).join('\n');
}

export function serviceLines(data,page) {
  if(page.type!=='Professional claim'||formVersion(page)!=='02/12')return [];
  const lines=getLines(data.blocks),result=[];
  const columns=[[.03,.13],[.13,.235],[.238,.272],[.274,.31],[.312,.396],[.397,.544],[.546,.604],[.606,.71],[.712,.758],[.76,.786],[.788,.813],[.815,.957]];
  for(let i=0;i<6;i++){
    const top=.663+i*.031;
    const values=columns.map(([x0,x1])=>regionText(lines,page.width,page.height,[x0,top,x1,top+.028]).replace(/\s+/g,' ').trim());
    if(/\d{2}/.test(values[0]) && /\d{3}/.test(values[4]))result.push({line:i+1,values});
  }
  return result;
}

export function organize(data, page) {
  const originalText = data.text || page.embeddedText || '';
  const type = classify(originalText);
  const lines = getLines(data.blocks).map(l=>({...l,words:(l.words||[]).filter(w=>!isSideText(w,{...page,type}))}));
  const text = lines.length?regionText(lines,page.width,page.height,[0,0,1,1]):originalText;
  let zones;
  if (type === 'Professional claim') zones = [
    ['Insurance recipient', [0,.0,1,.11]],
    ['Patient, insured & coverage', [0,.11,1,.416]],
    ['Authorization & signatures', [0,.416,1,.477]],
    ['Clinical details & diagnoses', [0,.477,1,.628]],
    ['Services & charges', [0,.628,1,.84]],
    ['Totals, account & providers', [0,.84,1,1]]
  ];
  else if (type === 'Hospital claim') zones = [
    ['Facility, patient & admission', [0,0,1,.18]],
    ['Insurance recipient & value codes', [0,.18,1,.257]],
    ['Service lines & total charges', [0,.257,1,.622]],
    ['Payers, payments & insured', [0,.622,1,.737]],
    ['Diagnoses, authorization & providers', [0,.737,1,1]]
  ];
  else {
    const glossary = lines.find(l => /GLOSSARY/i.test(l.text));
    const split = glossary ? glossary.bbox.y0 / page.height : .65;
    zones = [['Document details & transactions', [0,0,1,split]], ['Explanatory notes & remaining content', [0,split,1,1]]];
  }
  const sections = zones.map(([title, box]) => ({title, text:regionText(lines,page.width,page.height,box)})).filter(s=>s.text.trim());
  if (!sections.length) sections.push({title:'Page content',text});
  const uncertain = lines.flatMap(l=>l.words||[]).filter(w=>w.confidence < 60 && /[a-z0-9]/i.test(w.text)).map(w=>({text:w.text,confidence:Math.round(w.confidence),bbox:w.bbox}));
  return {number:page.number,type,text,sections,confidence:Math.round(data.confidence || 0),uncertain,width:page.width,height:page.height,rotationDegrees:page.rotationDegrees||0,embeddedText:page.embeddedText || ''};
}
