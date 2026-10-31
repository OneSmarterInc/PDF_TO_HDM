export function setupPasswordVisibility(){
 for(const input of document.querySelectorAll('input[type="password"]')){
  if(input.closest('.password-control'))continue;
  const wrap=document.createElement('div');wrap.className='password-control';input.before(wrap);wrap.append(input);
  const label=document.querySelector(`label[for="${input.id}"]`)?.textContent.toLowerCase()||'password';
  const button=document.createElement('button');button.type='button';button.className='password-toggle';button.setAttribute('aria-controls',input.id);const icon=document.createElement('img');icon.alt='';icon.width=20;icon.height=20;button.append(icon);wrap.append(button);
  const update=()=>{const visible=input.type==='text';button.setAttribute('aria-label',`${visible?'Hide':'Show'} ${label}`);button.title=`${visible?'Hide':'Show'} ${label}`;button.setAttribute('aria-pressed',String(visible));icon.src='/icons/'+(visible?'eye-off':'eye')+'.svg';};
  button.onclick=()=>{input.type=input.type==='password'?'text':'password';update();};update();
  input.form?.addEventListener('submit',()=>{input.type='password';update();});
  window.addEventListener('pageshow',()=>{input.type='password';update();});
 }
}
