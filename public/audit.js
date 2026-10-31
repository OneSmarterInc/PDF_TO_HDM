import {formatDate,formatDateTime,dateFilterToISO} from './date-format.js';
import {apiFetch} from './session.js';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
let page=1,loading=false;
const words=value=>String(value||'').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const labels={admin_login:'Administrator signed in',user_login:'User signed in',login_failed:'Sign-in failed',logout:'Signed out',password_changed:'Password changed',password_reset:'Password reset',user_created:'Account created',user_updated:'Account updated',user_activated:'Account activated',user_deactivated:'Account deactivated',role_changed:'Role changed',document_created:'Document uploaded',document_processed:'Document processed',document_updated:'Document edited',document_exported:'Document exported',document_deleted:'Document deleted',document_expired:'Document expired',document_failed:'Processing failed',document_interrupted:'Processing interrupted',document_resumed:'Processing resumed'};
const areas={authentication:'Authentication',users:'Accounts',documents:'Documents'};
const iconFor=module=>module==='users'?'users':module==='documents'?'file-text':'key-round';
const icon=name=>{const img=el('img');img.src='/icons/'+name+'.svg';img.alt='';img.width=20;img.height=20;return img;};
const time=value=>new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const date=formatDate;
$('title').textContent='Activity history';$('subtitle').textContent='Track account changes, sign-ins and document activity in one place.';$('audit').hidden=false;$('audit').classList.add('activity-panel');
const heading=el('div',undefined,'activity-heading'),identity=el('div',undefined,'activity-heading-title'),mark=el('span',undefined,'activity-mark');mark.append(icon('history'));const headingText=el('div');headingText.append(el('h2','Workspace activity'),el('p','Read-only audit history. Every entry is kept as recorded.'));identity.append(mark,headingText);const refresh=el('button','Refresh');refresh.type='button';heading.append(identity,refresh);
const filters=el('form');filters.className='activity-filters';filters.id='audit-filters';filters.noValidate=true;
for(const [name,label,type,placeholder] of [['q','Search activity','search','Search events, usernames or record IDs'],['module','Area','select','All areas'],['from','From (UTC)','text','MM-DD-YYYY'],['to','Through (UTC)','text','MM-DD-YYYY']]){
 const field=el('label',label,name==='q'?'activity-search':undefined),input=el(type==='select'?'select':'input');input.name=name;
 if(type==='select'){input.append(new Option(placeholder,''));for(const [value,text] of Object.entries(areas))input.append(new Option(text,value));}
 else{input.type=type;input.placeholder=placeholder;input.maxLength=['from','to'].includes(name)?10:120;if(['from','to'].includes(name))input.inputMode='numeric';}
 field.append(input);filters.append(field);
}
const filterActions=el('div',undefined,'activity-filter-actions'),apply=el('button','Apply filters','primary'),clear=el('button','Clear filters');clear.type='button';filterActions.append(apply,clear);filters.append(filterActions);
const resultsBar=el('div',undefined,'activity-results-bar'),count=el('span','Loading activity…'),hint=el('span','Newest first · Times shown in your local timezone');resultsBar.append(count,hint);
const wrap=el('div');wrap.id='audit-list';wrap.setAttribute('aria-live','polite');wrap.className='table-scroll';
const pagination=el('div',undefined,'pagination activity-pagination'),previous=el('button','Previous'),next=el('button','Next'),info=el('span');pagination.append(info,previous,next);$('audit').append(heading,filters,resultsBar,wrap,pagination);
const dialog=el('dialog');dialog.className='activity-dialog';dialog.setAttribute('aria-labelledby','activity-detail-title');document.body.append(dialog);
function addDetail(list,label,value){list.append(el('dt',label),el('dd',value===null||value===undefined||value===''?'Not recorded':Array.isArray(value)?value.map(words).join(', '):typeof value==='object'?JSON.stringify(value):String(value)));}
function showDetail(event){
 const title=el('h2',labels[event.action]||words(event.action));title.id='activity-detail-title';const intro=el('p',`${date(event.created_at)} at ${time(event.created_at)}`,'activity-detail-intro'),details=el('dl',undefined,'activity-detail-grid');
 addDetail(details,'Performed by',event.actor_username||'System');addDetail(details,'Role',event.actor_role?words(event.actor_role):'System');addDetail(details,'Area',areas[event.module]||words(event.module));
 const metadata=Object.entries(event.metadata||{});for(const [key,value] of metadata)addDetail(details,words(key),value);
 const technical=el('details',undefined,'activity-technical'),technicalList=el('dl',undefined,'activity-detail-grid');technical.append(el('summary','Record & request information'));for(const [key,value] of [['Event ID',event.id],['Record ID',event.record_id],['Request ID',event.request_id],['IP address',event.ip_address],['Timestamp (UTC)',formatDateTime(event.created_at,{utc:true})],['Event code',event.action]])addDetail(technicalList,key,value);technical.append(technicalList);
 const actions=el('div',undefined,'form-actions'),close=el('button','Close','primary');close.type='button';close.onclick=()=>dialog.close();actions.append(close);dialog.replaceChildren(el('p','ACTIVITY DETAILS','eyebrow'),title,intro,details,technical,actions);dialog.showModal();
}
async function load(){
 if(loading)return;const params=new URLSearchParams(new FormData(filters));params.set('page',page);try{for(const name of ['from','to'])params.set(name,dateFilterToISO(String(params.get(name)||'')));}catch(error){$('notice').textContent=error.message;$('notice').className='toast error';$('notice').hidden=false;return;}loading=true;const controls=[...filters.querySelectorAll('input,select,button'),refresh];controls.forEach(c=>c.disabled=true);previous.disabled=next.disabled=true;wrap.setAttribute('aria-busy','true');count.textContent='Loading activity…';
 try{
  const r=await apiFetch('/api/admin/audit?'+params),d=await r.json();if(!r.ok)throw Error(d.error);$('notice').hidden=true;
  const table=el('table',undefined,'portal-table activity-table'),head=el('thead'),header=el('tr');for(const label of ['Event','Performed by','Area','When','Details']){const th=el('th',label);th.scope='col';header.append(th);}head.append(header);table.append(head);const body=el('tbody');
  for(const event of d.rows){
   const row=el('tr'),eventCell=el('td'),eventLayout=el('div',undefined,'activity-event'),symbol=el('span',undefined,'activity-event-icon'+(/failed|interrupted/.test(event.action)?' warning':''));symbol.append(icon(iconFor(event.module)));const eventText=el('div');eventText.append(el('strong',labels[event.action]||words(event.action)));const context=event.metadata?.format?String(event.metadata.format).toUpperCase()+' file':Array.isArray(event.metadata?.fields)?event.metadata.fields.map(words).join(', '):'';if(context)eventText.append(el('span',context,'activity-event-code'));eventLayout.append(symbol,eventText);eventCell.append(eventLayout);
   const actor=el('td');actor.dataset.label='Performed by';actor.append(el('span',event.actor_username||'System','activity-actor'),el('small',event.actor_role?words(event.actor_role):'System'));
   const area=el('td');area.dataset.label='Area';area.append(el('span',areas[event.module]||words(event.module),'activity-area'));
   const when=el('td');when.dataset.label='When';when.append(el('span',date(event.created_at)),el('small',time(event.created_at)));
   const action=el('td'),button=el('button','View details');button.type='button';button.onclick=()=>showDetail(event);action.className='activity-row-action';action.append(button);row.append(eventCell,actor,area,when,action);body.append(row);
  }
  table.append(body);
  if(d.rows.length)wrap.replaceChildren(table);else{const empty=el('div',undefined,'activity-empty');empty.append(icon('history'),el('h3','No activity found'),el('p','Try a different search or clear your filters.'));wrap.replaceChildren(empty);}
  count.textContent=d.total?`Showing ${(page-1)*20+1}–${(page-1)*20+d.rows.length} of ${d.total.toLocaleString()} events`:'0 matching events';info.textContent=`Page ${page} of ${Math.max(1,Math.ceil(d.total/20))}`;previous.disabled=page===1;next.disabled=page*20>=d.total;
 }catch(error){$('notice').textContent=error.message;$('notice').className='toast error';$('notice').hidden=false;count.textContent='Activity could not be refreshed';}
 finally{loading=false;controls.forEach(c=>c.disabled=false);wrap.setAttribute('aria-busy','false');}
}
filters.onsubmit=event=>{event.preventDefault();if(loading)return;page=1;void load();};clear.onclick=()=>{filters.reset();page=1;void load();};refresh.onclick=()=>void load();previous.onclick=()=>{page--;void load();};next.onclick=()=>{page++;void load();};await load();
