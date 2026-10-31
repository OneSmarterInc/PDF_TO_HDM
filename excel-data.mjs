export function formVersion(page) {
  if(page.type!=='Professional claim')return '';
  const text=(page.embeddedText||'')+'\n'+(page.text||'');
  if(/(?:FORM|NUCC|COMMITTEE)[\s\S]{0,65}02[\s/-]*12/i.test(text))return '02/12';
  if(/(?:FORM|NUCC|COMMITTEE)[\s\S]{0,65}08[\s/-]*05/i.test(text))return '08/05';
  return 'Unconfirmed';
}
export function money(value) {
  const v=String(value??'').trim().replace(/^\$\s*/,'');
  if(/^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(v))return Number(v.replaceAll(',',''));
  // The CMS form prints dollars and cents in separate areas.
  if(/^\d+\s+\d{2}$/.test(v))return Number(v.replace(/\s+/,'.'));
  return null; // Do not guess cents in a run of OCR digits.
}
const value=(page,...labels)=>{
  if(labels.includes('Diagnosis codes'))return (page.fields||[]).filter(f=>/^Diagnosis [A-L0-9]$/.test(f.label)&&f.value).map(f=>f.value).join(', ')||'';
  for(const label of labels){const f=(page.fields||[]).find(f=>f.label===label&&f.group==='Claim payment totals')||(page.fields||[]).find(f=>f.label===label);if(f && !/^Not detected/.test(f.value))return f.value;}
  return '';
};
const claimColumns=[
 ['Patient name','Patient name'],['Patient date of birth (raw)','Date of birth','Date of birth / sex'],
 ['Patient street address','Address'],['Patient city / state (raw)','City / state'],['Patient ZIP / telephone (raw)','ZIP / telephone'],
 ['Insured ID (1a)','Insured ID'],['Insured name (4)','Insured name'],['Other insured name (9)','Other insured'],
 ['Other insured policy / group number (9a)','Other policy / group ID'],['Other insurance plan (9d)','Other plan'],['Insurance plan name (11c)','Insurance plan'],
 ['Illness date / qualifier (14, raw)','Illness date / qualifier'],['Diagnosis codes (21, raw)','Diagnosis codes'],
 ['Patient account number (26)','Patient account','Patient control number'],['Federal tax ID (25)','Tax ID'],
 ['Total charge (28, USD)','Total charge','Total charges'],['Amount paid (29, USD)','Amount paid on claim'],
 ['Balance due (30, 08/05 only, USD)','Balance due'],['Reserved box 30 value (02/12, raw)','Box 30 value (reserved)'],
 ['Signing provider (31)','Signing provider'],['Service facility (32)','Service facility'],['Billing provider (33)','Billing provider','Billing address'],
 ['Service facility NPI','Service facility NPI'],['Billing provider NPI','Billing provider NPI'],
 ['Service details','Service line(s)','Laboratory service lines'],
 ['Hospital statement period (raw)','Statement period'],['Hospital medical record number','Medical record number'],
 ['Hospital prior payment (USD)','Prior payment'],['Hospital estimated amount due (USD)','Estimated amount due'],
 ['Hospital payers / plan IDs (raw)','Payers / plan IDs'],['Hospital insured names / IDs (raw)','Insured names / IDs'],
 ['Hospital document control number','Document control number'],['Hospital attending provider','Attending provider']
];
export function buildExportData(doc) {
  const pages=doc.pages||[];
  const claimRows=pages.filter(p=>/claim$/.test(p.type)).map(p=>{
    const version=formVersion(p);
    const columns=claimColumns.map(([title,...labels])=>{
      let v=value(p,...labels);
      if(title==='Service details')return p.serviceLines?.length?`${p.serviceLines.length} detected line(s); see Service lines. Full OCR and corrections: Field review.`:v?'See Field review for full service text.':'';
      if(title.startsWith('Balance due')&&version==='08/05')v=value(p,'Balance due','Box 30 value (reserved)');
      if(title.startsWith('Reserved box')&&version==='08/05')v='';
      return title.includes('USD)')?money(v):v;
    });
    return [doc.name,p.number,p.type,version,(p.fields||[]).some(f=>!f.reviewed)?'Unreviewed fields remain':'Reviewed extracted fields',...columns];
  });
  const payments=pages.filter(p=>p.type==='Payment explanation').map(p=>[doc.name,p.number,...['Billed amount','Allowed amount','Deductible','Coinsurance','Adjustments total','Provider paid'].map(l=>money(value(p,l))),(p.fields||[]).length && p.fields.every(f=>f.reviewed)?'Reviewed extracted fields':'Needs review','See page text for payment explanations; no automatic claim matching']);
  const review=pages.flatMap(p=>(p.fields||[]).filter(f=>doc.includeRaw||!f.value||f.reviewed).map(f=>[doc.name,p.number,p.type,f.group,f.label,f.value,f.originalValue??f.value,f.reviewed?'Reviewed by user':f.reason||'Needs review',f.confidence??null]));
  const text=pages.flatMap(p=>{
    const sources=[['OCR',p.text||''],...(p.embeddedText?[['Embedded PDF text',p.embeddedText]]:[])];
    return sources.flatMap(([source,t])=>t.split(/\r?\n/).flatMap((line,i)=>{
      const parts=line.match(/[\s\S]{1,500}/g)||[''];return parts.map((part,j)=>[doc.name,p.number,p.type,source,i+1,j+1,part]);
    }));
  });
  const serviceRows=pages.flatMap(p=>(p.serviceLines||[]).map(l=>[doc.name,p.number,formVersion(p),l.line,...l.values,l.revenueCode||'',l.description||'',money(l.nonCovered),'Blank cells may need review; compare with source']));
  const result=[
    {name:'Claims',headers:['Source PDF','Source page','Document type','CMS-1500 version','Review status',...claimColumns.map(c=>c[0])],rows:claimRows,note:'One row per claim page. Blank numeric cells mean missing or ambiguous OCR; Field review preserves every raw value. Identifiers remain text.'},
    {name:'Service lines',headers:['Source PDF','Source page','Form version','Service line','Service date from','Service date to','Place of service','Emergency indicator','CPT / HCPCS','Modifiers','Diagnosis pointer','Charge (USD)','Days / units','EPSDT / family plan','ID qualifier','Rendering provider ID','Revenue code','Service description','Non-covered charges (USD)','Review status'],rows:serviceRows.map(r=>r.map((v,i)=>i===11?money(v):v)),note:'One row per detected service line. Missing values remain blank; use Field review and the original page for unresolved readings.'},
    {name:'Payments',headers:['Source PDF','Source page','Billed amount (USD)','Allowed amount (USD)','Deductible (USD)','Coinsurance (USD)','Adjustments total (USD)','Provider paid (USD)','Review status','Notes'],rows:payments,note:'Payment notices remain separate from claim forms; amounts are not reconciled or substituted automatically.'},
    {name:'Field review',headers:['Source PDF','Source page','Document type','Section','Field name','Current value','Original OCR value','Review status','OCR confidence (%)'],rows:review,note:'User corrections are exported as Current value. Original OCR is retained. Confidence does not guarantee correctness.'},
    {name:'Page text',headers:['Source PDF','Source page','Document type','Text source','Line number','Part','Text'],rows:text,note:'Full extracted text, including notes and fields not mapped to columns. Form labels are not patient values.'}
  ];
  // Export every mapped non-service field, including newly supported form boxes.
  const currency=label=>/amount$|non-covered charges|^Interest$|Late filing charge|Patient responsibility|Net payment|deductible|coinsurance|adjustments total|provider paid/i.test(label);
  for(const [sheet,selected,known] of [
    [result[0],pages.filter(p=>/claim$/.test(p.type)),new Set(claimColumns.flatMap(c=>c.slice(1)))],
    [result[2],pages.filter(p=>p.type==='Payment explanation'),new Set(['Billed amount','Allowed amount','Deductible','Coinsurance','Adjustments total','Provider paid'])]
  ]){
    const extras=new Map();
    for(const p of selected)for(const f of p.fields||[]){
      if(/^Service \d+|^Adjustment \d+/.test(f.group)||/^Diagnosis [A-L0-9]$/.test(f.label))continue;
      if(known.has(f.label)&&!/^Payer \d+|^Remittance service/.test(f.group))continue;
      extras.set(f.group+' / '+f.label,{group:f.group,label:f.label});
    }
    for(const {group,label} of extras.values()){
      const title=(/^Payer \d+|^Remittance service/.test(group)?group+' - ':'')+label;
      sheet.headers.push(title+(currency(label)?' (USD)':''));
      selected.forEach((p,i)=>{const v=(p.fields||[]).find(f=>f.group===group&&f.label===label)?.value||'';sheet.rows[i].push(currency(label)?money(v):v);});
    }
  }
  const adjustments=pages.flatMap(p=>[...new Set((p.fields||[]).filter(f=>/^Adjustment \d+$/.test(f.group)).map(f=>f.group))].map(group=>[p.number,group,(p.fields.find(f=>f.group===group&&f.label==='Adjustment code')?.value||''),money(p.fields.find(f=>f.group===group&&f.label==='Adjustment amount')?.value)]));
  if(adjustments.length)result.splice(3,0,{name:'Adjustments',headers:['Source page','Adjustment','Code','Amount (USD)'],rows:adjustments,note:''});
  const explanations=pages.filter(p=>p.explanations).flatMap(p=>p.explanations.split('\n').filter(Boolean).map(line=>[p.number,line]));
  if(explanations.length)result.push({name:'Payment explanations',headers:['Source page','Explanation (OCR)'],rows:explanations,note:''});
  const claims=result[0];
  const keep=claims.headers.map((h,i)=>i).filter(i=>i<6||claims.rows.some(row=>row[i]!==null&&row[i]!==''));
  claims.headers=keep.map(i=>claims.headers[i].replace(' (raw)','').replace(', raw',', as read'));
  claims.rows=claims.rows.map(row=>keep.map(i=>row[i]));
  if(doc.includeRaw)return result;
  result.find(s=>s.name==='Field review').rows=review.filter(r=>r[7]!=='Reviewed by user');
  const simple=result.filter(s=>s.name!=='Page text'&&s.rows.length).map(s=>{
    const omit=new Set(['Source PDF','CMS-1500 version','Form version','Review status','Notes','Service details','Original OCR value','OCR confidence (%)','Document type','Section']);
    if(s.name==='Field review')omit.delete('Review status');
    const indices=s.headers.map((_,i)=>i).filter(i=>!omit.has(s.headers[i])&&!s.headers[i].startsWith('Reserved box')&&
      (s.headers[i]==='Current value'||s.rows.some(r=>r[i]!==''&&r[i]!==null&&r[i]!==undefined)));
    const priority=s.name==='Payments'?['Source page','Payment patient name','Check amount (USD)','Check / EFT number','Payment date','Provider paid (USD)','Payment account number','Beneficiary ID','Claim reference number']:s.name==='Service lines'?['Source page','Service line','Revenue code','Service description','CPT / HCPCS','Modifiers','Service date from','Service date to','Days / units','Charge (USD)','Non-covered charges (USD)']:[];
    indices.sort((a,b)=>{const rank=i=>priority.includes(s.headers[i])?priority.indexOf(s.headers[i]):priority.length+i;return rank(a)-rank(b);});
    return {...s,headers:indices.map(i=>s.headers[i].replace(/ \((?:raw|\d+[a-z]?|\d+, 08\/05 only)\)/g,'').replace(/\(\d+, USD\)/g,'(USD)').replace('Source page','Page').replace('Patient date of birth','Date of birth')),
      rows:s.rows.map(r=>indices.map(i=>r[i]))};
  });
  return simple.length?simple:[{name:'Claims',headers:['Page','Status'],rows:pages.map(p=>[p.number,'No structured claim data detected']),note:''}];
}

export function buildReadableExportData(doc){
  if(doc.includeRaw)return buildExportData(doc);
  const tables=[];
  const currency=label=>/total charge|amount paid|prior payment|amount due|balance due|billed amount|allowed amount|deductible|coinsurance|adjustments total|provider paid|^Charge$|amount$|non-covered charges|^Interest$|Late filing charge|Patient responsibility|Net payment/i.test(label);
  for(const page of doc.pages||[]){
    const rows=[],currencyRows=[];
    for(const field of page.fields||[]){
      if(/^Service \d+$/.test(field.group))continue;
      let val=field.value||((field.reviewed||field.blankConfirmed)?'':'Needs review');
      if(field.value&&currency(field.label)){const number=money(field.value);if(number!==null){val=number;currencyRows.push(rows.length);}}
      rows.push([field.group,field.label,val,field.verification?.status==='attention'?'Needs attention':field.reviewed?'Reviewed':field.blankConfirmed?'Blank (optional)':field.value?'Read':'Needs review']);
    }
    if(page.explanations)for(const [i,line] of page.explanations.split('\n').filter(Boolean).entries())
      rows.push(['Payment explanations','Explanation '+(i+1),line,page.explanationsReviewed?'Reviewed':'OCR text']);
    tables.push({name:'Page '+page.number,headers:['Section','Field','Value','Status'],rows,currencyRows,currencyColumn:2,widths:[26,36,64,18],note:''});
  }
  for(const hospital of [false,true]){
    const pages=(doc.pages||[]).filter(p=>(p.type==='Hospital claim')===hospital&&p.serviceLines?.length);
    if(!pages.length)continue;
    const headers=hospital?['Page','Line','Revenue code','Description','CPT / HCPCS','Modifier','Service date','Units','Charge (USD)','Non-covered (USD)']:['Page','Line','From','To','Place of service','CPT / HCPCS','Modifier','Diagnosis pointer','Charge (USD)','Units','Rendering NPI'];
    const rows=pages.flatMap(p=>p.serviceLines.map(r=>hospital?[p.number,r.line,r.revenueCode,r.description,r.values[4],r.values[5],r.values[0],r.values[8],money(r.values[7]),money(r.nonCovered)]:[p.number,r.line,r.values[0],r.values[1],r.values[2],r.values[4],r.values[5],r.values[6],money(r.values[7]),r.values[8],r.values[11]]));
    tables.push({name:hospital?'Hospital services':'Professional services',headers,rows,note:''});
  }
  const checks=(doc.pages||[]).flatMap(p=>(p.fields||[]).filter(f=>f.kind==='checkbox').flatMap(f=>(f.options||[]).map(o=>[p.number,f.label,o.label,o.state==='selected'?'Yes':o.state==='unselected'?'No':'Needs review'])));
  if(checks.length)tables.push({name:'Checkboxes',headers:['Page','Field','Option','Selected'],rows:checks,widths:[10,34,24,18],note:''});
  if(doc.verification){const v=doc.verification;tables.push({name:'Verification',headers:['Page','Field','Result'],rows:[['','Overall',v.status==='passed'?'Automatic checks passed':'Needs attention'],['','Checks',`${v.passedFields} of ${v.checkedFields} fields passed`],...v.issues.map(i=>[i.page,i.field===null?'Page check':doc.pages.find(p=>p.number===i.page)?.fields[i.field]?.label||'Field',i.message])],widths:[10,32,90],note:''});}
  return tables.length?tables:[{name:'Results',headers:['Status'],rows:[['No structured data detected']],note:''}];
}
