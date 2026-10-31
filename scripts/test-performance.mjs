import './qa-config.cjs';
import fs from 'node:fs/promises';import {performance} from 'node:perf_hooks';import {createPool} from '../db/index.mjs';import assert from 'node:assert/strict';
const pool=createPool(),base=process.env.TEST_URL||'http://127.0.0.1:4318',qa=JSON.parse(await fs.readFile('tmp/qa-account.json','utf8')),headers={Cookie:qa.adminCookie},report={};
try{for(const route of ['/api/auth/me','/api/admin/users?size=20','/api/admin/audit?size=20']){const times=[];for(let i=0;i<20;i++){const t=performance.now(),r=await fetch(base+route,{headers});assert.equal(r.status,200);await r.json();times.push(performance.now()-t);}times.sort((a,b)=>a-b);report[route]={requests:20,medianMs:Math.round(times[10]),p95Ms:Math.round(times[18])};}
 const id=JSON.parse(await fs.readFile('tmp/flow-document.json','utf8')).id,t=performance.now();const r=await fetch(base+'/api/documents/'+id+'/export.xlsx',{headers});assert.equal(r.status,200);const bytes=await r.arrayBuffer();report.excel={milliseconds:Math.round(performance.now()-t),bytes:bytes.byteLength};
 report.databaseBytes=Number((await pool.query('SELECT pg_database_size(current_database()) AS size')).rows[0].size);
 report.queryPlan=(await pool.query("EXPLAIN SELECT id FROM documents WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20",[(await pool.query('SELECT id FROM users WHERE username=$1',[qa.username])).rows[0].id])).rows.map(r=>r['QUERY PLAN']);
 await fs.writeFile('output/performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pool.end();}
