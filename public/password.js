import {setupPasswordVisibility} from "./password-visibility.js";
import {apiFetch,currentUser} from './session.js';
setupPasswordVisibility();
const form=document.querySelector('form'),button=document.querySelector('#submit'),message=document.querySelector('#message');
form.onsubmit=async e=>{e.preventDefault();if(button.disabled)return;button.disabled=true;message.textContent='';try{const b=Object.fromEntries(new FormData(form));const r=await apiFetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw Error(d.error);location.assign('/portal');}catch(error){message.textContent=error.message;button.disabled=false;}};
