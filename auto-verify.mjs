import {normalizeReading} from './accuracy.mjs';
const supported=new Set(['Professional claim','Hospital claim','Payment explanation']);
const strict=/NPI|^Date of birth$|^Service date (from|to)$|^Tax ID$|^ZIP code$|^CPT \/ HCPCS$|^Days \/ units$|^Revenue code$|^Diagnosis [A-L0-9]$|^ICD-9 diagnosis|^Total charges?$|^Charge$|amount$|^Amount paid on claim$|^Balance due$|^Provider paid$|^Non-covered charges$/i;
const cents=s=>/^-?\d+(?:\.\d{1,2})?$/.test(String(s))?Math.round(Number(s)*100):null;
export function verifyDocument(doc){
 const issues=[];let checked=0,passed=0;
 for(const p of doc.pages||[]){
  const fields=p.fields||[];
  const issue=(field,code,message)=>{if(!issues.some(i=>i.page===p.number&&i.field===field&&i.code===code))issues.push({page:p.number,field,code,message});};
  if(!supported.has(p.type)||!fields.length)issue(null,'unsupported','This page has no supported structured extraction to verify.');
  fields.forEach((f,i)=>{
   const messages=[];const fail=(code,text)=>{messages.push(text);issue(i,code,text);};checked++;
   if(!f.value&&!f.reviewed&&!f.blankConfirmed)fail('unreadable','No reliable value was extracted.');
   if(f.value&&strict.test(f.label)&&!normalizeReading(f.label,f.value))fail('format','Value does not match the expected format or checksum.');
   if(f.kind==='checkbox'){
    const options=f.options||[],selected=options.filter(o=>o.state==='selected');
    if(!options.length||options.some(o=>o.state==='uncertain')||selected.length>1||f.value!==(selected[0]?.label||'None selected'))fail('checkbox','Checkbox marks or selection are ambiguous.');
   }else if(f.value&&!f.reviewed&&!f.ocrCorroborated&&!['matched','consistent'].includes(f.status))fail('corroboration','The value lacks agreement between readings; format alone is not enough.');
   if(f.userEdited&&f.value!==(f.sourceCheckedValue??f.originalValue??f.rawValue??''))fail('source_difference','Saved correction differs from the source reading. Automatic checks cannot confirm this change against the PDF.');
   f.verification={status:messages.length?'attention':'passed',messages};if(!messages.length)passed++;
  });
  const required=p.type==='Professional claim'?['Patient name','Insured ID','Total charge']:p.type==='Hospital claim'?['Patient name','Total charges']:p.type==='Payment explanation'?['Check amount']:[];
  for(const label of required){const i=fields.findIndex(f=>f.label===label);if(i<0||!fields[i].value)issue(i<0?null:i,'missing','Missing '+label+' needed for this portal’s verification.');}
  if(/^(Professional|Hospital) claim$/.test(p.type)){
   const total=fields.findIndex(f=>/^Total charges?$/.test(f.label));const lines=p.serviceLines||[];
   if(!lines.length)issue(null,'services','No service lines were extracted.');
   else {
    const charges=lines.map(r=>cents(r.values?.[7]));const amount=total>=0?cents(fields[total].value):null;
    if(charges.some(v=>v===null))issue(null,'service_amount','Some service amounts could not be checked.');
    else if(amount!==null&&Math.abs(charges.reduce((a,b)=>a+b,0)-amount)>1)issue(total,'total','Service charges do not match the printed total.');
   }
  }
  // Keep layout / extraction warnings; arithmetic is recalculated above after edits.
  for(const warning of p.warnings||[])if(!/do not add up|do not reconcile/.test(warning))issue(null,'extraction',warning);
  // Do not equate the check with one claim's payment: checks may cover multiple claims.
 }
 for(const p of doc.pages||[])for(const [i,f] of (p.fields||[]).entries()){
  const extra=issues.filter(x=>x.page===p.number&&x.field===i).map(x=>x.message);
  if(extra.length)f.verification={status:'attention',messages:[...new Set(extra)]};
 }
 passed=(doc.pages||[]).flatMap(p=>p.fields||[]).filter(f=>f.verification.status==='passed').length;
 const result={status:issues.length?'attention':'passed',checkedFields:checked,passedFields:passed,issues,checkedAt:new Date().toISOString(),scope:'OCR evidence, field formats, checkbox consistency, key-field presence and service totals. Not a coverage or payment decision.'};
 doc.verification=result;return result;
}
