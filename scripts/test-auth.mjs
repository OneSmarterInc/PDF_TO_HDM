import './qa-config.cjs';
import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import fs from 'node:fs/promises';
import {createPool} from '../db/index.mjs';import {passwordHash,digest} from '../security.mjs';
const pool=createPool(),base=process.env.TEST_URL||'http://127.0.0.1:4318';
const password=randomBytes(24).toString('base64url'),next=randomBytes(24).toString('base64url');
let assertions=0;const eq=(a,b)=>{assert.equal(a,b);assertions++;};
async function call(path,{method='GET',body,cookie,csrf,origin=base}={}){return fetch(base+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});}
try{
 const names=['qa_admin_'+randomUUID().slice(0,8),'qa_user_'+randomUUID().slice(0,8)];const hash=await passwordHash(password);assert.ok(hash.startsWith('$argon2id$'));assertions++;
 for(const [i,username] of names.entries())await pool.query('INSERT INTO users(id,username,full_name,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),username,'QA Authentication',i?'user':'admin',hash,!!i]);
 for(const username of names)eq((await call('/api/auth/login',{method:'POST',body:{username,password:'wrong'}})).status,401);
 eq((await call('/api/documents/missing')).status,401);
 eq((await call('/api/auth/login',{method:'POST',body:{username:names[0],password},origin:'https://evil.invalid'})).status,403);
 let r=await call('/api/auth/login',{method:'POST',body:{username:names[0],password}});eq(r.status,200);const adminCookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);assertions++;
 const admin=await r.json();eq(admin.user.role,'admin');eq(admin.user.password_hash,undefined);
 r=await call('/api/auth/login',{method:'POST',body:{username:names[1],password}});eq(r.status,200);let cookie=r.headers.get('set-cookie').split(';')[0],data=await r.json();eq(data.user.must_change_password,true);
 eq((await call('/api/documents/x',{cookie})).status,403);
 eq((await call('/api/auth/password',{method:'POST',cookie,body:{currentPassword:password,newPassword:next,confirmPassword:next}})).status,403);
 eq((await call('/api/auth/password',{method:'POST',cookie,csrf:data.csrf,body:{currentPassword:'incorrect',newPassword:next,confirmPassword:next}})).status,400);
 r=await call('/api/auth/password',{method:'POST',cookie,csrf:data.csrf,body:{currentPassword:password,newPassword:next,confirmPassword:next}});eq(r.status,200);const oldCookie=cookie;cookie=r.headers.get('set-cookie').split(';')[0];data=await r.json();
 eq((await call('/api/auth/me',{cookie:oldCookie})).status,401);eq((await call('/api/admin/users',{cookie})).status,403);
 eq((await call('/api/auth/logout',{method:'POST',cookie,csrf:data.csrf})).status,200);eq((await call('/api/auth/me',{cookie})).status,401);
 eq((await call('/api/auth/login',{method:'POST',body:{username:names[1],password}})).status,401);
 r=await call('/api/auth/login',{method:'POST',body:{username:names[1],password:next}});eq(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
 await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(cookie.split('=')[1])]);eq((await call('/api/auth/me',{cookie})).status,401);
 const previous=await fs.readFile('tmp/qa-account.json','utf8').then(JSON.parse).catch(()=>null);
 if(previous){const login=await call('/api/auth/login',{method:'POST',body:{username:previous.username,password:previous.password}});assert.equal(login.status,200,'Existing QA account must remain usable');const body=await login.json();await fs.writeFile('tmp/qa-account.json',JSON.stringify({...previous,adminCookie:login.headers.get('set-cookie').split(';')[0],csrf:body.csrf}));}
 else await fs.writeFile('tmp/qa-account.json',JSON.stringify({username:names[0],password,adminCookie,csrf:admin.csrf}));
 await pool.query('UPDATE users SET active=false WHERE username=$1',[names[1]]);eq((await call('/api/auth/login',{method:'POST',body:{username:names[1],password:next}})).status,401);
 console.log(`PASS authentication: ${assertions} assertions (roles, credentials, CSRF, forced change, rotation, expiry, logout, deactivation).`);
}finally{await pool.end();}
