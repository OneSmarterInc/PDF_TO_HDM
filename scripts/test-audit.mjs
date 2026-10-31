import './qa-config.cjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createPool,transaction} from '../db/index.mjs';import {audit} from '../security.mjs';
const pool=createPool(),base=process.env.TEST_URL||'http://127.0.0.1:4318',qa=JSON.parse(await fs.readFile('tmp/qa-account.json','utf8'));
async function get(query=''){const r=await fetch(base+'/api/admin/audit'+query,{headers:{Cookie:qa.adminCookie}});return {status:r.status,data:await r.json()};}
try{
 let {status,data}=await get();assert.equal(status,200);assert.ok(data.total>0);assert.ok(data.rows.every(r=>r.id&&r.action&&r.module&&Number.isFinite(Date.parse(r.created_at))));
 const first=data.rows[0];assert.equal((await get('?q='+encodeURIComponent(first.actor_username||first.action))).status,200);
 for(const [key,value] of [['user',first.actor_username],['action',first.action],['module',first.module]]){const d=(await get('?'+key+'='+encodeURIComponent(value))).data;assert.ok(d.rows.every(r=>r[key==='user'?'actor_username':key]===value));}
 assert.equal((await get('?from=2026-99-99')).status,400);assert.equal((await get('?from=2027-01-01&to=2026-01-01')).status,400);
 const one=(await get('?size=1')).data,two=(await get('?size=1&page=2')).data;assert.equal(one.rows.length,1);assert.notEqual(one.rows[0].id,two.rows[0].id);
 const before=Number((await pool.query("SELECT count(*) FROM audit_logs WHERE action='rollback_probe'")).rows[0].count);
 await assert.rejects(transaction(pool,async c=>{await audit(c,null,'rollback_probe','test',null,{password:'secret',token:'secret'});throw Error('rollback');}),/rollback/);
 assert.equal(Number((await pool.query("SELECT count(*) FROM audit_logs WHERE action='rollback_probe'")).rows[0].count),before);
 const metadata=(await pool.query('SELECT metadata FROM audit_logs')).rows;for(const r of metadata)assert.ok(!/password_hash|password":|token":|secret":/.test(JSON.stringify(r.metadata)));
 assert.equal((await fetch(base+'/api/admin/audit')).status,401);
 assert.equal((await fetch(base+'/api/admin/audit',{method:'DELETE',headers:{Cookie:qa.adminCookie,Origin:base,'X-CSRF-Token':qa.csrf}})).status,405);
 console.log('PASS audit: actors/timestamps, search/user/action/module/date filters, pagination, rollback atomicity, credential exclusion and read-only API.');
}finally{await pool.end();}
