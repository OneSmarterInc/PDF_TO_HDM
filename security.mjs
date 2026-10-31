import {isIP} from 'node:net';
import {clientAddress} from './deployment-config.mjs';
import {randomBytes,createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import {transaction} from './db/index.mjs';
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export const digest=value=>createHash('sha256').update(value).digest('hex');
let passwordWork=0;
async function boundedPasswordWork(work){if(passwordWork>=4)throw new HttpError(429,'Authentication is busy. Please retry shortly.');passwordWork++;try{return await work();}finally{passwordWork--;}}
export const passwordHash=value=>boundedPasswordWork(()=>argon2.hash(value,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1}));
const verifyPassword=(hash,value)=>boundedPasswordWork(()=>argon2.verify(hash,value));
export function passwordPolicy(value,username=''){
 if(typeof value!=='string'||value.length<6||value.length>128||value.trim().length<6)throw new HttpError(400,'Use a password or passphrase of 6–128 characters.');
 if(/^(password|qwerty|letmein|123456|admin)/i.test(value)||/^(.)\1+$/.test(value)||(username.length>3&&value.toLowerCase().includes(username.toLowerCase())))throw new HttpError(400,'Choose a less predictable password without your username.');
}
export async function readJson(req){let size=0,parts=[];for await(const b of req){size+=b.length;if(size>16384)throw new HttpError(413,'Request is too large.');parts.push(b);}try{const data=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}catch{throw new HttpError(400,'Invalid JSON request.');}}
export function safeUser(u){return {id:u.id,username:u.username,full_name:u.full_name,email:u.email,role:u.role,active:u.active,must_change_password:u.must_change_password,created_at:u.created_at,updated_at:u.updated_at};}
export function requestContext(req){return {requestId:req.requestId||randomUUID(),ip:clientAddress(req)};}
const safeKeys=new Set(['fields','page','field','status','role','active','reason','format','count']);
export async function audit(c,actor,action,module,recordId,metadata={},context={}){
 const safe=Object.fromEntries(Object.entries(metadata).filter(([k])=>safeKeys.has(k)));
 await c.query('INSERT INTO audit_logs(actor_id,actor_username,actor_role,action,module,record_id,metadata,request_id,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actor?.id||null,actor?.username?.slice(0,64)||null,actor?.role||null,action,module,recordId||null,safe,context.requestId||null,context.ip||null]);
}
export function createSecurity(pool,origin){
 const production=process.env.NODE_ENV==='production',cookieName=production?'__Host-clarity':'clarity_session';
 if(production&&!origin.startsWith('https://'))throw Error('Production APP_ORIGIN must use HTTPS.');
 const dummy=passwordHash(randomBytes(32).toString('hex'));
 const cookie=(res,token,seconds=28800)=>res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${production?'; Secure':''}`);
 const tokenOf=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 async function identify(req){
  const token=tokenOf(req);if(!/^[a-f0-9]{64}$/.test(token))return null;
  const r=await pool.query("SELECT u.*,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes' AND u.active",[digest(token)]);
  if(!r.rowCount)return null;
  await pool.query("UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND last_seen_at<now()-interval '1 minute'",[digest(token)]);
  return {...safeUser(r.rows[0]),tokenHash:digest(token),csrf:digest('csrf:'+token)};
 }
 function originCheck(req){if(req.headers.origin!==origin)throw new HttpError(403,'Request origin is not allowed.');}
 function csrfCheck(req,user){originCheck(req);const header=req.headers['x-csrf-token'];if(typeof header!=='string'||header.length!==user.csrf.length||!timingSafeEqual(Buffer.from(header),Buffer.from(user.csrf)))throw new HttpError(403,'Security token expired. Reload this page.');}
 async function requireUser(req,{allowPasswordChange=false,admin=false}={}){
  const u=await identify(req);if(!u)throw new HttpError(401,'Please sign in.');
  if(!allowPasswordChange&&u.must_change_password)throw new HttpError(403,'PASSWORD_CHANGE_REQUIRED');
  if(admin&&u.role!=='admin')throw new HttpError(403,'Administrator access required.');
  if(!['GET','HEAD'].includes(req.method))csrfCheck(req,u);return u;
 }
 async function session(c,user){const token=randomBytes(32).toString('hex');await c.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[digest(token),user.id]);return token;}
 async function handle(req,res,url,json){
  if(!url.pathname.startsWith('/api/auth/'))return false;
  const ctx=requestContext(req);
  if(url.pathname==='/api/auth/login'&&req.method==='POST'){
   originCheck(req);const b=await readJson(req),username=typeof b.username==='string'?b.username.toLowerCase().trim():'';
   if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)||typeof b.password!=='string'||b.password.length>128)throw new HttpError(400,'Enter a valid username and password.');
   const limits=await transaction(pool,async c=>{const counts=[];for(const key of ['ip:'+digest(ctx.ip||''),'user:'+digest(username)]){const r=await c.query("INSERT INTO login_limits(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.window_started<now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,window_started=CASE WHEN login_limits.window_started<now()-interval '15 minutes' THEN now() ELSE login_limits.window_started END RETURNING attempts",[key]);counts.push(r.rows[0].attempts);}return counts;});
   if(limits[0]>100||limits[1]>10){await audit(pool,{username},'login_failed','authentication',null,{reason:'rate_limited'},ctx);throw new HttpError(429,'Too many attempts. Try again in 15 minutes.');}
   const r=await pool.query('SELECT * FROM users WHERE username=$1',[username]),u=r.rows[0];
   const valid=await verifyPassword(u?.password_hash||await dummy,b.password);
   if(!valid||!u?.active){await audit(pool,{username},'login_failed','authentication',null,{reason:'invalid_credentials'},ctx);throw new HttpError(401,'Invalid username or password.');}
   const token=await transaction(pool,async c=>{const locked=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[u.id])).rows[0];if(!locked.active||locked.password_hash!==u.password_hash)throw new HttpError(401,'Invalid username or password.');await c.query('DELETE FROM sessions WHERE token_hash=$1',[digest(tokenOf(req))]);const t=await session(c,u);await audit(c,u,u.role==='admin'?'admin_login':'user_login','authentication',u.id,{},ctx);return t;});
   cookie(res,token);json(res,200,{user:safeUser(u),csrf:digest('csrf:'+token)});return true;
  }
  const u=await requireUser(req,{allowPasswordChange:true});
  if(url.pathname==='/api/auth/me'&&req.method==='GET'){json(res,200,{user:safeUser(u),csrf:u.csrf});return true;}
  if(url.pathname==='/api/auth/logout'&&req.method==='POST'){await transaction(pool,async c=>{await c.query('DELETE FROM sessions WHERE token_hash=$1',[u.tokenHash]);await audit(c,u,'logout','authentication',u.id,{},ctx);});cookie(res,'',0);json(res,200,{ok:true});return true;}
  if(url.pathname==='/api/auth/password'&&req.method==='POST'){
   const limit=await pool.query("INSERT INTO login_limits(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.window_started<now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,window_started=CASE WHEN login_limits.window_started<now()-interval '15 minutes' THEN now() ELSE login_limits.window_started END RETURNING attempts",['change:'+u.id]);if(limit.rows[0].attempts>10)throw new HttpError(429,'Too many password change attempts. Try again in 15 minutes.');
   const b=await readJson(req);passwordPolicy(b.newPassword,u.username);if(b.newPassword!==b.confirmPassword)throw new HttpError(400,'New passwords do not match.');
   if(typeof b.currentPassword!=='string'||b.currentPassword.length>128)throw new HttpError(400,'Enter the current password.');
   const token=await transaction(pool,async c=>{const account=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[u.id])).rows[0];if(!await verifyPassword(account.password_hash,b.currentPassword))throw new HttpError(400,'Current password is incorrect.');if(await verifyPassword(account.password_hash,b.newPassword)||b.newPassword===process.env.TEMPORARY_PASSWORD)throw new HttpError(400,'Choose a new password different from the temporary or current password.');
    await c.query('UPDATE users SET password_hash=$1,must_change_password=false,password_changed_at=now(),updated_at=now() WHERE id=$2',[await passwordHash(b.newPassword),u.id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);const t=await session(c,u);await audit(c,u,'password_changed','authentication',u.id,{},ctx);return t;});
   cookie(res,token);json(res,200,{ok:true,csrf:digest('csrf:'+token)});return true;
  }
  throw new HttpError(404,'Authentication endpoint not found.');
 }
 return {handle,identify,requireUser,originCheck};
}
