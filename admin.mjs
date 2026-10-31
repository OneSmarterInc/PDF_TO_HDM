import {randomUUID} from 'node:crypto';
import {transaction} from './db/index.mjs';
import {HttpError,readJson,safeUser,passwordPolicy,passwordHash,audit,requestContext} from './security.mjs';
export function pagination(url){const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('size')||20);if(!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(size)||size<1||size>100)throw new HttpError(400,'Invalid pagination.');return {page,size,offset:(page-1)*size};}
function accountInput(b){
 const username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
 const full_name=typeof b.full_name==='string'?b.full_name.trim():'',email=typeof b.email==='string'?b.email.trim():'';
 if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username))throw new HttpError(400,'Username must contain 3–64 letters, numbers, dots, underscores or hyphens.');
 if(!full_name||full_name.length>120||/[\x00-\x1f]/.test(full_name))throw new HttpError(400,'Enter a full name of 1–120 characters.');
 if(email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new HttpError(400,'Enter a valid email address or leave it blank.');
 if(!['admin','user'].includes(b.role)||typeof b.active!=='boolean')throw new HttpError(400,'Choose a valid role and account status.');
 return {username,full_name,email,role:b.role,active:b.active};
}
async function temporaryHash(){const password=process.env.TEMPORARY_PASSWORD;if(!password)throw new HttpError(503,'Temporary password is not configured. Contact the server operator.');passwordPolicy(password);return passwordHash(password);}
export async function handleAdmin(req,res,url,actor,pool,json){
 if(!url.pathname.startsWith('/api/admin/'))return false;
 if(actor.role!=='admin')throw new HttpError(403,'Administrator access required.');
 const ctx=requestContext(req),route=url.pathname;
 if(route==='/api/admin/stats'&&req.method==='GET'){
  const counts=(await pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active,count(*) FILTER(WHERE NOT active)::int AS inactive,count(*) FILTER(WHERE created_at>now()-interval '7 days')::int AS recent FROM users")).rows[0];
  const activity=(await pool.query("SELECT count(*)::int AS events_today FROM audit_logs WHERE created_at>=date_trunc('day',now())")).rows[0];
  const recent=(await pool.query('SELECT id,username,full_name,role,active,created_at FROM users ORDER BY created_at DESC,id LIMIT 5')).rows;
  json(res,200,{...counts,...activity,recentUsers:recent});return true;
 }
 if(route==='/api/admin/users'&&req.method==='GET'){
  const {page,size,offset}=pagination(url),q=(url.searchParams.get('q')||'').slice(0,120),role=url.searchParams.get('role')||'',active=url.searchParams.get('active')||'';
  if(role&&!['admin','user'].includes(role)||active&&!['true','false'].includes(active))throw new HttpError(400,'Invalid filter.');
  const params=['%'+q+'%',role,active],where="WHERE (username ILIKE $1 OR full_name ILIKE $1 OR email ILIKE $1) AND ($2='' OR role=$2) AND ($3='' OR active::text=$3)";
  const total=Number((await pool.query('SELECT count(*) FROM users '+where,params)).rows[0].count);
  const rows=(await pool.query('SELECT id,username,full_name,email,role,active,must_change_password,created_at,updated_at FROM users '+where+' ORDER BY created_at DESC,id LIMIT $4 OFFSET $5',[...params,size,offset])).rows;
  json(res,200,{rows,total,page,size});return true;
 }
 if(route==='/api/admin/users'&&req.method==='POST'){
  const b=accountInput(await readJson(req)),hash=await temporaryHash(),id=randomUUID();
  const user=await transaction(pool,async c=>{const r=await c.query('INSERT INTO users(id,username,full_name,email,role,active,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,b.username,b.full_name,b.email,b.role,b.active,hash]);await audit(c,actor,'user_created','users',id,{role:b.role,active:b.active},ctx);return safeUser(r.rows[0]);});json(res,201,{user});return true;
 }
 const match=route.match(/^\/api\/admin\/users\/([a-f0-9-]{36})(\/reset-password)?$/);
 if(match){
  if(req.method==='GET'&&!match[2]){const r=await pool.query('SELECT * FROM users WHERE id=$1',[match[1]]);if(!r.rowCount)throw new HttpError(404,'User not found.');json(res,200,{user:safeUser(r.rows[0])});return true;}
  if(req.method==='PATCH'&&!match[2]){
   const b=accountInput(await readJson(req));
   const user=await transaction(pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(4317003)');const old=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[match[1]])).rows[0];if(!old)throw new HttpError(404,'User not found.');
    if(actor.id===old.id&&(!b.active||b.role!=='admin'))throw new HttpError(409,'You cannot deactivate or demote your own account.');
    if(old.role==='admin'&&old.active&&(!b.active||b.role!=='admin')&&Number((await c.query("SELECT count(*) FROM users WHERE role='admin' AND active")).rows[0].count)<=1)throw new HttpError(409,'Keep at least one active administrator.');
    const r=await c.query('UPDATE users SET username=$1,full_name=$2,email=$3,role=$4,active=$5,updated_at=now() WHERE id=$6 RETURNING *',[b.username,b.full_name,b.email,b.role,b.active,old.id]);
    if(!b.active||b.role!==old.role)await c.query('DELETE FROM sessions WHERE user_id=$1',[old.id]);
    await audit(c,actor,'user_updated','users',old.id,{fields:Object.keys(b).filter(k=>b[k]!==old[k])},ctx);
    if(b.active!==old.active)await audit(c,actor,b.active?'user_activated':'user_deactivated','users',old.id,{active:b.active},ctx);
    if(b.role!==old.role)await audit(c,actor,'role_changed','users',old.id,{role:b.role},ctx);
    return safeUser(r.rows[0]);
   });json(res,200,{user});return true;
  }
  if(req.method==='POST'&&match[2]){
   if(match[1]===actor.id)throw new HttpError(409,'Use your own Change password screen.');const hash=await temporaryHash();
   await transaction(pool,async c=>{const r=await c.query('UPDATE users SET password_hash=$1,must_change_password=true,password_changed_at=now(),updated_at=now() WHERE id=$2 RETURNING id',[hash,match[1]]);if(!r.rowCount)throw new HttpError(404,'User not found.');await c.query('DELETE FROM sessions WHERE user_id=$1',[match[1]]);await audit(c,actor,'password_reset','users',match[1],{},ctx);});json(res,200,{ok:true});return true;
  }
 }
 throw new HttpError(404,'Administrative endpoint not found.');
}
