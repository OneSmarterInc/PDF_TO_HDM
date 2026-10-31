const response=await fetch('/api/auth/me');
if(!response.ok){sessionStorage.removeItem('documentId');location.replace('/login');throw Error('Sign-in required');}
const session=await response.json();export const currentUser=session.user;
if(currentUser.must_change_password&&location.pathname!=='/change-password'){location.replace('/change-password');throw Error('Password change required');}
export async function apiFetch(url,options={}){
 const headers=new Headers(options.headers);if(!['GET','HEAD'].includes((options.method||'GET').toUpperCase()))headers.set('X-CSRF-Token',session.csrf);
 const r=await fetch(url,{...options,headers});if(r.status===401){sessionStorage.removeItem('documentId');location.assign('/login');}if(r.status===403){const d=await r.clone().json().catch(()=>({}));if(d.error==='PASSWORD_CHANGE_REQUIRED')location.assign('/change-password');}return r;
}
let leaveWarning=()=>'';
export function setLeaveWarning(callback){leaveWarning=callback;}
let confirmationOpen=false;
export async function confirmAction({title='Are you sure?',message,confirmLabel='Continue',danger=false}){
 if(confirmationOpen)return false;confirmationOpen=true;
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='portal-confirm';dialog.setAttribute('aria-labelledby','portal-confirm-title');dialog.setAttribute('aria-describedby','portal-confirm-message');
  const badge=document.createElement('div');badge.className='confirm-symbol';badge.textContent='!';badge.setAttribute('aria-hidden','true');
  const heading=document.createElement('h2');heading.id='portal-confirm-title';heading.textContent=title;
  const text=document.createElement('p');text.id='portal-confirm-message';text.textContent=message;
  const actions=document.createElement('div');actions.className='form-actions';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';const accept=document.createElement('button');accept.type='button';accept.textContent=confirmLabel;accept.className=danger?'danger-action':'primary';actions.append(cancel,accept);dialog.append(badge,heading,text,actions);document.body.append(dialog);
  const finish=value=>{dialog.close();dialog.remove();confirmationOpen=false;if(previous?.isConnected)previous.focus();resolve(value);};cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)finish(false);}});
  dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){if(e.shiftKey&&document.activeElement===cancel){e.preventDefault();accept.focus();}else if(!e.shiftKey&&document.activeElement===accept){e.preventDefault();cancel.focus();}}});dialog.showModal();cancel.focus();
 });
}
async function canLeave(){const message=leaveWarning();return !message||await confirmAction({title:'Leave this page?',message,confirmLabel:'Leave page',danger:true});}
document.addEventListener('click',async event=>{const a=event.target.closest('a[href]');if(!a||a.closest('.portal-nav')||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||a.target==='_blank'||a.hasAttribute('download'))return;const target=new URL(a.href);if(target.origin!==location.origin||!leaveWarning())return;event.preventDefault();if(await canLeave())location.assign(a.href);});
const header=document.querySelector('.topbar');
if(header){
 const icons={'/portal':'file-text','/documents':'files','/admin':'layout-dashboard','/admin/users':'users','/admin/audit':'history','/change-password':'key-round'};
 const toggle=document.createElement('button');toggle.className='nav-toggle';toggle.type='button';toggle.setAttribute('aria-label','Open navigation');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','main-navigation');
 const hamburger=document.createElement('span');hamburger.className='hamburger';hamburger.setAttribute('aria-hidden','true');hamburger.append(document.createElement('i'),document.createElement('i'),document.createElement('i'));toggle.append(hamburger);
 const drawer=document.createElement('dialog');drawer.id='main-navigation';drawer.className='navigation-drawer';drawer.setAttribute('aria-label','Main navigation');
 const top=document.createElement('div');top.className='drawer-heading';const title=document.createElement('strong');title.textContent='Workspace';const close=document.createElement('button');close.type='button';close.className='drawer-close';close.setAttribute('aria-label','Close navigation');close.textContent='×';top.append(title,close);
 const subtitle=document.createElement('p');subtitle.className='drawer-caption';subtitle.textContent=currentUser.role==='admin'?'Administration & documents':'Your document workspace';
 const nav=document.createElement('nav');nav.className='portal-nav';nav.setAttribute('aria-label','Workspace sections');
 const links=currentUser.must_change_password?[]:[['/portal','Upload PDF'],['/documents','My documents'],...(currentUser.role==='admin'?[['/admin','Overview'],['/admin/users','Users'],['/admin/audit','Activity']]:[]),['/change-password','Password']];
 let closing=false;
 function dismiss(destination){
  if(closing||!drawer.open)return;closing=true;drawer.classList.remove('is-open');toggle.setAttribute('aria-expanded','false');
  const finish=()=>{drawer.close();closing=false;toggle.focus();if(destination)location.assign(destination);};
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)finish();else setTimeout(finish,220);
 }
 for(const [href,text] of links){const a=document.createElement('a');a.href=href;a.textContent=text;if(location.pathname===href)a.setAttribute('aria-current','page');const img=document.createElement('img');img.src='/icons/'+icons[href]+'.svg';img.alt='';img.width=20;img.height=20;a.prepend(img);a.addEventListener('click',async event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();if(location.pathname===href&&!location.search)dismiss();else if(await canLeave())dismiss(href);});nav.append(a);}
 const account=document.createElement('div');account.className='drawer-account';const name=document.createElement('strong');name.textContent=currentUser.full_name;const role=document.createElement('span');role.textContent=currentUser.role==='admin'?'Administrator':'Member';account.append(name,role);
 const out=document.createElement('button');out.type='button';out.className='drawer-signout';out.textContent='Sign out';out.onclick=async()=>{if(!await confirmAction({title:'Sign out?',message:'You will need to sign in again to access the portal.'+(leaveWarning()?' '+leaveWarning():''),confirmLabel:'Sign out'}))return;out.disabled=true;try{const r=await apiFetch('/api/auth/logout',{method:'POST'});if(!r.ok)throw Error();sessionStorage.clear();location.assign('/login');}catch{out.disabled=false;out.textContent='Retry sign out';}};account.append(out);
 drawer.append(top,subtitle,nav,account);document.body.append(drawer);header.querySelector('.local')?.remove();header.prepend(toggle);header.classList.add('has-drawer');
 toggle.onclick=()=>{if(drawer.open)return;drawer.showModal();toggle.setAttribute('aria-expanded','true');requestAnimationFrame(()=>requestAnimationFrame(()=>{if(drawer.open&&!closing)drawer.classList.add('is-open');}));};
 close.onclick=()=>dismiss();drawer.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
 drawer.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const items=[...drawer.querySelectorAll('a[href],button:not(:disabled)')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
 drawer.addEventListener('click',event=>{if(event.target===drawer){const r=drawer.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dismiss();}});
}

window.addEventListener("pageshow",async event=>{if(event.persisted){document.body.hidden=true;const r=await fetch("/api/auth/me");if(!r.ok)location.replace("/login");else location.reload();}});
