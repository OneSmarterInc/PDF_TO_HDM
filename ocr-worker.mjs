import {createDocumentStore,publicDocument} from './document-store.mjs';


import 'dotenv/config';
import {createPool,databaseError} from './db/index.mjs';
import {audit,passwordPolicy} from './security.mjs';
import http from 'node:http';
import {serverConfig} from './deployment-config.mjs';

import path from 'node:path';


import fs from 'node:fs/promises';

import {existsSync} from 'node:fs';

import {fileURLToPath} from 'node:url';

import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';

import {execFile} from 'node:child_process';

import {promisify} from 'node:util';

import {createWorker} from 'tesseract.js';

import {organize} from './extract.mjs';


import {extractAccurate,applyVerification,applyCheckboxes,normalizeReading} from './accuracy.mjs';

import {savedReviewMatches} from './review-cache.mjs';

import {abortable} from './cancellation.mjs';

import {serialConsumer} from './pipeline.mjs';

import {verifyDocument} from './auto-verify.mjs';



const root = path.dirname(fileURLToPath(import.meta.url));

const run = promisify(execFile);

const {port,host,origin}=serverConfig();
if(process.env.NODE_ENV==='production')passwordPolicy(process.env.TEMPORARY_PASSWORD);

const platformPython=process.platform==='win32'?'Scripts/python.exe':'bin/python';

const localPython=path.join(root,'.venv',platformPython);

const python = process.env.PYTHON_PATH || (existsSync(localPython) ? localPython : 'python');

const pool=createPool();
await pool.query("SELECT name FROM roles WHERE name='admin'");

const jobs = new Map();

const controllers = new Map();

let active = false;
let stopping=false;

const maxQueued=Number(process.env.MAX_QUEUED_DOCUMENTS||3);
if(!Number.isInteger(maxQueued)||maxQueued<1||maxQueued>100)throw Error('Invalid MAX_QUEUED_DOCUMENTS');

const queue = [];

let worker;

let current;

let exporting=false;

const databaseIdentity=new URL(process.env.DATABASE_URL);
const runtimeRoot=path.resolve(process.env.RUNTIME_DIR||path.join(root,'.runtime'));
const runtimeBase=path.join(runtimeRoot,createHash('sha256').update(databaseIdentity.host+databaseIdentity.pathname).digest('hex').slice(0,16));
if(!path.resolve(runtimeBase).startsWith(runtimeRoot+path.sep))throw Error('Invalid runtime path');
const runtime=path.join(runtimeBase,randomUUID());
await fs.mkdir(runtime,{recursive:true});

await fs.mkdir(path.join(root,'models'),{recursive:true});
const store=createDocumentStore(pool,runtime);
const processLease=await pool.connect();
processLease.on('error',()=>{console.error('Worker database lease lost; stopping for safe recovery.');process.exit(1);});
if(!(await processLease.query('SELECT pg_try_advisory_lock(4317010) AS locked')).rows[0].locked)throw Error('Another OCR server is already using this database.');
// Only this database's worker holds the lease. Remove its prior transient OCR files before recovery.
async function cleanPreviousRuntime(){for(const entry of await fs.readdir(runtimeBase)){if(entry!==path.basename(runtime)&&/^[a-f0-9-]{36}$/.test(entry))await fs.rm(path.join(runtimeBase,entry),{recursive:true,force:true}).catch(()=>{});}}
await cleanPreviousRuntime();



function json(res, status, value) {

  res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});

  res.end(JSON.stringify(value));

}

async function processQueue() {

  if(active) return;

  active = true;

  while(queue.length&&!stopping) {

    const job = queue.shift(); current = job;

    if(job.cancelled){current=undefined;continue;}

    const signal=controllers.get(job.id).signal;

    const runJob=(file,args,options)=>run(file,args,{...options,signal});

    const began=Date.now();job.timings={};let checkpoint=began;

    const timed=stage=>{const now=Date.now();job.timings[stage]=now-checkpoint;checkpoint=now;};

    try {

      job.status = 'processing'; job.message = 'Rendering PDF pages…';

      await runJob(python, [path.join(root,'render_pdf.py'),path.join(job.dir,'input.pdf'),job.dir], {timeout:120000,windowsHide:true,maxBuffer:1024*1024});

      const pages = JSON.parse(await fs.readFile(path.join(job.dir,'pages.json'),'utf8'));

      timed('renderMs');

      const saved=(await pool.query('SELECT data FROM saved_reviews WHERE sha256=$1',[job.sha256])).rows[0]?.data;

      if(savedReviewMatches(saved,job.sha256,pages)){

        job.pages=saved.pages;job.sourceAudit=saved.sourceAudit;job.reviewApplied=true;job.total=pages.length;job.completed=pages.length;

        for(const p of job.pages)for(const f of p.fields)f.sourceCheckedValue=f.value;verifyDocument(job);

        job.status='complete';job.message='Loaded saved review for this exact PDF';current=undefined;continue;

      }

      job.total = pages.length;

      job.message='Reading pages with both OCR engines…';

      const neuralTask=runJob(python,[path.join(root,'read_pages.py'),job.dir],{timeout:Math.max(180000,pages.length*90000),windowsHide:true,maxBuffer:1024*1024});

      const tesseractTask=(async()=>{

      if(!worker) {

        worker = await abortable(createWorker('eng', 1, {cachePath:path.join(root,'models'),cacheMethod:'readOnly',langPath:path.join(root,'models'),gzip:false,logger: info => {

          if(current && info.status === 'recognizing text') current.pageProgress = Math.round(info.progress*100);

        }}).then(w=>{if(signal.aborted){void w.terminate().catch(()=>{});throw signal.reason;}return w;}),signal);

      }

      const results=[];

      for(const page of pages) {

        job.pageProgress=0;

        await abortable(worker.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'}),signal);

        const {data} = await abortable(worker.recognize(path.join(job.dir,`page-${page.number}.png`),{}, {text:true,blocks:true}),signal);

        results.push(data);

      }

      return results;

      })();

      let pageReadings;

      try{[,pageReadings]=await Promise.all([neuralTask,tesseractTask]);}

      catch(e){controllers.get(job.id)?.abort(e);await Promise.allSettled([neuralTask,tesseractTask]);throw e;}

      timed('pageOcrMs');

      for(const [index,page] of pages.entries()){

        const data=pageReadings[index];

        const organized = organize(data,page);

        const neural=JSON.parse(await fs.readFile(path.join(job.dir,`neural-${page.number}.json`),'utf8'));

        Object.assign(organized,extractAccurate(neural,data,organized));

        job.pages.push(organized);

        job.completed = page.number;

      }

      const pending=job.pages.flatMap(p=>p.fields.map((f,index)=>({page:p.number,index,label:f.label,bbox:f.bbox})));

      if(pending.length){

        job.message='Zooming in and checking each field against two close-up readings…';

        job.verified=0;job.verifyTotal=pending.length;

        const input=path.join(job.dir,'verify-input.json'),output=path.join(job.dir,'verify-output.json');

        await fs.writeFile(input,JSON.stringify(pending));

        const readings=[];

        const consumer=serialConsumer(async reading=>{

          signal.throwIfAborted();

          await abortable(worker.setParameters({tessedit_pageseg_mode:reading.single?'7':'6',preserve_interword_spaces:'1'}),signal);

          const {data}=await abortable(worker.recognize(path.join(job.dir,reading.cropFile)),signal);

          reading.independent={text:data.text,confidence:data.confidence};
          if(reading.single&&data.confidence<90){
            await abortable(worker.setParameters({tessedit_pageseg_mode:'8'}),signal);
            const retry=await abortable(worker.recognize(path.join(job.dir,reading.cropFile)),signal);
            reading.independentAttempts=[reading.independent,{text:retry.data.text,confidence:retry.data.confidence}];
            if(retry.data.confidence>data.confidence)reading.independent=reading.independentAttempts[1];
          }

          if(reading.single&&reading.independent.confidence<90&&reading.smallCropFile){
            const label=pending.find(p=>p.page===reading.page&&p.index===reading.index)?.label||'';
            reading.independentAttempts??=[reading.independent];
            for(const mode of ['7','8']){
              await abortable(worker.setParameters({tessedit_pageseg_mode:mode}),signal);
              const retry=await abortable(worker.recognize(path.join(job.dir,reading.smallCropFile)),signal);
              const candidate={text:retry.data.text,confidence:retry.data.confidence};reading.independentAttempts.push(candidate);
              if(normalizeReading(label,candidate.text)&&(!normalizeReading(label,reading.independent.text)||candidate.confidence>reading.independent.confidence))reading.independent=candidate;
            }
          }
          readings.push(reading);job.verified=readings.length;job.verifyTotal=pending.length;

        });

        const verification=runJob(python,[path.join(root,'verify_regions.py'),job.dir,input,output],{timeout:Math.max(120000,pending.length*5000),windowsHide:true,maxBuffer:32*1024*1024});

        let buffer='',streamError;verification.child.stdout.setEncoding('utf8');

        verification.child.stdout.on('data',chunk=>{

          buffer+=chunk;let end;

          while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(line.startsWith('FIELD_RESULT:')){try{consumer.push(JSON.parse(line.slice(13)));}catch(e){streamError=e;}}}

        });

        let processError;try{await verification;}catch(e){processError=e;}

        await consumer.drain();if(processError)throw processError;if(streamError)throw streamError;

        const produced=JSON.parse(await fs.readFile(output,'utf8'));

        if(produced.length!==readings.length||produced.some((r,i)=>r.page!==readings[i].page||r.index!==readings[i].index))throw Error('Incomplete field verification stream');

        applyVerification(job.pages,readings);

      }else applyVerification(job.pages,[]);

      timed('fieldVerificationMs');

      const checkRequests=job.pages.flatMap(p=>(p.checkboxRequests||[]).map(r=>({...r,page:p.number})));

      if(checkRequests.length){

        job.message='Checking crosses and blank checkbox interiors…';

        const input=path.join(job.dir,'checkbox-input.json'),output=path.join(job.dir,'checkbox-output.json');

        await fs.writeFile(input,JSON.stringify(checkRequests));

        await runJob(python,[path.join(root,'read_checkboxes.py'),job.dir,input,output],{timeout:60000,windowsHide:true});

        applyCheckboxes(job.pages,JSON.parse(await fs.readFile(output,'utf8')));

      }

      timed('checkboxMs');job.timings.totalMs=Date.now()-began;

      signal.throwIfAborted();job.message='Running automatic verification…';verifyDocument(job);job.status = 'complete'; job.message='All pages processed';

    } catch(e) {

      if(stopping){job.status='queued';job.message='Processing interrupted; resumes after restart.';}
      else if(job.cancelled){job.status='cancelled';job.message='Processing cancelled';}

      else {

      job.status='error';

      job.message = /password|encrypt/i.test(e.message) ? 'This PDF is password protected. Upload an unlocked copy.' : /30 pages/.test(e.message) ? 'Please upload a PDF with 30 pages or fewer.' : 'Could not read this PDF. Check that it opens correctly. Contact your administrator if the problem persists.';

      console.error('Document processing failed:',job.id,e.code||e.name);

      if(worker) {const failed=worker;worker=undefined;void failed.terminate().catch(()=>{});}

      }

    } finally {

      if(!job.cancelled){job.persisting=true;try{const actor=(await pool.query('SELECT id,username,role FROM users WHERE id=$1',[job.ownerId])).rows[0];await store.save(job,actor,job.status==='complete'?'document_processed':job.status==='queued'?'document_interrupted':'document_failed',{status:job.status},{},job.status==='complete');}catch(e){job.status='error';job.message='Could not persist processing results. Retry this document.';console.error('Persistence failed:',e.code||e.name);}finally{job.persisting=false;}}
      controllers.delete(job.id);

      if(job.cancelled)await fs.rm(job.dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});

    }

    current=undefined;

  }

  active=false;

}



// Private worker protocol. This listener never serves a browser or authenticates users.
const workerToken=process.env.OCR_WORKER_TOKEN;
if(!workerToken||workerToken.length<32)throw Error('OCR_WORKER_TOKEN must contain at least 32 characters.');
const workerPort=Number(process.env.OCR_WORKER_PORT||4319);
const authorized=req=>{const token=Buffer.from(req.headers['x-worker-token']||''),expected=Buffer.from(workerToken);return token.length===expected.length&&timingSafeEqual(token,expected);};
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)throw Error('Worker request too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const loadingJobs=new Set();
const cancelledJobs=new Set();
async function enqueue(id,ownerId){
 if(jobs.has(id)||loadingJobs.has(id)||cancelledJobs.has(id))return;
 loadingJobs.add(id);
 try{
 const job=await store.load(id,ownerId);if(!job||cancelledJobs.has(id)||!['queued','processing'].includes(job.status))return;
 job.pages=[];job.status='queued';job.message='Waiting to process…';jobs.set(id,job);controllers.set(id,new AbortController());queue.push(job);void processQueue();
 }finally{loadingJobs.delete(id);}
}
const server=http.createServer(async(req,res)=>{
 if(!authorized(req))return json(res,403,{error:'Private worker access only.'});
 try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/healthz')return json(res,200,{status:stopping?'stopping':'ok'});
 if(stopping)return json(res,503,{error:'Worker restarting.'});
 if(url.pathname==='/jobs'&&req.method==='POST'){const b=await body(req);await enqueue(b.id,b.ownerId);return json(res,202,{ok:true});}
 const match=url.pathname.match(/^\/jobs\/([a-f0-9-]{36})$/);
 if(match){const job=jobs.get(match[1]);
  if(req.method==='GET'){if(!job||['complete','error'].includes(job.status)&&!job.persisting)return json(res,200,{active:false});return json(res,200,{active:true,document:{...publicDocument(job),...(job.persisting?{status:'processing',message:'Saving verified results…'}:{})}});}
  if(req.method==='DELETE'){
   cancelledJobs.add(match[1]);
   if(job){job.cancelled=true;job.status='cancelled';controllers.get(job.id)?.abort(new Error('Processing cancelled'));const pos=queue.indexOf(job);if(pos>=0)queue.splice(pos,1);if(current===job&&worker){const old=worker;worker=undefined;void old.terminate().catch(()=>{});}jobs.delete(job.id);if(current!==job){controllers.delete(job.id);await fs.rm(job.dir,{recursive:true,force:true});}}
   return json(res,200,{ok:true});
  }
 }
 if(url.pathname==='/verify'&&req.method==='POST'){const doc=await body(req);verifyDocument(doc);return json(res,200,doc);}
 if(url.pathname==='/export'&&req.method==='POST'){
  if(exporting)return json(res,429,{error:'Another Excel export is running. Try again shortly.'});
  exporting=true;const id=randomUUID(),input=path.join(runtime,id+'.json'),output=path.join(runtime,id+'.xlsx');
  try{await fs.writeFile(input,JSON.stringify(await body(req)));await run(process.execPath,[path.join(root,'excel/build.mjs'),input,output],{timeout:120000,windowsHide:true,maxBuffer:1024*1024});const bytes=await fs.readFile(output);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});res.end(bytes);}
  finally{exporting=false;await fs.rm(input,{force:true});await fs.rm(output,{force:true});}return;
 }
 json(res,404,{error:'Worker operation not found.'});
 }catch(e){console.error('Worker operation failed:',e.code||e.name);if(!res.headersSent)json(res,500,{error:'Document worker could not complete the operation.'});}
});
server.requestTimeout=120000;server.headersTimeout=15000;
// Database-backed discovery also covers uploads accepted while the worker was restarting.
async function recover(){if(stopping)return;for(const row of (await pool.query("SELECT id,owner_id FROM documents WHERE status IN ('queued','processing') AND expires_at>now() ORDER BY created_at")).rows)await enqueue(row.id,row.owner_id);}
await recover();
const discoveryTimer=setInterval(()=>recover().catch(()=>console.error('Worker discovery failed; retrying.')),2000).unref();
const cleanupTimer=setInterval(async()=>{try{for(const [id,job] of jobs)if(['complete','error'].includes(job.status)&&!job.persisting){jobs.delete(id);await fs.rm(job.dir,{recursive:true,force:true}).catch(()=>{});}for(const row of await store.expired()){const job=jobs.get(row.id);if(job&&['processing','queued'].includes(job.status))continue;await store.expire(row);await fs.rm(path.join(runtime,row.id),{recursive:true,force:true}).catch(()=>{});}await pool.query("DELETE FROM sessions WHERE expires_at<now() OR last_seen_at<now()-interval '30 minutes'");await pool.query("DELETE FROM login_limits WHERE window_started<now()-interval '1 day'");}catch{console.error('Scheduled cleanup failed; will retry.');}},60000).unref();
server.listen(workerPort,'127.0.0.1',()=>console.log('Private OCR worker ready'));
async function stop(){if(stopping)return;stopping=true;clearInterval(discoveryTimer);clearInterval(cleanupTimer);setTimeout(()=>process.exit(1),90000).unref();const drained=new Promise(resolve=>server.close(resolve));for(const c of controllers.values())c.abort(new Error('Server shutting down'));if(worker)await worker.terminate().catch(()=>{});while(active)await new Promise(resolve=>setTimeout(resolve,100));await drained;await fs.rm(runtime,{recursive:true,force:true});processLease.release();await pool.end();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
