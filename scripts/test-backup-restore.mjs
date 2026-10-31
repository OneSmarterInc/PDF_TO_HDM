import './qa-config.cjs';
import 'dotenv/config';import {randomBytes} from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {createPool} from '../db/index.mjs';
const url=new URL(process.env.MIGRATION_DATABASE_URL),pool=createPool(url.toString()),client=await pool.connect(),run=promisify(execFile),bin=process.env.PG_BIN||'C:/Program Files/PostgreSQL/18/bin';
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password)},database=url.pathname.slice(1),restored='clarity_restore_'+randomBytes(4).toString('hex'),backup=path.resolve('backups/enterprise-verified.dump');
const counts=async c=>{const result={};for(const table of ['users','sessions','documents','document_assets','audit_logs','saved_reviews'])result[table]=Number((await c.query('SELECT count(*) FROM '+table)).rows[0].count);result.assetBytes=Number((await c.query('SELECT coalesce(sum(octet_length(data)),0) AS bytes FROM document_assets')).rows[0].bytes);return result;};
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot,expected=await counts(client);
 await run(path.join(bin,'pg_dump.exe'),['-d',database,'--format=custom','--file='+backup,'--snapshot='+snapshot],{env,windowsHide:true,timeout:120000});await client.query('COMMIT');
 await pool.query('CREATE DATABASE '+restored);await run(path.join(bin,'pg_restore.exe'),['--no-owner','--exit-on-error','-d',restored,backup],{env,windowsHide:true,timeout:120000});
 const target=new URL(url);target.pathname='/'+restored;const restorePool=createPool(target.toString());let actual;try{actual=await counts(restorePool);assert.deepEqual(actual,expected);}finally{await restorePool.end();}
 const report={database:restored,backup,counts:actual,result:'PASS: snapshot row counts and asset byte totals match; restore applied foreign keys and constraints'};await fs.writeFile('output/backup-restore.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{client.release();await pool.end();}
