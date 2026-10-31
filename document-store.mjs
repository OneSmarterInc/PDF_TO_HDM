import fs from 'node:fs/promises';import path from 'node:path';
import {transaction} from './db/index.mjs';import {audit,HttpError} from './security.mjs';
export function publicDocument(job){const {dir,ownerId,created,persisting,...data}=job;return data;}
export function createDocumentStore(pool,runtime){
 const hours=Number(process.env.DOCUMENT_RETENTION_HOURS||2);if(!Number.isFinite(hours)||hours<1||hours>8760)throw Error('Invalid DOCUMENT_RETENTION_HOURS');
 async function create(job,bytes,actor,ctx){await transaction(pool,async c=>{
  await c.query("INSERT INTO documents(id,owner_id,name,sha256,status,result,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 hour')",[job.id,actor.id,job.name,job.sha256,job.status,publicDocument(job),hours]);
  await c.query("INSERT INTO document_assets(document_id,name,data) VALUES($1,'input.pdf',$2)",[job.id,bytes]);await audit(c,actor,'document_created','documents',job.id,{},ctx);
 });}
 async function load(id,ownerId){const r=await pool.query('SELECT * FROM documents WHERE id=$1 AND owner_id=$2 AND expires_at>now()',[id,ownerId]);if(!r.rowCount)return null;const row=r.rows[0],dir=path.join(runtime,id);await fs.mkdir(dir,{recursive:true});const assets=(await pool.query('SELECT name,data FROM document_assets WHERE document_id=$1',[id])).rows;for(const a of assets)await fs.writeFile(path.join(dir,a.name),a.data);return {...row.result,id,ownerId,dir,name:row.name,sha256:row.sha256,status:row.status,version:row.version,created:new Date(row.created_at).getTime()};}
 async function save(job,actor,action,metadata={},ctx={},assets=false){
  const files=assets?(await fs.readdir(job.dir)).filter(n=>/^page-\d+\.png$/.test(n)):[];
  await transaction(pool,async c=>{
   const updated=await c.query('UPDATE documents SET result=$1,status=$2,updated_at=now(),version=version+1 WHERE id=$3 AND owner_id=$4 AND version=$5 RETURNING version',[publicDocument(job),job.status,job.id,job.ownerId,job.version||0]);
   if(!updated.rowCount)throw new HttpError(409,'Document changed or expired. Reload before saving.');
   for(const name of files)await c.query('INSERT INTO document_assets(document_id,name,data) VALUES($1,$2,$3) ON CONFLICT(document_id,name) DO UPDATE SET data=EXCLUDED.data',[job.id,name,await fs.readFile(path.join(job.dir,name))]);
   await audit(c,actor,action,'documents',job.id,metadata,ctx);
  });job.version=(job.version||0)+1;
 }
 async function remove(job,actor,ctx){await transaction(pool,async c=>{const r=await c.query('DELETE FROM documents WHERE id=$1 AND owner_id=$2',[job.id,actor.id]);if(r.rowCount)await audit(c,actor,'document_deleted','documents',job.id,{status:job.status},ctx);});}
 async function expired(){return (await pool.query('SELECT id,owner_id FROM documents WHERE expires_at<now()')).rows;}
 async function expire(row){await transaction(pool,async c=>{const r=await c.query('DELETE FROM documents WHERE id=$1 AND expires_at<now()',[row.id]);if(r.rowCount)await audit(c,null,'document_expired','documents',row.id);});}
 return {create,load,save,remove,expired,expire};
}
