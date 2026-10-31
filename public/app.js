import {formatFieldDate} from './date-format.js';
import {apiFetch as fetch,confirmAction,setLeaveWarning} from './session.js';
const $=id=>document.getElementById(id);

const drafts=new Map();let saving=false,exporting=false;

const editingFields=new Set();let editAll=false;

$('edit-all').onclick=()=>{if(saving)return;editAll=!editAll;editingFields.clear();$('edit-all').textContent=editAll?'Finish editing':'Edit all';renderPage();};

function updateDraftState(){

 $('save-edits').disabled=!drafts.size||saving;$('discard-edits').disabled=!drafts.size||saving;

 $('edit-status').textContent=saving?'Saving changes…':drafts.size?`${drafts.size} unsaved changes`:'All changes saved';

 for(const id of ['download-excel','download-text','download-json'])$(id).disabled=!!drafts.size||saving||exporting;

}

$('save-edits').onclick=async()=>{

 if(saving||!drafts.size)return;saving=true;updateDraftState();document.querySelectorAll('.edit-field input,.edit-field textarea,.edit-field select').forEach(e=>e.disabled=true);

 try{for(const [key,change] of [...drafts]){

 const response=await fetch(`/api/documents/${doc.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...change,version:doc.version||0})});

 const result=await response.json();if(!response.ok)throw Error(result.error);

 if(result.version!==undefined)doc.version=result.version;if(result.verification)doc.verification=result.verification;if(result.pages)doc.pages=result.pages;Object.assign(doc.pages[change.page].fields[change.field],result.field);if(result.serviceLines)doc.pages[change.page].serviceLines=result.serviceLines;drafts.delete(key);

 }$('error').hidden=true;}catch(e){error(e.message+' Unsaved changes have been kept.');}

 finally{saving=false;if(!drafts.size){editAll=false;editingFields.clear();$('edit-all').textContent='Edit all';}updateDraftState();renderStats();renderPage();}

};

$('discard-edits').onclick=async()=>{if(!await confirmAction({title:'Discard changes?',message:'Your unsaved edits will be lost. Saved document information will remain unchanged.',confirmLabel:'Discard changes',danger:true}))return;drafts.clear();editingFields.clear();editAll=false;$('edit-all').textContent='Edit all';updateDraftState();renderPage();};

setLeaveWarning(()=>saving?'Changes are still being saved. Wait for saving to finish before leaving.':drafts.size?'Your unsaved document edits will be lost. Save them first if you want to keep them.':'');

let doc, selected=-1, mode='organized', timer, busy=false, activeId=null, started=Date.now(), lastChange=Date.now(), lastStage='';

const el=(tag, text, cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};

function error(message){$('error').textContent=message;$('error').hidden=false;}

function highlight(container,text){

  const q=$('search').value.trim();

  if(!q){container.textContent=text;return;}

  let start=0,index;const lower=text.toLowerCase();

  while((index=lower.indexOf(q.toLowerCase(),start))!==-1){container.append(document.createTextNode(text.slice(start,index)),el('mark',text.slice(index,index+q.length)));start=index+q.length;}

  container.append(document.createTextNode(text.slice(start)));

}

let pendingFile,previewUrl;

function discardPreview(){

 $('confirm-preview').removeAttribute('src');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;pendingFile=null;$('confirmation').hidden=true;

}

function upload(file){

 if(!file||busy)return;

 if(!/\.pdf$/i.test(file.name)||file.size>30*1024*1024||!file.size)return error('Choose a non-empty PDF under 30 MB.');

 discardPreview();pendingFile=file;previewUrl=URL.createObjectURL(file);

 $('confirm-preview').src=previewUrl;$('confirm-open').href=previewUrl;

 $('confirm-name').textContent=file.name;$('confirm-size').textContent=`${(file.size/1024/1024).toFixed(2)} MB`;

 $('welcome').hidden=true;$('error').hidden=true;$('confirmation').hidden=false;$('confirm-process').focus();

}

$('confirm-process').onclick=()=>{if(!pendingFile||busy)return;const file=pendingFile;discardPreview();void processUpload(file);};

$('confirm-back').onclick=()=>{discardPreview();$('welcome').hidden=false;$('file').focus();};

$('confirm-file').onchange=e=>{upload(e.target.files[0]);e.target.value='';};

async function processUpload(file){

  if(!file||busy)return;

  $('error').hidden=true;

  if(!/\.pdf$/i.test(file.name))return error('Please choose a PDF file.');

  if(file.size>30*1024*1024)return error('This file is too large. Choose a PDF under 30 MB.');

  busy=true;$('welcome').hidden=true;$('results').hidden=true;$('processing').hidden=false;

  started=Date.now();lastChange=started;lastStage='';$('cancel-job').disabled=true;$('replace-file').disabled=true;

  $('processing-name').textContent=file.name;$('progress-label').textContent='Uploading to the local reader…';$('progress').value=0;

  try{

    const response=await fetch('/api/documents',{method:'POST',headers:{'Content-Type':'application/pdf','X-File-Name':encodeURIComponent(file.name)},body:file});

    const result=await response.json();if(!response.ok)throw Error(result.error);

    activeId=result.id;sessionStorage.setItem('documentId',result.id);$('cancel-job').disabled=false;$('replace-file').disabled=false;poll(result.id);

  }catch(e){busy=false;$('processing').hidden=true;$('welcome').hidden=false;error(e.message);}

}

async function poll(id){

  clearTimeout(timer);

  try{

    const response=await fetch(`/api/documents/${id}`);const data=await response.json();if(!response.ok)throw Error(data.error);

    if(activeId!==id)return;

    if(data.status==='error')throw Error(data.message);

    if(data.status==='complete'){

      doc=data;busy=false;selected=-1;$('processing').hidden=true;$('welcome').hidden=true;$('results').hidden=false;

      $('filename').textContent=doc.name;$('document-meta').textContent=doc.reviewApplied?`${doc.pages.length} pages · Saved review of this exact PDF · Checked against original`:`${doc.pages.length} pages · English OCR · All original pages included`;

      renderStats();renderNav();renderPage();return;

    }

    busy=true;$('welcome').hidden=true;$('processing').hidden=false;$('processing-name').textContent=data.name;

    const verifying=data.verifyTotal&&data.message.startsWith('Zooming');

    $('progress-label').textContent=verifying?`Checking extracted fields: ${data.verified||0} of ${data.verifyTotal}`:data.message;

    const stage=data.message+'|'+data.completed+'|'+data.pageProgress+'|'+data.verified;if(stage!==lastStage){lastChange=Date.now();lastStage=stage;}

    $('cancel-job').disabled=false;$('replace-file').disabled=false;

    // OCR page completion is not whole-job completion: close-up checks follow it.

    if(verifying)$('progress').value=70+25*(data.verified||0)/data.verifyTotal;

    else if(data.total)$('progress').value=Math.min(95,10+data.completed/data.total*60+(data.pageProgress||0)/100*20/data.total);else $('progress').removeAttribute('value');

    timer=setTimeout(()=>poll(id),1000);

  }catch(e){if(activeId!==id)return;error(e.message||'Connection lost.');$('progress-label').textContent='Unable to update progress. You can retry or cancel.';$('cancel-job').disabled=false;$('replace-file').disabled=false;}

}

setInterval(()=>{if(!busy)return;const seconds=Math.floor((Date.now()-started)/1000);$('elapsed').textContent=`${Math.floor(seconds/60)}m ${seconds%60}s elapsed`;$('slow-note').hidden=Date.now()-lastChange<45000;},1000);

async function clearDocument(){

 if(saving)throw Error('Please wait for your changes to finish saving.');
 if(exporting)throw Error('Please wait for your download to finish preparing.');

 if((activeId||doc?.id)&&!await confirmAction({title:busy?'Cancel processing?':'Close this document?',message:busy?'Processing will stop and this upload will be removed. You can upload another PDF afterward.':'This removes the current document and its saved results from the portal.'+(drafts.size?' Unsaved edits will also be lost.':'')+' Download any information you need before continuing.',confirmLabel:busy?'Cancel processing':'Close document',danger:true}))return false;

 const id=activeId||doc?.id;

 if(id){const r=await fetch(`/api/documents/${id}`,{method:'DELETE'});if(!r.ok&&r.status!==404)throw Error('Could not cancel. Please retry.');}

 drafts.clear();editingFields.clear();editAll=false;$('edit-all').textContent='Edit all';updateDraftState();activeId=null;clearTimeout(timer);sessionStorage.removeItem('documentId');doc=undefined;busy=false;

 $('processing').hidden=true;$('results').hidden=true;$('welcome').hidden=false;$('error').hidden=true;$('search').value='';$('review-only').checked=false;$('source-close').click();selected=-1;mode='organized';return true;

}

$('cancel-job').onclick=async()=>{try{$('cancel-job').disabled=true;await clearDocument();}catch(e){error(e.message);}finally{$('cancel-job').disabled=false;}};

$('replace-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(!/\.pdf$/i.test(file.name)||file.size>30*1024*1024)return error('Choose a PDF under 30 MB.');try{if(await clearDocument())await upload(file);}catch(e){error(e.message);}};

$('retry-job').onclick=()=>{if(activeId){$('error').hidden=true;poll(activeId);}};

function renderStats(){

 renderVerification();

 const fields=doc.pages.flatMap(p=>p.fields||[]);$('stat-pages').textContent=doc.pages.length;$('stat-fields').textContent=fields.length;$('stat-services').textContent=doc.pages.reduce((n,p)=>n+(p.serviceLines?.length||0),0);$('stat-review').textContent=fields.filter(f=>(f.verification?f.verification.status==='attention':!f.value&&!f.reviewed)).length;

}

function renderNav(){

  const nav=$('page-nav');nav.replaceChildren();const q=$('search').value.trim().toLowerCase();let matches=0;

  const all=el('button','All pages',selected===-1?'active':'');all.setAttribute('aria-current',selected===-1?'page':'false');all.onclick=()=>{selected=-1;renderNav();renderPage();};nav.append(all);

  doc.pages.forEach((page,index)=>{

    const searchable=[page.text,...(page.fields||[]).map(f=>f.label+' '+f.value+' '+formatFieldDate(f.value,f.label)),page.explanations||''].join('\n').toLowerCase();

    const match=!q||searchable.includes(q);if(q&&match)matches++;

    const b=el('button',`Page ${page.number}`,selected===index?'active':'');b.append(el('small',page.type));

    if(q&&match)b.append(el('small','Matching text'));

    b.setAttribute('aria-current',selected===index?'page':'false');b.onclick=()=>{selected=index;$('review-only').checked=false;renderNav();renderPage();};nav.append(b);

  });

  $('search-count').textContent=q?`${matches} of ${doc.pages.length} pages match`:'';

}

function renderPage(){

  $('organized-tab').setAttribute('aria-selected',mode==='organized');$('text-tab').setAttribute('aria-selected',mode==='text');

  $('review').hidden=selected===-1||mode==='organized';$('source-toggle').hidden=false;document.querySelector('.tabs').hidden=selected===-1;

  setSourcePage(selected>=0?selected:sourceIndex);

  if(selected===-1||mode==='organized')return renderAll();

  const page=doc.pages[selected];$('page-label').textContent=`PAGE ${page.number} OF ${doc.pages.length}`;$('page-type').textContent=page.type;

  $('organized-tab').setAttribute('aria-selected',mode==='organized');$('text-tab').setAttribute('aria-selected',mode==='text');

  const container=$('page-content');container.replaceChildren();

  if(mode==='text'){container.append(el('p','Raw OCR is retained for reference. Use the organized view for reviewed values.','notice'));const pre=el('pre');highlight(pre,page.text||'No readable text detected. Please check the original page.');container.append(pre);}

  else {

    for(const warning of page.warnings||[])container.append(el('p',warning,'notice'));

    if(page.serviceLines?.length){

      const section=el('section',undefined,'content-section');section.append(el('h3','Services'));

      const wrap=el('div',undefined,'table-scroll'),table=el('table',undefined,'services-table'),head=el('tr');

      const hospital=page.type==='Hospital claim';

      const headers=hospital?['Line','Revenue code','Description','CPT / HCPCS','Modifiers','Service date','Units','Total charges','Non-covered charges']:['Line','From','To','Place of service','CPT / HCPCS','Modifiers','Diagnosis pointer','Charge','Units','Rendering provider ID'];

      for(const title of headers)head.append(el('th',title));table.append(head);

      for(const row of page.serviceLines){const tr=el('tr');const values=hospital?[row.line,row.revenueCode,row.description,row.values[4],row.values[5],row.values[0],row.values[8],row.values[7],row.nonCovered]:[row.line,row.values[0],row.values[1],row.values[2],row.values[4],row.values[5],row.values[6],row.values[7],row.values[8],row.values[11]];for(const v of values)tr.append(el('td',v||'—'));table.append(tr);}

      wrap.append(table);section.append(el('p','Scroll the table sideways to see all columns.'),wrap);container.append(section);

    }

    if(page.fields?.length){

      const displayGroup=f=>(f.verification?f.verification.status==='attention':!f.value&&!f.reviewed)?'Needs review':f.group;

      const groups=[...new Set(page.fields.map(displayGroup))].sort((a,b)=>(a==='Needs review')-(b==='Needs review'));

      for(const group of groups){

        const collapsed=group==='Needs review'||/^Service \d+$/.test(group);

        const s=el(collapsed?'details':'section',undefined,'content-section');s.append(el(collapsed?'summary':'h3',group==='Needs review'?`Needs review (${page.fields.filter(f=>(f.verification?f.verification.status==='attention':!f.value&&!f.reviewed)).length} fields)`:group));const grid=el('div',undefined,'field-grid');

        for(const field of page.fields.filter(f=>displayGroup(f)===group)){

          const card=el('div',undefined,'field-card');card.append(el('span',field.label,'field-label'));

          const value=el('strong');highlight(value,field.value||'Not reliably read');card.append(value);

          card.append(el('small',field.reviewed?'Checked against original':field.reason||'Verify against original'));

          if(field.kind==='checkbox'){const choices=el('ul');for(const option of field.options||[])choices.append(el('li',`${option.label}: ${option.state==='selected'?'Selected (crossed)':option.state==='unselected'?'Not selected':'Needs review'}`));card.append(choices);}

          const controls=el('div',undefined,'field-controls');const source=el('button',`Page ${page.number} ↗`);source.onclick=()=>showSource(field.bbox);controls.append(source);

          const edit=el('button','Review / edit');edit.onclick=()=>{

            if(drafts.size)return error('Save changes in the form before editing this page.');

            showSource(field.bbox);const input=el('textarea');input.value=field.value||field.rawValue||'';input.setAttribute('aria-label',field.label);input.rows=4;

            const save=el('button','Save reviewed value');const cancel=el('button','Cancel');const actions=el('div',undefined,'field-controls');actions.append(save,cancel);

            card.replaceChildren(el('span',field.label,'field-label'),input,actions);input.focus();

            cancel.onclick=renderPage;

            save.onclick=async()=>{

              try{save.disabled=true;const response=await fetch(`/api/documents/${doc.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:selected,field:page.fields.indexOf(field),value:input.value})});const result=await response.json();if(!response.ok)throw Error(result.error);if(result.version!==undefined)doc.version=result.version;if(result.verification)doc.verification=result.verification;if(result.pages)doc.pages=result.pages;Object.assign(field,result.field);if(result.serviceLines)page.serviceLines=result.serviceLines;renderStats();renderPage();}

              catch(e){save.disabled=false;error(e.message);}

            };

          };controls.append(edit);card.append(controls);grid.append(card);

        }s.append(grid);container.append(s);

      }

    }

    if(page.explanations){const notes=el('details',undefined,'content-section');notes.append(el('summary','Payment explanations from the statement'),el('p',page.explanationsReviewed?'Checked against the original PDF.':'Transcribed by OCR; compare unclear wording with the original.'));const pre=el('pre');highlight(pre,page.explanations);notes.append(pre);container.append(notes);}

    if(!page.fields?.length&&!page.warnings?.length)container.append(el('p','No structured claim fields detected. View the full page text or original for this document.','empty'));

  }

  if(!page.text.trim())container.append(el('p','No readable text detected. Check the original page.','empty'));

  $('review-label').textContent='Advanced: low-confidence words in full-page OCR';

  $('review').open=false;$('review-words').replaceChildren();

  page.uncertain.forEach(word=>{const b=el('button',word.text);b.title=`OCR confidence: ${word.confidence}%`;b.onclick=()=>showSource(word.bbox);$('review-words').append(b);});

  $('source-image').src=`/api/documents/${doc.id}/page-${page.number}.png`;$('source-image').alt=`Original page ${page.number} of ${doc.name}`;

  $('source-page').textContent=page.number;$('original-link').href=`/api/documents/${doc.id}/original.pdf#page=${page.number}`;$('source-marker').hidden=true;

}

function renderVerification(){

 const v=doc.verification,box=$('verification-result');box.replaceChildren();if(!v)return;box.append(el('strong',v.status==='passed'?'Automatic checks passed':'Automatic checks: needs attention'));box.append(el('p',`${v.passedFields} of ${v.checkedFields} fields passed. ${v.issues.length} issues found. Checks run automatically; only flagged items need attention.`));

 if(v.issues.length){const details=el('details');details.append(el('summary','Show issues'));const list=el('ul');for(const i of v.issues){const item=el('li'),button=el('button',`Page ${i.page}: ${i.field===null?'Page check':doc.pages.find(p=>p.number===i.page)?.fields[i.field]?.label} — ${i.message}`);button.onclick=()=>{selected=doc.pages.findIndex(p=>p.number===i.page);mode='organized';renderNav();renderPage();if(i.field!==null){const input=document.getElementById('entry-'+selected+':'+i.field);input?.parentElement.querySelector('.field-display')?.click();input?.parentElement.scrollIntoView({block:'center'});}};item.append(button);list.append(item);}details.append(list);box.append(details);}

 box.append(el('small','Checks passed means the configured checks passed; it does not guarantee every value matches the source. Corrections are rechecked when saved.'));

}

function renderAll(){

 $('page-label').textContent=selected<0?'DOCUMENT OVERVIEW':`PAGE ${selected+1} OF ${doc.pages.length}`;$('page-type').textContent='Editable extracted data';

 const container=$('page-content');container.replaceChildren();const q=$('search').value.trim().toLowerCase();let count=0;

 doc.pages.forEach((page,index)=>{

  if(selected>=0&&selected!==index)return;

  const fields=(page.fields||[]).filter(f=>(!$('review-only').checked||((f.verification?f.verification.status==='attention':!f.value&&!f.reviewed)))&&(!q||[f.group,f.label,f.value,formatFieldDate(f.value,f.label)].join(' ').toLowerCase().includes(q)));

  const explanation=page.explanations&&!$('review-only').checked&&(!q||page.explanations.toLowerCase().includes(q));

  if(!fields.length&&!explanation&&(q||$('review-only').checked))return;

  const section=el('section',undefined,'overview-page'),heading=el('div',undefined,'overview-heading');heading.append(el('h3',`Page ${page.number} · ${page.type}`));

  section.append(heading);

  for(const warning of page.warnings||[])section.append(el('p',warning,'notice'));

  if(fields.length){

   for(const group of [...new Set(fields.map(f=>f.group))]){

    const groupBox=el('fieldset',undefined,'edit-group');groupBox.append(el('legend',group));const grid=el('div',undefined,'edit-grid');

    for(const f of fields.filter(f=>f.group===group)){

     count++;const fi=page.fields.indexOf(f),key=index+':'+fi,wrap=el('div',undefined,'edit-field');

     const label=el('label',f.label);label.htmlFor='entry-'+key;wrap.append(label);

     let input;

     if(f.kind==='checkbox'){input=el('select');input.append(new Option('Choose an option',''));input.append(new Option('None selected','None selected'));for(const o of f.options||[])input.append(new Option(o.label,o.label));}

     else{input=el(f.value?.includes('\n')||/address|facility/i.test(f.label)?'textarea':'input');if(input.tagName==='INPUT')input.type='text';else input.rows=2;input.maxLength=4000;}

     input.id='entry-'+key;input.value=drafts.get(key)?.value??formatFieldDate(f.value??'',f.label);input.placeholder='Not reliably read';input.disabled=saving;

     const selectField=()=>{document.querySelectorAll('.edit-field.selected-field').forEach(e=>e.classList.remove('selected-field'));wrap.classList.add('selected-field');setSourcePage(index);markSource(f.bbox);};

     input.onfocus=selectField;

     const unlocked=editAll||editingFields.has(key);input.hidden=!unlocked;

     const display=el('button',input.value||(f.blankConfirmed?'Blank (optional)':'Not reliably read'),'field-display');display.type='button';display.hidden=unlocked;display.onclick=selectField;display.setAttribute('aria-label',`${f.label}: ${input.value||(f.blankConfirmed?'Blank (optional)':'Not reliably read')}. Show in original`);

     const edit=el('button',undefined,'field-edit-button');const editIcon=el('img');editIcon.src='/icons/'+(unlocked?'check':'pencil')+'.svg';editIcon.alt='';editIcon.width=16;editIcon.height=16;edit.append(editIcon);edit.title=unlocked?'Finish editing':'Edit field';edit.type='button';edit.disabled=saving||editAll;edit.setAttribute('aria-label',`${unlocked?'Finish editing':'Edit'} ${f.label}`);

     edit.onclick=()=>{if(editingFields.has(key))editingFields.delete(key);else{editingFields.clear();editingFields.add(key);}renderPage();const target=document.getElementById('entry-'+key);if(!target.hidden)target.focus();else target.parentElement.querySelector('.field-display').focus();};

     const status=el('small',drafts.has(key)?'Unsaved change':f.reviewed?'Reviewed':f.blankConfirmed?'Blank (optional)':f.value?'Extracted':'Needs review');

     input.oninput=()=>{if(input.value===formatFieldDate(f.value??'',f.label))drafts.delete(key);else drafts.set(key,{page:index,field:fi,value:input.value});status.textContent=drafts.has(key)?'Unsaved change':f.reviewed?'Reviewed':f.blankConfirmed?'Blank (optional)':f.value?'Extracted':'Needs review';updateDraftState();};

     if(f.verification?.status==='attention'){status.textContent='Needs attention';status.title=f.verification.messages.join(' ');wrap.classList.add('verification-issue');}const control=el('div',undefined,'field-control');control.append(display,input,edit);wrap.append(control,status);grid.append(wrap);

    }groupBox.append(grid);section.append(groupBox);

   }

  }else section.append(el('p','No structured fields on this page. Open the page to read its full text.','muted'));

  if(explanation){const notes=el('details',undefined,'content-section');notes.append(el('summary','Payment explanations'));const text=el('pre');highlight(text,page.explanations);notes.append(text);section.append(notes);}

  container.append(section);

 });

 $('search-count').textContent=`${count} fields shown`;

 if(!container.children.length)container.append(el('p','No fields match your filters.','empty'));

}

let sourceIndex=0;

function setSourcePage(index){

 if(!doc)return;sourceIndex=Math.max(0,Math.min(index,doc.pages.length-1));const page=doc.pages[sourceIndex];

 const select=$('source-select');select.replaceChildren();doc.pages.forEach((p,i)=>select.append(new Option(`Page ${p.number} · ${p.type}`,String(i))));select.value=String(sourceIndex);

 $('source-image').src=`/api/documents/${doc.id}/page-${page.number}.png`;$('source-image').alt=`Original page ${page.number}`;

 $('source-page').textContent=page.number;$('original-link').href=`/api/documents/${doc.id}/original.pdf#page=${page.number}`;$('source-marker').hidden=true;

 $('source-panel').hidden=false;$('source-toggle').hidden=true;document.querySelector('.workspace').classList.add('with-source');

}

function markSource(box){

 if(!box)return;const p=doc.pages[sourceIndex],m=$('source-marker');Object.assign(m.style,{left:`${box.x0/p.width*100}%`,top:`${box.y0/p.height*100}%`,width:`${(box.x1-box.x0)/p.width*100}%`,height:`${(box.y1-box.y0)/p.height*100}%`});m.hidden=false;

}

$('source-select').onchange=e=>{selected=Number(e.target.value);mode='organized';$('review-only').checked=false;renderNav();renderPage();};

$('source-zoom').oninput=e=>{document.querySelector('.source-image').style.width=e.target.value+'%';$('zoom-value').textContent=e.target.value+'%';};

function showSource(box){

  setSourcePage(selected>=0?selected:sourceIndex);markSource(box);

  $('source-panel').hidden=false;$('source-toggle').hidden=true;document.querySelector('.workspace').classList.add('with-source');

}

async function download(format){
 if(exporting||saving||drafts.size||!doc)return;
 const snapshot=structuredClone(doc),raw=$('include-raw').checked,button=$(format==='txt'?'download-text':'download-json'),label=button.textContent;
 exporting=true;updateDraftState();button.textContent='Preparing…';$('error').hidden=true;
 try{
  const response=await fetch(`/api/documents/${snapshot.id}/exports/${format}`,{method:'POST'});if(!response.ok)throw Error((await response.json()).error);
  const pages=raw?snapshot.pages:snapshot.pages.map(p=>({number:p.number,type:p.type,fields:p.fields.map(f=>({group:f.group,label:f.label,value:f.value,status:f.status})),serviceLines:p.serviceLines,explanations:p.explanations,warnings:p.warnings}));
  const text=format==='json'?JSON.stringify({filename:snapshot.name,pages},null,2):`${snapshot.name}\n\n`+snapshot.pages.map(p=>`PAGE ${p.number} — ${p.type}\n${(p.fields||[]).map(f=>`${f.label}: ${f.value||(f.reviewed||f.blankConfirmed?'':'Needs review')}`).join('\n')}\n${raw?'\nPAGE TEXT\n'+p.text:''}\n`).join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:format==='json'?'application/json':'text/plain;charset=utf-8'}));const a=el('a');a.href=url;a.download=snapshot.name.replace(/\.pdf$/i,'')+`.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){error(e.message||'Export failed. Please try again.');}
 finally{exporting=false;button.textContent=label;updateDraftState();}
}

$('file').onchange=e=>{upload(e.target.files[0]);e.target.value='';};

const drop=$('dropzone');for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('drag');});

for(const name of ['dragleave','drop'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('drag');});drop.addEventListener('drop',e=>upload(e.dataTransfer.files[0]));

$('search').oninput=()=>{selected=-1;renderNav();renderPage();};

$('review-only').onchange=()=>{selected=-1;renderNav();renderPage();};

$('organized-tab').onclick=()=>{mode='organized';renderPage();};$('text-tab').onclick=()=>{mode='text';renderPage();};

$('source-toggle').onclick=()=>showSource();$('source-close').onclick=()=>{$('source-panel').hidden=true;$('source-toggle').hidden=false;document.querySelector('.workspace').classList.remove('with-source');};

const exportMenu=document.querySelector('.export-menu');
function closeExportMenu(restoreFocus=false){exportMenu.open=false;if(restoreFocus)exportMenu.querySelector('summary').focus();}
document.addEventListener('click',event=>{if(exportMenu.open&&!exportMenu.contains(event.target))closeExportMenu();});
exportMenu.addEventListener('keydown',event=>{if(event.key==='Escape'&&exportMenu.open){event.preventDefault();closeExportMenu(true);}});
$('download-text').onclick=()=>{closeExportMenu(true);void download('txt');};$('download-json').onclick=()=>{closeExportMenu(true);void download('json');};

$('download-excel').onclick=async()=>{
 if(exporting||saving||drafts.size||!doc)return;
 exporting=true;updateDraftState();const exportId=doc.id,exportName=doc.name;

  const button=$('download-excel');button.disabled=true;button.textContent='Preparing Excel…';$('error').hidden=true;

  try{

    const response=await fetch(`/api/documents/${exportId}/export.xlsx?raw=${$('include-raw').checked?'1':'0'}`);

    if(!response.ok){const result=await response.json();throw Error(result.error);}

    const url=URL.createObjectURL(await response.blob());const a=el('a');a.href=url;a.download=exportName.replace(/\.pdf$/i,'')+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);

  }catch(e){error(e.message||'Excel export failed. Please try again.');}

  finally{exporting=false;button.textContent='Export Excel';updateDraftState();}

};

$('reset').onclick=async()=>{try{await clearDocument();}catch(e){error(e.message);}};

const previous=new URLSearchParams(location.search).get('document')||sessionStorage.getItem('documentId');if(previous){activeId=previous;poll(previous);}
