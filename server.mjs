import {createDocumentStore,publicDocument} from './document-store.mjs';
import {handleAudit} from './audit-history.mjs';
import {handleAdmin,pagination} from './admin.mjs';
import 'dotenv/config';
import {createPool,databaseError} from './db/index.mjs';
import {createSecurity,HttpError,audit,requestContext,passwordPolicy} from './security.mjs';
import http from 'node:http';
import {serverConfig} from './deployment-config.mjs';

import path from 'node:path';


import fs from 'node:fs/promises';

import {existsSync} from 'node:fs';

import {fileURLToPath} from 'node:url';

import {randomUUID,createHash} from 'node:crypto';

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
const security=createSecurity(pool,origin);
const jobs = new Map();

const controllers = new Map();

let active = false;
let stopping=false;
let receiving=0;
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



const server = http.createServer(async(req,res)=>{
  let reservedUpload=false;
  try {

    req.requestId=randomUUID();
    res.setHeader('X-Request-ID',req.requestId);res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000');
    const url = new URL(req.url,origin);
    if(stopping){res.setHeader('Connection','close');return json(res,503,{error:'Service restarting. Please retry shortly.'});}
    if(url.pathname==='/healthz'&&req.method==='GET'){await pool.query('SELECT 1');return json(res,200,{status:'ok'});}
    if(await security.handle(req,res,url,json))return;
    let actor;
    if(url.pathname.startsWith('/api/'))actor=await security.requireUser(req,{admin:url.pathname.startsWith('/api/admin/')});

    if(await handleAudit(req,res,url,actor,pool,json))return;
    if(await handleAdmin(req,res,url,actor,pool,json))return;
    // Only same-origin browser calls may upload or remove documents.

    if(req.headers.origin && req.headers.origin!==origin) return json(res,403,{error:'Origin not allowed'});

    if(req.method==='GET'&&url.pathname==='/api/documents'){
      const {page,size,offset}=pagination(url);const rows=(await pool.query('SELECT id,name,status,created_at,expires_at FROM documents WHERE owner_id=$1 AND expires_at>now() ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[actor.id,size,offset])).rows;const total=Number((await pool.query('SELECT count(*) FROM documents WHERE owner_id=$1 AND expires_at>now()',[actor.id])).rows[0].count);return json(res,200,{rows,total,page,size});
    }
    const exportEvent=url.pathname.match(/^\/api\/documents\/([a-f0-9-]{36})\/exports\/(txt|json)$/);
    if(exportEvent&&req.method==='POST'){const r=await pool.query("SELECT id FROM documents WHERE id=$1 AND owner_id=$2 AND status='complete' AND expires_at>now()",[exportEvent[1],actor.id]);if(!r.rowCount)return json(res,404,{error:'Document not found.'});await audit(pool,actor,'document_exported','documents',exportEvent[1],{format:exportEvent[2]},requestContext(req));return json(res,200,{ok:true});}
    if(req.method==='POST' && url.pathname==='/api/documents') {

      if(receiving>=3||queue.length+(active?1:0)+receiving>=maxQueued)return json(res,429,{error:'The processing queue is full. Please try again shortly.'});receiving++;reservedUpload=true;

      let size=0; const chunks=[];

      for await(const chunk of req) {size+=chunk.length;if(size>30*1024*1024) {json(res,413,{error:'Maximum PDF size is 30 MB.'});return;} chunks.push(chunk);}

      const bytes=Buffer.concat(chunks);

      if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) return json(res,400,{error:'Choose a valid PDF file.'});

      const id=randomUUID(); const dir=path.join(runtime,id);await fs.mkdir(dir);

      await fs.writeFile(path.join(dir,'input.pdf'),bytes);

      let name;try{name=decodeURIComponent(req.headers['x-file-name']||'Document.pdf');}catch{name='Document.pdf';}

      const job={id,dir,ownerId:actor.id,name:name.slice(0,200),sha256:createHash('sha256').update(bytes).digest('hex'),status:'queued',message:'Waiting to process…',pages:[],completed:0,total:0,pageProgress:0,created:Date.now()};

      await store.create(job,bytes,actor,requestContext(req));jobs.set(id,job);controllers.set(id,new AbortController());queue.push(job);json(res,202,{id});void processQueue();return;

    }

    const match=url.pathname.match(/^\/api\/documents\/([\w-]+)(?:\/(page-\d+\.png|original\.pdf|export\.xlsx))?$/);

    if(match) {

      let job=jobs.get(match[1])||await store.load(match[1],actor.id);if(job)jobs.set(job.id,job);if(!job||job.ownerId!==actor.id)return json(res,404,{error:'Document expired. Upload it again.'});

      if(req.method==='PATCH' && !match[2]) {

        if(job.status!=='complete'||job.persisting)return json(res,409,{error:'Wait for processing to finish.'});
        job=structuredClone(job);

        let content='';for await(const chunk of req){content+=chunk;if(content.length>8192)return json(res,413,{error:'Correction is too long.'});}

        let change;try{change=JSON.parse(content);}catch{return json(res,400,{error:'Invalid correction.'});}

        if(change.version!==undefined&&change.version!==(job.version||0))return json(res,409,{error:'This document changed in another tab. Reload before editing.'});
        const field=Number.isInteger(change.page)&&Number.isInteger(change.field)?job.pages[change.page]?.fields?.[change.field]:null;

        if(!field||typeof change.value!=='string'||change.value.length>4000)return json(res,400,{error:'Invalid correction.'});

        if(field.kind==='checkbox'){

          if(change.value!=='None selected'&&!field.options.some(o=>o.label===change.value))return json(res,400,{error:'Choose one of the printed options, or None selected.'});

          field.options=field.options.map(o=>({...o,state:o.label===change.value?'selected':'unselected'}));

        }

        field.userEdited=true;field.originalValue ??= field.rawValue??field.value;field.value=change.value;field.reviewed=true;field.status='reviewed';

        if(/^Service \d+$/.test(field.group)){

          const row=job.pages[change.page].serviceLines?.find(r=>r.line===Number(field.group.split(' ')[1]));

          const names=['Service date from','Service date to','Place of service','Emergency indicator','CPT / HCPCS','Modifiers','Diagnosis pointer','Charge','Days / units','EPSDT / family plan','ID qualifier','Rendering provider ID'];

          const c=names.indexOf(field.label);if(row&&c>=0)row.values[c]=field.value;

          const extra={'Revenue code':'revenueCode','Service description':'description','Non-covered charges':'nonCovered'};

          if(row&&extra[field.label])row[extra[field.label]]=field.value;

        }

        verifyDocument(job);await store.save(job,actor,'document_updated',{page:change.page+1,field:field.label},requestContext(req));jobs.set(job.id,job);return json(res,200,{version:job.version,field,pages:job.pages,verification:job.verification,serviceLines:job.pages[change.page].serviceLines});

      }

      if(req.method==='DELETE') {

        await store.remove(job,actor,requestContext(req));const running=current===job;job.cancelled=true;job.status='cancelled';

        controllers.get(job.id)?.abort(new Error('Processing cancelled'));

        const position=queue.indexOf(job);if(position>=0)queue.splice(position,1);

        if(running&&worker){const old=worker;worker=undefined;void old.terminate().catch(()=>{});}

        jobs.delete(job.id);

        if(!running){controllers.delete(job.id);await fs.rm(job.dir,{recursive:true,force:true});}

        return json(res,200,{ok:true,cancelled:true});

      }

      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});

      if(match[2]==='export.xlsx') {

        if(job.status!=='complete'||job.persisting)return json(res,409,{error:'Wait for the PDF to finish processing.'});

        if(exporting)return json(res,429,{error:'Another Excel export is running. Try again shortly.'});

        exporting=true;

        const exportId=randomUUID();const input=path.join(job.dir,exportId+'.json'),output=path.join(job.dir,exportId+'.xlsx');

        try {

          const {dir,created,...data}=job;

          await fs.writeFile(input,JSON.stringify({...data,includeRaw:url.searchParams.get('raw')==='1'}));

          const runtimeNode=process.execPath;

          await run(runtimeNode,[path.join(root,'excel/build.mjs'),input,output],{timeout:120000,windowsHide:true,maxBuffer:1024*1024});

          const bytes=await fs.readFile(output);

          await audit(pool,actor,'document_exported','documents',job.id,{format:'xlsx'},requestContext(req));
          const filename=job.name.replace(/\.pdf$/i,'')+'.xlsx';

          res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="claims.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);

        } catch(e){console.error('Excel export failed:',req.requestId,e.code||e.name);if(!res.headersSent)json(res,500,{error:'Excel export could not be completed. Please try again.'});}

        finally{exporting=false;await fs.rm(input,{force:true}).catch(()=>{});await fs.rm(output,{force:true}).catch(()=>{});}

        return;

      }

      if(match[2]) {

        const name=match[2]==='original.pdf'?'input.pdf':match[2];

        const buffer=await fs.readFile(path.join(job.dir,name));

        res.writeHead(200,{'Content-Type':name.endsWith('.pdf')?'application/pdf':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(buffer);return;

      }

      const safe=publicDocument(job);if(job.persisting){safe.status='processing';safe.message='Saving verified results…';}return json(res,200,safe);

    }

    const icon=url.pathname.match(/^\/icons\/(file-text|files|layout-dashboard|users|history|key-round|log-out|menu|pencil|check|eye|eye-off)\.svg$/);if(icon&&req.method==='GET'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'public,max-age=86400'});res.end(await fs.readFile(path.join(root,'public/icons',icon[1]+'.svg')));return;}
    const staticFiles={'/favicon.ico':'favicon.svg','/favicon.svg':'favicon.svg','/':'index.html','/portal':'index.html','/documents':'documents.html','/documents.js':'documents.js','/admin':'admin.html','/admin/users':'admin.html','/admin/audit':'admin.html','/admin.js':'admin.js','/audit.js':'audit.js','/login':'login.html','/change-password':'password.html','/app.js':'app.js','/style.css':'style.css','/session.js':'session.js','/date-format.js':'date-format.js','/password-visibility.js':'password-visibility.js','/login.js':'login.js','/password.js':'password.js','/portal.css':'portal.css'};
    if(req.method==='GET'&&['/','/portal','/documents','/change-password','/admin','/admin/users','/admin/audit'].includes(url.pathname)){const user=await security.identify(req);const destination=!user?'/login':user.must_change_password&&url.pathname!=='/change-password'?'/change-password':null;if(user&&url.pathname.startsWith('/admin')&&user.role!=='admin'){res.writeHead(302,{Location:'/portal'});res.end();return;}if(destination){res.writeHead(302,{Location:destination,'Cache-Control':'no-store'});res.end();return;}}

    const file=staticFiles[url.pathname];

    if(req.method==='GET' && file) {

      res.writeHead(200,{'Content-Type':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','X-Content-Type-Options':'nosniff','Cache-Control':file.endsWith('.html')?'no-store':'no-cache'});

      res.end(await fs.readFile(path.join(root,'public',file)));return;

    }

    json(res,404,{error:'Not found'});

  } catch(e) {const failure=e instanceof HttpError?{status:e.status,error:e.message}:e.code?databaseError(e):{status:500,error:'The request could not be completed.'};if(!res.headersSent)json(res,failure.status,{error:failure.error});else res.end();}finally{if(reservedUpload)receiving--;}

});
server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;

const cleanupTimer=setInterval(async()=>{
 try{await cleanPreviousRuntime();for(const row of await store.expired()){const job=jobs.get(row.id);if(job&&['processing','queued'].includes(job.status))continue;await store.expire(row);jobs.delete(row.id);await fs.rm(path.join(runtime,row.id),{recursive:true,force:true}).catch(()=>{});}
 await pool.query("DELETE FROM sessions WHERE expires_at<now() OR last_seen_at<now()-interval '30 minutes'");await pool.query("DELETE FROM login_limits WHERE window_started<now()-interval '1 day'");
 }catch{console.error('Scheduled cleanup failed; will retry.');}
},60000).unref();
// Recover unfinished work from durable original uploads after a process restart.
for(const row of (await pool.query("SELECT id,owner_id FROM documents WHERE status IN ('queued','processing') AND expires_at>now() ORDER BY created_at")).rows){const job=await store.load(row.id,row.owner_id);job.pages=[];job.status='queued';job.message='Resuming interrupted processing…';await audit(pool,null,'document_resumed','documents',job.id,{reason:'restart'});jobs.set(job.id,job);controllers.set(job.id,new AbortController());queue.push(job);}
void processQueue();

server.listen(port,host,()=>console.log(`PDF Extractor HDM ready on ${host}:${port}`));

async function stop(){if(stopping)return;stopping=true;clearInterval(cleanupTimer);const deadline=setTimeout(()=>process.exit(1),90000);deadline.unref();const drained=new Promise(resolve=>server.close(resolve));for(const controller of controllers.values())controller.abort(new Error('Server shutting down'));if(worker)await worker.terminate().catch(()=>{});while(active)await new Promise(resolve=>setTimeout(resolve,100));await drained;await fs.rm(runtime,{recursive:true,force:true});processLease.release();await pool.end();process.exit(0);}

process.on('SIGINT',stop);process.on('SIGTERM',stop);
