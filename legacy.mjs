// CMS-1500 08/05 has different field rows, diagnosis numbering and box 30 semantics.
// Coordinates refer to the printed 720 x 864 reference form, never to test values.
export function extractLegacy(neural,secondary,page,{readRegion,chooseReading,normalizeReading}){
  const key=s=>s.toUpperCase().replace(/[^A-Z0-9]/g,'');
  const patient=neural.find(t=>/^2PATIENT/.test(key(t.text))&&/NAME/.test(key(t.text)));
  const insured=neural.find(t=>/^4INSURED/.test(key(t.text))&&/NAME/.test(key(t.text)));
  const tax=neural.find(t=>/^25FEDERAL/.test(key(t.text)));
  if(!patient||!insured||!tax)return {fields:[],serviceLines:[],checkboxRequests:[],warnings:['The 08/05 form could not be aligned reliably. No values were guessed.']};
  const sx=(insured.bbox.x0-patient.bbox.x0)/(410-60),sy=(tax.bbox.y0-patient.bbox.y0)/(709-159);
  const dx=patient.bbox.x0-60*sx,dy=patient.bbox.y0-159*sy;
  if(sx<=0||sy<=0||sx/sy<.8||sx/sy>1.2)return {fields:[],serviceLines:[],checkboxRequests:[],warnings:['Form alignment needs review.']};
  const box=([x0,y0,x1,y1])=>({x0:x0*sx+dx,y0:y0*sy+dy,x1:x1*sx+dx,y1:y1*sy+dy});
  const fields=[],serviceLines=[],checkboxRequests=[];
  function get(group,label,rect){
    const b=box(rect),region=[b.x0/page.width,b.y0/page.height,b.x1/page.width,b.y1/page.height];
    const a=readRegion(neural,region,page.width,page.height),c=readRegion(secondary,region,page.width,page.height);
    if(!a.text.trim()&&!c.text.trim())return;
    const result=chooseReading(label,a,c);
    const f={group,label,...result,confidence:Math.round(Math.max(a.confidence,c.confidence)),sourceReadings:[a,c],rawValue:a.text,originalValue:a.text,alternatives:[a.text,c.text],bbox:b};fields.push(f);return f;
  }
  for(const [g,l,r] of [
    ['Patient','Patient name',[60,165,263,178]],['Patient','Date of birth',[275,170,342,178]],['Patient','Address',[60,190,263,202]],['Patient','City',[60,215,236,225]],['Patient','State',[240,215,263,225]],['Patient','ZIP code',[60,238,148,250]],
    ['Insurance','Insured ID',[412,141,625,154]],['Insurance','Insured name',[412,165,625,178]],
    ['Identifiers','Tax ID',[60,715,169,728]],['Identifiers','Patient account',[216,715,317,728]],
    ['Financial','Total charge',[424,715,488,728]],['Financial','Amount paid on claim',[504,715,556,728]],['Financial','Balance due',[568,715,625,728]],
    ['Providers','Service facility',[216,744,407,779]],['Providers','Service facility NPI',[224,781,296,792]],['Providers','Billing provider NPI',[415,781,491,792]]
  ])get(g,l,r);
  for(const [i,x,y] of [[1,75,503],[2,75,526],[3,266,503],[4,266,526]])get('Clinical','ICD-9 diagnosis '+i,[x,y,x+83,y+12]);
  const names=['Service date from','Service date to','Place of service','Emergency indicator','CPT / HCPCS','Modifiers','Diagnosis pointer','Charge','Days / units','EPSDT / family plan','ID qualifier','Rendering provider ID'];
  const columns=[[60,119],[122,180],[186,207],[209,229],[233,281],[283,371],[374,407],[416,472],[484,502],[504,516],[518,536],[539,625]];
  for(let i=0;i<6;i++){
    const y=575+i*24,b=box([233,y,281,y+13]),region=[b.x0/page.width,b.y0/page.height,b.x1/page.width,b.y1/page.height];
    const a=readRegion(neural,region,page.width,page.height),c=readRegion(secondary,region,page.width,page.height);
    if(!normalizeReading('CPT / HCPCS',a.text)&&!normalizeReading('CPT / HCPCS',c.text))continue;
    const values=columns.map(([x0,x1],j)=>get('Service '+(i+1),names[j],[x0,y,x1,y+13])?.value||'');
    serviceLines.push({line:i+1,values});
  }
  const checks=[
    ['Insurance type',149,[['Medicare',63.5],['Medicaid',112],['TRICARE',163],['CHAMPVA',227],['Group health plan',278],['FECA',336],['Other',379]]],
    ['Patient sex',173,[['Male',357],['Female',393]]],['Relationship to insured',197,[['Self',293],['Spouse',329],['Child',357],['Other',393]]],
    ['Employment-related',293,[['Yes',307],['No',350]]],['Auto accident',317,[['Yes',307],['No',350]]],['Other accident',341,[['Yes',307],['No',350]]],
    ['Insured sex',293,[['Male',544],['Female',595]]],['Another health benefit plan',365,[['Yes',429],['No',465]]],['Outside laboratory',485,[['Yes',430],['No',467]]],
    ['Tax ID type',724,[['SSN',179],['EIN',193]]],['Accept assignment',724,[['Yes',328],['No',364]]]
  ];
  for(const [label,y,options] of checks)checkboxRequests.push({label,options:options.map(([label,x])=>({label,bbox:box([x-6,y-6,x+6,y+6])}))});
  return {fields,serviceLines,checkboxRequests,warnings:[]};
}
