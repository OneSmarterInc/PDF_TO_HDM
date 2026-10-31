import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const archive=require('archiver'),glob=require('glob');
test('patched matcher retains legacy glob and ExcelJS archive compatibility',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hdm-archive-'));
 try{
  await fs.mkdir(path.join(dir,'nested'));await fs.writeFile(path.join(dir,'nested','claim.txt'),'literal claim text');await fs.writeFile(path.join(dir,'skip.txt'),'skip');
  assert.deepEqual(glob.sync('**/*.txt',{cwd:dir,ignore:'skip.txt'}),['nested/claim.txt']);
  const zip=archive('zip'),chunks=[];zip.on('data',chunk=>chunks.push(chunk));
  const finished=new Promise((resolve,reject)=>{zip.on('end',resolve);zip.on('error',reject);zip.on('warning',reject);});
  zip.glob('**/*.txt',{cwd:dir,ignore:'skip.txt'});await zip.finalize();await finished;
  const bytes=Buffer.concat(chunks);assert.equal(bytes.subarray(0,2).toString(),'PK');assert.ok(bytes.includes(Buffer.from('nested/claim.txt')));assert.ok(!bytes.includes(Buffer.from('skip.txt')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
