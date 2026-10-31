import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({path:'.env.migration',quiet:true});
const runtimeRole=process.env.DATABASE_RUNTIME_ROLE||'clarity_app';
if(!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole))throw Error('Invalid DATABASE_RUNTIME_ROLE');
if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL is required.');
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPool,transaction} from '../db/index.mjs';
const pool=createPool(process.env.MIGRATION_DATABASE_URL);
try{
 await transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(4317001)');
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await fs.readdir('db')).filter(f=>/^\d+.*\.sql$/.test(f)).sort()){
   const sql=await fs.readFile('db/'+name,'utf8'),hash=createHash('sha256').update(sql).digest('hex');
   const old=await c.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
   if(old.rowCount){if(old.rows[0].checksum!==hash)throw Error('Applied migration has changed: '+name);continue;}
   await c.query(sql);await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,hash]);console.log('Applied '+name);
  }
  await c.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await c.query('GRANT USAGE ON SCHEMA public TO '+runtimeRole);
  await c.query('GRANT SELECT,INSERT,UPDATE,DELETE ON users,sessions,login_limits,documents,document_assets TO '+runtimeRole);
  await c.query('GRANT SELECT ON roles,saved_reviews TO '+runtimeRole);
  await c.query('GRANT SELECT,INSERT ON audit_logs TO '+runtimeRole);
  await c.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO '+runtimeRole);
 });
 // Import private exact-source reviews without changing or removing the originals.
 const files=await fs.readdir('reviews').catch(()=>[]);let imported=0;
 for(const name of files.filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){const data=JSON.parse(await fs.readFile('reviews/'+name,'utf8'));await pool.query('INSERT INTO saved_reviews(sha256,data) VALUES($1,$2) ON CONFLICT DO NOTHING',[name.slice(0,-5),data]);imported++;}
 console.log('Migrations verified; review files preserved/imported: '+imported);
}finally{await pool.end();}
