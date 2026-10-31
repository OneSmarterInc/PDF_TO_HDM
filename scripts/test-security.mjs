import './qa-config.cjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {createPool} from '../db/index.mjs';
const base=process.env.TEST_URL||'http://127.0.0.1:4318',qa=JSON.parse(await fs.readFile('tmp/qa-account.json','utf8')),pool=createPool(),headers={Cookie:qa.adminCookie,Origin:base,'X-CSRF-Token':qa.csrf,'Content-Type':'application/json'};
try{
 const home=await fetch(base+'/portal',{headers});assert.equal(home.headers.get('cache-control'),'no-store');assert.match(home.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(home.headers.get('x-frame-options'),'SAMEORIGIN');
 for(const path of ['/.env','/.local-credentials.txt','/db/001_initial.sql','/../.env'])assert.equal((await fetch(base+path)).status,404);
 for(const h of [{Cookie:qa.adminCookie},{...headers,'X-CSRF-Token':'bad'},{...headers,Origin:'https://evil.invalid'}])assert.equal((await fetch(base+'/api/admin/users',{method:'POST',headers:h,body:'{}'})).status,403);
 const count=Number((await pool.query('SELECT count(*) FROM users')).rows[0].count);
 assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:"admin' OR 1=1 --",password:'anything'})})).status,400);
 const r=await fetch(base+'/api/admin/users?q='+encodeURIComponent("'; DROP TABLE users; --"),{headers});assert.equal(r.status,200);assert.equal((await r.json()).total,0);assert.equal(Number((await pool.query('SELECT count(*) FROM users')).rows[0].count),count);
 const username='missing_'+randomBytes(6).toString('hex');for(let i=0;i<11;i++){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username,password:'a wrong password'})});assert.equal(r.status,i===10?429:401);}
 const source=await fs.readFile('public/admin.js','utf8');assert.ok(!source.includes('innerHTML'));assert.ok(!source.includes('TEMPORARY_PASSWORD'));
 await assert.rejects(pool.query('UPDATE audit_logs SET metadata=$1',[{}]),e=>e.code==='42501');
 console.log('PASS security: secret paths, CSP/cache headers, missing/wrong/cross-origin CSRF, SQL injection, persistent brute-force throttling, immutable audit permissions.');
}finally{await pool.end();}
