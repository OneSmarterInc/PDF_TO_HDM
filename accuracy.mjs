import {getLines,fieldRegions,isSideText} from './extract.mjs';
import {formVersion} from './excel-data.mjs';
import {extractLegacy} from './legacy.mjs';
const key=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,'');
const clean=s=>String(s||'').normalize('NFKC').replace(/[|_~]/g,' ').replace(/\s+/g,' ').trim();
const ignored=/^(?:NPI|MM|DD|YY|YYYY|[A-L][.]\s*[LI]?|SIGNED|DATE)$/i;
export function readRegion(tokens,box,w,h){
  const selected=tokens.filter(t=>{
    const b=t.bbox,x=(b.x0+b.x1)/2/w,y=(b.y0+b.y1)/2/h;
    return x>box[0]&&x<box[2]&&y>box[1]&&y<box[3]&&!ignored.test(t.text.trim())&&/[a-z0-9]/i.test(t.text);
  }).sort((a,b)=>a.bbox.y0-b.bbox.y0);
  const rows=[];
  for(const t of selected){const y=(t.bbox.y0+t.bbox.y1)/2;let row=rows.find(r=>Math.abs(r.y-y)<h*.006);if(!row)rows.push(row={y,items:[]});row.items.push(t);}
  const text=rows.sort((a,b)=>a.y-b.y).map(r=>r.items.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(t=>t.text).join(' ')).join('\n');
  return {text,confidence:selected.length?Math.min(...selected.map(t=>t.confidence)):0};
}
export function normalizeReading(label,raw){
  let s=clean(raw);if(!s)return '';
  if(label==='Service description')s=s.replace(/-{2,}/g,'-');
  if(label==='Service dates as printed')s=s.replace(/[.,;:]+$/,'');
  if(/name/i.test(label))s=s.replace(/\s+,/g,',').replace(/^[‘’丨\s]+|[‘’丨\s]+$/g,'');
  const prefixes={'Payment patient name':/^NAME\s*:?\s*/i,'Beneficiary ID':/^HIC\s*:?\s*/i,'Payment account number':/^ACNT\s*:?\s*/i,'Claim reference number':/^ICN\s*:?\s*/i,'Remark codes':/^MOA\s*:?\s*/i,'Payment provider NPI':/^NPI\s*#?\s*:?\s*/i};
  if(prefixes[label])s=s.replace(prefixes[label],'');
  if(label==='Provider number')s=s.replace(/^#\s*:?\s*/,'').replace(/:$/,'');
  if(/RESERVED|PATIENT.?S NAME|INSURED.?S NAME|SIGNATURE|APPROVED|SAMPLE|RECEIVED|PLACE OF SERVICE/i.test(s))return '';
  if(/(?:total charge|amount paid|prior payment|amount due|balance due|billed amount|allowed amount|deductible|coinsurance|adjustments total|provider paid|^Charge$|amount$|non-covered charges|^Interest$|Late filing charge|Patient responsibility|Net payment)/i.test(label)){
    s=s.replace(/^(?:I\s+)+/,'').replace(/[!]+$/,'').replace(/[()]/g,'').trim().replace(/^\$\s*/,'').replace(/[, :]/g,'');
    if(/^0{3,}$/.test(s))return '0.00';
    if(/^-?\d+\.\d{2}$/.test(s))return Number(s).toFixed(2);
    // Fixed-dollar/cents claim fields: both areas are included in the crop.
    if(/^-?\d{4,}$/.test(s))return (Number(s)/100).toFixed(2);
    return '';
  }
  if(/^Service date|Payment date|Creation date|Illness date|Signature date/.test(label)&&!['Service dates as printed','Illness date qualifier'].includes(label)){
    const d=s.replace(/[^0-9]/g,'');if(![6,8].includes(d.length))return '';
    const m=+d.slice(0,2),day=+d.slice(2,4),y=d.length===8?+d.slice(4):2000+(+d.slice(4));
    const dt=new Date(Date.UTC(y,m-1,day));return dt.getUTCMonth()===m-1&&dt.getUTCDate()===day?`${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`:'';
  }
  if(/date of birth/i.test(label)){
    const d=s.replace(/[^0-9]/g,'');if(d.length!==8)return '';
    const m=+d.slice(0,2),day=+d.slice(2,4),y=+d.slice(4);const dt=new Date(Date.UTC(y,m-1,day));
    return y>=1850&&y<=new Date().getFullYear()&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===day?`${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`:'';
  }
  if(/Tax ID/i.test(label)){const d=s.replace(/\s/g,'');return /^\d{9}$/.test(d)?d:'';}
  if(/NPI|Rendering provider ID/.test(label)){const d=s.replace(/^a[.]?\s*/i,'').replace(/\s/g,'').replace(/^\D+(?=\d{10}$)/,'');return validNpi(d)?d:'';}
  if(/Insured ID|policy \/ group ID|Patient account|Patient control number|Medical record number|Document control number|Beneficiary ID|Payment account number|Claim reference number|Provider number|Check \/ EFT number|Patient identifier/.test(label)){
    const d=s.replace(/\s/g,'');return /^[A-Z0-9-]{5,30}$/i.test(d)&&/\d/.test(d)?d.toUpperCase():'';
  }
  if(/^Diagnosis [A-L0-9]$/.test(label)){
    s=s.replace(/^[A-L][.]\s*[L|]?\s*/,'').replace(/\s+/g,'');
    return /^[A-Z]\d[A-Z0-9](?:\.?[A-Z0-9]{1,4})?$/i.test(s)?s.toUpperCase():'';
  }
  if(/^ICD-9 diagnosis/.test(label))return /^(?:\d{3}|V\d{2}|E\d{3})(?:\.\d{1,2})?$/i.test(s)?s.toUpperCase():'';
  if(/CPT \/ HCPCS/.test(label)){s=s.replace(/[.,;:]$/,'');return /^(?:\d{5}|[A-Z]\d{4}|\d{4}[A-Z])$/.test(s)?s:'';}
  if(label==='Revenue code'){s=s.replace(/[.,;:]$/,'');return /^\d{4}$/.test(s)?s:'';}
  if(/Place of service/.test(label))return /^\d{2}$/.test(s)?s:'';
  if(/Days \/ units/.test(label)){s=s.replace(/[\]}|]+$/,'');return /^\d{1,4}(?:\.\d+)?$/.test(s)?s:'';}
  if(/Diagnosis pointer/.test(label))return /^[A-L1-4]{1,4}$/.test(s)?s:'';
  if(/Modifiers/.test(label))return /^(?:[A-Z0-9]{2})(?:\s+[A-Z0-9]{2}){0,3}$/.test(s)?s:'';
  if(/ID qualifier/.test(label))return /^(?:0B|1G|G2|LU|ZZ)$/.test(s)?s:'';
  if(label==='Adjustment code'){s=s.replace(/^C0(?=-?\d)/i,'CO').replace(/[.]$/,'');return /^(?:CO|PR|OA|PI)-?\d{1,3}$/i.test(s)?s.toUpperCase():'';}
  if(label==='Sex'){s=s.replace(/[.]$/,'');return /^[MFU]$/i.test(s)?s.toUpperCase():'';}
  if(label==='State')return /^[A-Z]{2}$/i.test(s)?s.toUpperCase():'';
  if(label==='ZIP code')return /^\d{5}(?:-?\d{4})?$/.test(s)?s:'';
  if(label==='Health plan ID')return /^\d{3,20}$/.test(s)?s:'';
  if(label==='Admitting diagnosis'||label==='Patient reason for visit diagnosis')return /^[A-Z]\d[A-Z0-9](?:\.?[A-Z0-9]{1,4})?$/i.test(s)?s.toUpperCase():'';
  if(/Number of claims|Admission type|Admission source|Patient status|Relationship code/.test(label))return /^\d{1,2}$/.test(s)?s:'';
  if(label==='Type of bill')return /^\d{3,4}$/.test(s)?s:'';
  if(label==='Attending provider')s=s.replace(/\b(?:LAST|FIRST|FRST)\b/g,'').replace(/\s+/g,' ').trim();
  if(/name|Other insured|Signing provider|Attending provider/i.test(label))return /^[A-Za-z][A-Za-z ,.'-]{2,80}$/.test(s)?s:'';
  if(/Address|facility|provider|plan|City|ZIP|Statement period|Illness date/i.test(label)){
    // Normalize the fixed postal term, never arbitrary identifier characters.
    s=s.replace(/\bP[O0][ .·]*B[O0]X\b/gi,'PO BOX');
    return s.length>2 && /[A-Za-z0-9]/.test(s)?s:'';
  }
  return s;
}
export function validNpi(n){
  if(!/^\d{10}$/.test(n))return false;
  const digits=('80840'+n).split('').map(Number);let sum=0;
  for(let i=digits.length-1,flip=false;i>=0;i--,flip=!flip){let d=digits[i];if(flip){d*=2;if(d>9)d-=9;}sum+=d;}
  return sum%10===0;
}
export function chooseReading(label,first,second){
  const a=normalizeReading(label,first.text),b=normalizeReading(label,second.text);
  if(a&&b&&key(a)===key(b))return {value:a.includes(' ')?a:b,status:'matched',reason:'Two OCR readings agree'};
  if(a&&b&&key(a)!==key(b))return {value:'',status:'uncertain',reason:'OCR readings disagree'};
  const strictCode=/^Diagnosis [A-L0-9]$/.test(label);
  if(a&&first.confidence>=(strictCode?85:96))return {value:a,status:'format-checked',reason:'Format checked; second reading unavailable'};
  if(b&&second.confidence>=96)return {value:b,status:'format-checked',reason:'Format checked; second reading unavailable'};
  return {value:'',status:'uncertain',reason:a||b?'Low-confidence reading':'Could not read a valid value'};
}
export function applyVerification(pages,readings){
  for(const r of readings){
    const field=pages.find(p=>p.number===r.page)?.fields[r.index];if(!field)continue;
    field.blankConfirmed=false;
    const variants=[...(r.variants||[r]),...(r.independent?[r.independent]:[])];
    const candidates=variants.filter(v=>v.confidence>=90).map(v=>normalizeReading(field.label,v.text)).filter(Boolean);
    field.alternatives.push(...variants.map(v=>v.text));
    const independent=r.independent?.confidence>=90?normalizeReading(field.label,r.independent.text):'';
    const neuralReadings=[...(field.sourceReadings?.slice(0,1)||[]),...(r.variants||[])];
    const consensus=independent&&neuralReadings.some(v=>v.confidence>=90&&key(normalizeReading(field.label,v.text))===key(independent));
    if(!field.value&&/^ICD-9 diagnosis [2-4]$/.test(field.label)&&r.blankEvidence&&
       !field.alternatives.some(v=>normalizeReading(field.label,v))&&
       !(r.variants||[]).some(v=>v.confidence>=25&&/[a-z0-9]/i.test(v.text))&&
       !/[a-z0-9]/i.test(r.independent?.text||'')){
      field.blankConfirmed=true;field.reason='Optional cell has no text-sized ink and no valid OCR value';
    }
    const conflicting=consensus&&field.value&&key(field.value)!==key(independent);
    const target=normalizeReading(field.label,field.value);
    const numeric=/^(Date of birth|Total charges?|Balance due|Amount paid on claim|Charge|Days \/ units)$/i.test(field.label);
    const agrees=(v,threshold)=>!!v&&v.confidence>=threshold&&key(normalizeReading(field.label,v.text))===key(target);
    const independentValue=normalizeReading(field.label,r.independent?.text);
    const competing=[...(field.sourceReadings?.slice(1)||[]),...(r.independentAttempts||[])].some(v=>v.confidence>=75&&normalizeReading(field.label,v.text)&&key(normalizeReading(field.label,v.text))!==key(target));
    // A valid structured value read clearly on both neural views may be supported
    // by an independent reading whose score is reduced by residual form rules.
    // Never use this path for free text, weak primary readings, or conflicting values.
    const supportedNumeric=!!(numeric&&target&&agrees(field.sourceReadings?.[0],98)&&(r.variants||[]).some(v=>agrees(v,90))&&r.independent?.confidence>=75&&key(independentValue)===key(target)&&!competing);
    field.ocrCorroborated=!!((consensus&&field.value&&key(field.value)===key(independent))||supportedNumeric);
    field.verificationEvidence={independentConfidence:r.independent?.confidence||0,method:consensus?'independent agreement':supportedNumeric?'structured value agreement across page and close-ups':'insufficient agreement'};
    if(conflicting){
      field.value='';field.status='uncertain';field.reason='Close-up reading differs from the page reading; review the source';
    }else if(!field.value){
      const candidate=candidates.find(c=>field.alternatives.slice(0,2).some(v=>key(normalizeReading(field.label,v))===key(c)))||(consensus?independent:'');
      if(candidate){field.value=candidate;field.status='matched';field.reason='Page and magnified field readings agree';}
    }
  }
  for(const page of pages){
    for(const field of page.fields.filter(f=>!f.value&&f.label==='Adjustment code')){
      const code=normalizeReading(field.label,field.rawValue);
      const glossary=(page.text||'').split(/GLOSSARY/i).slice(1).join(' ').replace(/\bC0(?=-?\d)/gi,'CO');
      if(code&&new RegExp('\\b'+code.replace('-','-?')+'\\b','i').test(glossary)){
        field.value=code;field.status='matched';field.reason='Adjustment code also read in the statement glossary';
      }
    }
    page.fields=page.fields.filter(f=>!(f.status==='uncertain'&&['Modifiers','ID qualifier','Emergency indicator','EPSDT / family plan'].includes(f.label)));
    const names=['Service date from','Service date to','Place of service','Emergency indicator','CPT / HCPCS','Modifiers','Diagnosis pointer','Charge','Days / units','EPSDT / family plan','ID qualifier','Rendering provider ID'];
    for(const row of page.serviceLines||[]){row.values=names.map(label=>page.fields.find(f=>f.group===`Service ${row.line}`&&f.label===label)?.value||'');row.revenueCode=page.fields.find(f=>f.group===`Service ${row.line}`&&f.label==='Revenue code')?.value||'';row.description=page.fields.find(f=>f.group===`Service ${row.line}`&&f.label==='Service description')?.value||'';row.nonCovered=page.fields.find(f=>f.group===`Service ${row.line}`&&f.label==='Non-covered charges')?.value||'';}
    if(page.type==='Professional claim'&&page.serviceLines.length===1){
      const total=page.fields.find(f=>f.label==='Total charge'&&f.value);
      const charge=page.fields.find(f=>f.group==='Service 1'&&f.label==='Charge');
      if(total&&charge&&!charge.value&&normalizeReading('Charge',charge.rawValue)===total.value&&charge.confidence>=80){charge.value=total.value;charge.status='consistent';charge.reason='Printed line amount agrees with the claim total';page.serviceLines[0].values[7]=charge.value;}
    }
    const get=label=>page.fields.find(f=>f.label===label&&f.value)?.value;
    if(page.type==='Payment explanation'){
      const amounts=['Billed amount','Provider paid','Coinsurance','Adjustments total'].map(get);
      if(amounts.every(v=>v!==undefined)&&Math.abs(Number(amounts[0])-Number(amounts[1])-Number(amounts[2])-Number(amounts[3]))>.02)page.warnings.push('Payment amounts do not reconcile. Verify billed amount, provider paid, coinsurance and adjustments against the source.');
    }
    const total=get('Total charge')||get('Total charges');
    if(total&&page.serviceLines.length&&page.serviceLines.every(r=>r.values[7])){
      const sum=page.serviceLines.reduce((n,r)=>n+Number(r.values[7]),0);
      if(Math.abs(sum-Number(total))>.02)page.warnings.push('Detected service charges do not add up to the claim total. One or more lines may be missing or misread.');
    }
  }
}

function templateTransform(tokens,page){
  if(page.type!=='Professional claim')return box=>box;
  // Anchor to printed field headings, not the page margin. Unsupported forms are withheld.
  if(formVersion(page)!=='02/12')return null;
  const patient=tokens.find(t=>key(t.text).startsWith('2PATIENT')&&key(t.text).includes('NAME'));
  const tax=tokens.find(t=>key(t.text).startsWith('25FEDERAL'));
  const insured=tokens.find(t=>key(t.text).startsWith('4INSURED')&&key(t.text).includes('NAME'));
  if(!patient||!tax||!insured)return null;
  const sy=(tax.bbox.y0-patient.bbox.y0)/page.height/(.84022-.14365);
  const sx=(insured.bbox.x0-patient.bbox.x0)/page.width/(.60807-.03125);
  if(sx<.65||sx>1.3||sy<.65||sy>1.3)return null;
  const dx=patient.bbox.x0/page.width-.03125*sx,dy=patient.bbox.y0/page.height-.14365*sy;
  return ([x0,y0,x1,y1])=>[x0*sx+dx,y0*sy+dy,x1*sx+dx,y1*sy+dy];
}

export function extractAccurate(neural,tesseract,page){
  neural=neural.filter(t=>!isSideText(t,page));
  const secondary=getLines(tesseract.blocks).flatMap(l=>l.words||[]).filter(t=>!isSideText(t,page));
  if(page.type==='Professional claim'&&formVersion(page)==='08/05')return extractLegacy(neural,secondary,page,{readRegion,chooseReading,normalizeReading});
  const transform=templateTransform(neural,page);
  const fields=[],serviceLines=[],warnings=[],checkboxRequests=[];
  if(!transform){return {fields,serviceLines,warnings:['This form layout could not be aligned reliably. Use the original page; no guessed fields were exported.']};}
  let regions=(fieldRegions[page.type]||[]).filter(([,label])=>!['Box 30 value (reserved)','Diagnosis codes','Service line(s)','Laboratory service lines','Illness date / qualifier','Payers / plan IDs','Insured names / IDs'].includes(label));
  regions=regions.map(([group,label,box])=>{
    if(page.type==='Professional claim'){
      const fixes={'Tax ID':[.035,.853,.16,.871],'Insured ID':[.612,.125,.90,.143],'Service facility':[.29,.889,.60,.929],'Billing provider':[.61,.885,.95,.921],'Total charge':[.61,.855,.733,.872]};
      box=fixes[label]||box;
    }else if(page.type==='Hospital claim'){
      const fixes={'Patient name':[.03,.088,.35,.104],'Address':[.50,.076,.94,.092],'Attending provider':[.61,.862,.91,.88],'Total charges':[.77,.605,.84,.619],'Service facility':[.02,.014,.315,.075],'Billing address':[.31,.014,.60,.075]};box=fixes[label]||box;
    }
    return [group,page.type==='Hospital claim'&&label==='Date of birth / sex'?'Date of birth':label,box];
  });
  if(page.type==='Professional claim'){
    const checks=[
      ['Insurance type',.133,[['Medicare',.039],['Medicaid',.119],['TRICARE',.202],['CHAMPVA',.309],['Group health plan',.392],['FECA',.485],['Other',.557]]],
      ['Patient sex',.163,[['Male',.521],['Female',.580]]],
      ['Relationship to insured',.194,[['Self',.415],['Spouse',.474],['Child',.521],['Other',.580]]],
      ['Employment-related',.317,[['Yes',.438],['No',.510]]],
      ['Auto accident',.347,[['Yes',.438],['No',.510]]],
      ['Other accident',.377,[['Yes',.438],['No',.510]]],
      ['Insured sex',.317,[['Male',.828],['Female',.911]]],
      ['Another health benefit plan',.408,[['Yes',.639],['No',.698]]],
      ['Outside laboratory',.556,[['Yes',.640],['No',.699]]],
      ['Tax ID type',.862,[['SSN',.226],['EIN',.250]]],
      ['Accept assignment',.863,[['Yes',.474],['No',.534]]]
    ];
    for(const [label,y,options] of checks)checkboxRequests.push({label,options:options.map(([option,x])=>{const b=transform([x-.010,y-.008,x+.010,y+.008]);return {label:option,bbox:{x0:b[0]*page.width,y0:b[1]*page.height,x1:b[2]*page.width,y1:b[3]*page.height}};})});
    regions.push(['Providers','Service facility NPI',[.30,.929,.43,.943]],['Providers','Billing provider NPI',[.62,.929,.75,.943]]);
    regions.push(['Insurance','Insurance recipient address',[.54,.016,.95,.081]],['Clinical','Illness date',[.035,.490,.15,.507]],['Clinical','Illness date qualifier',[.205,.490,.24,.507]],['Providers','Signature date',[.095,.924,.18,.939]]);
    for(const [i,x0,x1] of [['A',.058,.15],['B',.21,.30],['C',.365,.44],['D',.51,.59]])regions.push(['Clinical',`Diagnosis ${i}`,[x0,.579,x1,.599]]);
  }
  if(page.type==='Hospital claim'){
    const candidates=neural.filter(t=>{
      const x=(t.bbox.x0+t.bbox.x1)/2/page.width,y=(t.bbox.y0+t.bbox.y1)/2/page.height;
      return x>.36&&x<.54&&y>.27&&y<.60&&/^\d{5}(?:[A-Z]{2})?[.]?$/.test(clean(t.text));
    }).sort((a,b)=>a.bbox.y0-b.bbox.y0);
    candidates.forEach((token,i)=>{
      const y=(token.bbox.y0+token.bbox.y1)/2/page.height;
      const group=`Service ${i+1}`,lo=y-.007,hi=y+.007;
      const specs=[['Service date from',.545,.625],['CPT / HCPCS',.365,.535],['Charge',.75,.835],['Days / units',.635,.72],['Revenue code',.02,.07],['Service description',.073,.36],['Non-covered charges',.84,.955]];
      for(const [label,x0,x1] of specs){const f=extract(group,label,[x0,lo,x1,hi]);
        if(f&&label==='CPT / HCPCS'){
          const match=clean(f.rawValue).match(/^(\d{5})([A-Z]{2})$/);
          if(match){f.value=match[1];f.status='format-checked';f.reason='Procedure and modifier separated from printed cell';fields.push({...f,label:'Modifiers',value:match[2]});}
        }
      }
      const revenue=readRegion(neural,[.02,lo,.07,hi],page.width,page.height).text;
      const description=readRegion(neural,[.073,lo,.36,hi],page.width,page.height).text;
      serviceLines.push({line:i+1,values:[],revenueCode:/^\d{4}$/.test(revenue)?revenue:'',description});
    });
  }
  if(page.type==='Hospital claim')for(const [i,x0,x1] of [[1,.035,.12],[2,.13,.21],[3,.22,.31]])regions.push(['Clinical',`Diagnosis ${i}`,[x0,.803,x1,.819]]);
  if(page.type==='Hospital claim')regions.push(
    ['Patient','Patient identifier',[.148,.078,.36,.089]],['Patient','City',[.383,.091,.51,.105]],['Patient','State',[.773,.091,.804,.105]],['Patient','ZIP code',[.819,.091,.87,.105]],['Patient','Sex',[.126,.119,.155,.135]],
    ['Admission','Type of bill',[.92,.031,.98,.045]],['Admission','Admission type',[.25,.119,.285,.135]],['Admission','Admission source',[.291,.119,.33,.135]],['Admission','Patient status',[.365,.119,.405,.135]],
    ['Financial','Total non-covered charges',[.88,.608,.95,.619]],['Services','Creation date',[.548,.605,.62,.619]],
    ['Providers','Hospital NPI',[.81,.622,.91,.635]],['Providers','Attending NPI',[.705,.848,.81,.862]],['Clinical','Patient reason for visit diagnosis',[.205,.833,.27,.849]],['Providers','Taxonomy code',[.345,.907,.45,.921]]);
  if(page.type==='Hospital claim')for(let i=0;i<3;i++){
    const y=.636+i*.0155,iy=.695+i*.014;
    if(!readRegion(neural,[.018,y,.28,y+.014],page.width,page.height).text.trim())continue;
    regions.push([`Payer ${i+1}`,'Payer name',[.018,y,.28,y+.014]],[`Payer ${i+1}`,'Health plan ID',[.29,y,.38,y+.014]],
      [`Payer ${i+1}`,'Release of information',[.470,y,.49,y+.014]],[`Payer ${i+1}`,'Assignment of benefits',[.505,y,.525,y+.014]],
      [`Payer ${i+1}`,'Insured name',[.018,iy,.32,iy+.014]],[`Payer ${i+1}`,'Relationship code',[.325,iy,.35,iy+.014]],
      [`Payer ${i+1}`,'Insured ID',[.36,iy,.59,iy+.014]]);
  }
  function extract(group,label,originalBox){
    const box=transform(originalBox);const a=readRegion(neural,box,page.width,page.height),b=readRegion(secondary,box,page.width,page.height);
    if(!a.text.trim()&&!b.text.trim()&&!['Release of information','Assignment of benefits'].includes(label))return null;
    const chosen=chooseReading(label,a,b);
    const f={group,label,...chosen,confidence:Math.round(Math.max(a.confidence,b.confidence)),rawValue:a.text,originalValue:a.text,alternatives:[a.text,b.text],bbox:{x0:box[0]*page.width,y0:box[1]*page.height,x1:box[2]*page.width,y1:box[3]*page.height}};
    fields.push(f);return f;
  }
  for(const [group,label,box] of regions)extract(group,label,box);
  if(page.type==='Professional claim'){
    const columns=[[.03,.13],[.13,.235],[.24,.272],[.274,.31],[.32,.396],[.397,.544],[.546,.604],[.632,.71],[.727,.758],[.76,.786],[.788,.813],[.82,.957]];
    const names=['Service date from','Service date to','Place of service','Emergency indicator','CPT / HCPCS','Modifiers','Diagnosis pointer','Charge','Days / units','EPSDT / family plan','ID qualifier','Rendering provider ID'];
    for(let i=0;i<6;i++){
      const top=.670+i*.031;
      const probe=readRegion(neural,transform([.32,top,.396,top+.019]),page.width,page.height);
      if(!normalizeReading('CPT / HCPCS',probe.text))continue;
      const values=columns.map(([x0,x1],c)=>extract(`Service ${i+1}`,names[c],[x0,top,x1,top+.019])?.value||'');
      serviceLines.push({line:i+1,values});
    }
  }
  // Payment totals use the detected CLAIM TOTALS row, with cells bounded by actual positions.
  if(page.type==='Payment explanation'){
    const boxOf=t=>[(t.bbox.x0-3)/page.width,(t.bbox.y0-3)/page.height,(t.bbox.x1+3)/page.width,(t.bbox.y1+3)/page.height];
    const take=(label,t,group='Payment details')=>t&&extract(group,label,boxOf(t));
    const glossary=neural.find(t=>/^GLOSSARY/i.test(t.text));
    const body=neural.filter(t=>!glossary||t.bbox.y0<glossary.bbox.y0);
    for(const [label,pattern] of [['Payment patient name',/^NAME/i],['Beneficiary ID',/^HIC\s/i],['Payment account number',/^ACNT\s/i],['Claim reference number',/^ICN/i],['Remark codes',/^MOA\s/i],['Payment provider NPI',/^NPI\s*#/i]])take(label,body.find(t=>pattern.test(t.text)));
    const nextOnRow=(anchor,predicate=()=>true)=>anchor&&body.filter(t=>t.bbox.x0>anchor.bbox.x1-2&&Math.abs((t.bbox.y0+t.bbox.y1-anchor.bbox.y0-anchor.bbox.y1)/2)<page.height*.004&&predicate(t)).sort((a,b)=>a.bbox.x0-b.bbox.x0)[0];
    const provider=body.find(t=>/^PR[OQ][VY]IDER/i.test(t.text));
    if(provider){
      const sender=body.filter(t=>t.bbox.x1<page.width*.42&&t.bbox.y1<provider.bbox.y0);
      if(sender.length)extract('Payment details','Payer / administrator address',[Math.min(...sender.map(t=>t.bbox.x0))/page.width,Math.min(...sender.map(t=>t.bbox.y0))/page.height-.001,Math.max(...sender.map(t=>t.bbox.x1))/page.width+.002,Math.max(...sender.map(t=>t.bbox.y1))/page.height+.001]);
      if(provider.bbox.y0>page.height*.1)extract('Payment details','Payee address',[.05,provider.bbox.y0/page.height-.002,.44,(provider.bbox.y0+page.height*.025)/page.height]);
    }
    take('Provider number',nextOnRow(provider,t=>/#?:?\d{5,}/.test(t.text)));
    const check=body.find(t=>/^CHECK\/EFT/i.test(t.text));
    take('Check / EFT number',nextOnRow(check,t=>/^\d{5,}$/.test(t.text.trim())));
    take('Payment date',body.find(t=>/^\d{2}\/\d{2}\/\d{4}$/.test(t.text.trim())&&(!check||t.bbox.y0<check.bbox.y1+10)));
    for(const [label,pattern] of [['Patient responsibility',/^PT\s*RESP/i],['Interest',/^INTEREST$/i],['Late filing charge',/^LATE\s*F[IIL]+ING\s*CHARGE/i],['Net payment',/^NET$/i]])take(label,nextOnRow(body.find(t=>pattern.test(t.text)),t=>/^-?\d+[.:]\d{2}$/.test(t.text.trim())));
    const checkHeading=body.find(t=>/^CHECK$/.test(t.text.trim()));
    if(checkHeading){
      const candidates=body.filter(t=>t.bbox.y0>checkHeading.bbox.y1&&t.bbox.y0<checkHeading.bbox.y1+page.height*.04&&/^-?\d+(?:[.:]\d{2})?$/.test(t.text.trim()));
      const checkValue=candidates.filter(t=>Math.abs((t.bbox.x0+t.bbox.x1-checkHeading.bbox.x0-checkHeading.bbox.x1)/2)<page.width*.04).sort((a,b)=>a.bbox.y0-b.bbox.y0)[0];
      if(checkValue){
        const row=candidates.filter(t=>Math.abs(t.bbox.y0-checkValue.bbox.y0)<page.height*.006).sort((a,b)=>a.bbox.x0-b.bbox.x0);
        if(row.length===9){const labels=['Number of claims','Statement billed amount','Statement allowed amount','Statement deductible','Statement coinsurance','Statement adjustments total','Statement provider paid','Provider adjustment amount','Check amount'];row.forEach((t,i)=>take(labels[i],t,'Statement totals'));}
        else take('Check amount',checkValue,'Statement totals');
      }
    }
    const codes=body.filter(t=>/^(CO|PR|OA|PI)-?\d{1,3}$/.test(t.text.trim()));
    codes.forEach((t,i)=>{take('Adjustment code',t,`Adjustment ${i+1}`);take('Adjustment amount',nextOnRow(t,v=>/^-?\d+\.\d{2}$/.test(v.text.trim())),`Adjustment ${i+1}`);});
    const patient=body.find(t=>/^NAME/i.test(t.text));
    const totals=body.find(t=>/CLAIM\s*TOTALS/i.test(t.text));
    if(patient&&totals){
      const detail=body.filter(t=>t.bbox.y0>patient.bbox.y1&&t.bbox.y1<totals.bbox.y0+3&&t.bbox.x0<page.width*.6&&/\d/.test(t.text));
      const y=detail.length?(detail[0].bbox.y0+detail[0].bbox.y1)/2/page.height:null;
      if(y){
        const professional=body.some(t=>/^PROC\s+MODS/.test(t.text));
        const columns=professional?[['Rendering provider ID',.05,.113],['Service dates as printed',.115,.18],['Place of service',.181,.20],['Days / units',.205,.23],['CPT / HCPCS',.27,.31],['Modifiers',.31,.35],['Billed amount',.37,.415],['Allowed amount',.43,.475],['Deductible',.49,.525],['Coinsurance',.575,.609],['Provider paid',.84,.875]]:[['Service dates as printed',.135,.216],['Place / type of service',.216,.247]];
        columns.forEach(([label,x0,x1])=>extract('Remittance service',label,[x0,y-.006,x1,y+.006]));
      }
    }
    if(glossary){const bottom=Math.min(.80,...neural.filter(t=>/RECEIVED/.test(t.text)&&t.bbox.y0>glossary.bbox.y1).map(t=>t.bbox.y0/page.height));
      page.explanations=readRegion(neural,[.04,glossary.bbox.y1/page.height,.94,bottom],page.width,page.height).text;
    }
    const anchor=neural.find(t=>/CLAIM\s*TOTALS/i.test(t.text));
    if(anchor){
      const y=(anchor.bbox.y0+anchor.bbox.y1)/2;
      const amounts=neural.filter(t=>t.bbox.x0>anchor.bbox.x1&&Math.abs((t.bbox.y0+t.bbox.y1)/2-y)<page.height*.008&&/\d/.test(t.text)).sort((a,b)=>a.bbox.x0-b.bbox.x0);
      if(amounts.length===6){
        const labels=['Billed amount','Allowed amount','Deductible','Coinsurance','Adjustments total','Provider paid'];
        amounts.forEach((t,i)=>extract('Claim payment totals',labels[i],[(t.bbox.x0-3)/page.width,(t.bbox.y0-3)/page.height,(t.bbox.x1+3)/page.width,(t.bbox.y1+3)/page.height]));
      }else warnings.push('Could not separate all six payment totals reliably; check the original statement.');
    }
  }
  return {fields,serviceLines,warnings,checkboxRequests};
}

export function applyCheckboxes(pages,results){
  for(const result of results){
    const page=pages.find(p=>p.number===result.page);if(!page)continue;
    const selected=result.options.filter(o=>o.state==='selected');
    const uncertain=result.options.some(o=>o.state==='uncertain')||selected.length>1;
    const boxes=result.options.map(o=>o.bbox);
    const field={group:'Checkbox selections',label:result.label,value:uncertain?'':selected.length?selected[0].label:'None selected',status:uncertain?'uncertain':'checkbox-read',reason:uncertain?'Checkbox marks need review':selected.length?'Cross detected inside the selected box':'All boxes are blank',kind:'checkbox',options:result.options,alternatives:[],rawValue:result.options.map(o=>o.label+': '+o.state).join('; '),bbox:{x0:Math.min(...boxes.map(b=>b.x0)),y0:Math.min(...boxes.map(b=>b.y0)),x1:Math.max(...boxes.map(b=>b.x1)),y1:Math.max(...boxes.map(b=>b.y1))}};
    page.fields.push(field);
  }
}
