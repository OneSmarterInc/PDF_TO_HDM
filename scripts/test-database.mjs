import './qa-config.cjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool,transaction,databaseError} from '../db/index.mjs';
const pool=createPool();
try{
 const user=randomUUID(),doc=randomUUID();
 await assert.rejects(transaction(pool,async c=>{
  await c.query('INSERT INTO users(id,username,full_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[user,'db_'+user.slice(0,8),'Database test','user','test-only']);
  assert.equal((await c.query('SELECT role FROM users WHERE id=$1',[user])).rows[0].role,'user');
  await c.query('UPDATE users SET full_name=$1 WHERE id=$2',['Updated',user]);
  await c.query("INSERT INTO documents(id,owner_id,name,sha256,status,expires_at) VALUES($1,$2,'test.pdf',$3,'queued',now()+interval '2 hours')",[doc,user,'a'.repeat(64)]);
  await c.query("INSERT INTO document_assets VALUES($1,'input.pdf',$2)",[doc,Buffer.from('%PDF-test')]);
  await c.query('DELETE FROM documents WHERE id=$1',[doc]);assert.equal((await c.query('SELECT * FROM document_assets WHERE document_id=$1',[doc])).rowCount,0);
  throw Error('intentional rollback');
 }),/intentional rollback/);
 assert.equal((await pool.query('SELECT * FROM users WHERE id=$1',[user])).rowCount,0);
 await assert.rejects(pool.query("INSERT INTO users(id,username,full_name,role,password_hash) VALUES($1,'BAD','bad','root','x')",[randomUUID()]));
 await assert.rejects(pool.query("INSERT INTO sessions VALUES('bad',$1,now(),now(),now())",[randomUUID()]),e=>e.code==='23503');
 await assert.rejects(pool.query('UPDATE audit_logs SET action=action'),e=>e.code==='42501');
 await assert.rejects(pool.query('DELETE FROM audit_logs'),e=>e.code==='42501');
 await assert.rejects(pool.query('TRUNCATE audit_logs'),e=>e.code==='42501');
 assert.equal(databaseError({code:'23505'}).status,409);
 assert.equal(databaseError({code:'ECONNREFUSED',message:'secret'}).error.includes('secret'),false);
 console.log('PASS database: connection, transactional CRUD/rollback, foreign keys, validation, cascading assets, append-only grants, safe errors.');
 console.log('Imported reviews:',(await pool.query('SELECT count(*) FROM saved_reviews')).rows[0].count);
}finally{await pool.end();}
