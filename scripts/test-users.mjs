import './qa-config.cjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import {createPool} from '../db/index.mjs';
const pool=createPool(),base=process.env.TEST_URL||'http://127.0.0.1:4318',qa=JSON.parse(await fs.readFile('tmp/qa-account.json','utf8'));let count=0;
const eq=(a,b)=>{assert.equal(a,b);count++;};let cookie=qa.adminCookie,csrf=qa.csrf;
async function call(path,method='GET',body,auth=true){const r=await fetch(base+path,{method,headers:{Origin:base,...(auth?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {r,d:await r.json()};}
try{
 const input={username:'qa_lifecycle_'+randomUUID().slice(0,8),full_name:'QA Lifecycle',email:'qa@example.invalid',role:'user',active:true};
 let {r,d}=await call('/api/admin/users','POST',input);eq(r.status,201);const id=d.user.id;eq(d.user.must_change_password,true);eq(d.user.password_hash,undefined);
 eq((await pool.query('SELECT username FROM users WHERE id=$1',[id])).rows[0].username,input.username);
 eq((await call('/api/admin/users','POST',input)).r.status,409);
 eq((await call('/api/admin/users','POST',{...input,username:'x',role:'root'})).r.status,400);
 eq((await call('/api/admin/users?q='+input.username)).d.total,1);
 eq((await call('/api/admin/users?size=1')).d.rows.length,1);
 eq((await call('/api/admin/users?size=1000')).r.status,400);
 const adminCookie=cookie,adminCsrf=csrf;
 ({r,d}=await call('/api/auth/login','POST',{username:input.username,password:process.env.TEMPORARY_PASSWORD},false));eq(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=d.csrf;
 eq((await call('/api/documents','POST',{})).r.status,403);eq((await call('/api/admin/users')).r.status,403);
 const password=randomBytes(24).toString('base64url');({r,d}=await call('/api/auth/password','POST',{currentPassword:process.env.TEMPORARY_PASSWORD,newPassword:password,confirmPassword:password}));eq(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=d.csrf;
 eq((await call('/api/admin/users')).r.status,403);const userCookie=cookie;
 cookie=adminCookie;csrf=adminCsrf;
 eq((await call('/api/admin/users/'+id,'PATCH',{...input,full_name:'QA Updated',role:'admin'})).r.status,200);
 eq((await fetch(base+'/api/auth/me',{headers:{Cookie:userCookie}})).status,401);
 eq((await call('/api/admin/users/'+id+'/reset-password','POST')).r.status,200);
 eq((await pool.query('SELECT must_change_password FROM users WHERE id=$1',[id])).rows[0].must_change_password,true);
 eq((await call('/api/auth/login','POST',{username:input.username,password},false)).r.status,401);
 eq((await call('/api/auth/login','POST',{username:input.username,password:process.env.TEMPORARY_PASSWORD},false)).r.status,200);
 eq((await call('/api/admin/users/'+id,'PATCH',{...input,active:false})).r.status,200);
 eq((await call('/api/auth/login','POST',{username:input.username,password:process.env.TEMPORARY_PASSWORD},false)).r.status,401);
 const stats=(await call('/api/admin/stats')).d;eq(stats.total,Number((await pool.query('SELECT count(*) FROM users')).rows[0].count));
 const events=(await pool.query('SELECT action FROM audit_logs WHERE record_id=$1',[id])).rows.map(r=>r.action);for(const action of ['user_created','user_updated','role_changed','password_reset','user_deactivated']){assert.ok(events.includes(action));count++;}
 console.log(`PASS user management: ${count} assertions, real CRUD/search/pagination/roles/reset/deactivation and mandatory password workflow.`);
}finally{await pool.end();}
