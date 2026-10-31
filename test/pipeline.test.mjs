import test from 'node:test';import assert from 'node:assert/strict';
import {serialConsumer} from '../pipeline.mjs';
test('streaming verification keeps crop order and drains every crop',async()=>{
 const result=[];const c=serialConsumer(async n=>{await new Promise(r=>setTimeout(r,5));result.push(n);});
 for(let n=0;n<5;n++)c.push(n);await c.drain();assert.deepEqual(result,[0,1,2,3,4]);
});
test('a failed crop stops later work and cannot silently pass verification',async()=>{
 const result=[];const c=serialConsumer(async n=>{if(n===2)throw Error('OCR stopped');result.push(n);});
 for(let n=0;n<5;n++)c.push(n);await assert.rejects(c.drain(),/OCR stopped/);assert.deepEqual(result,[0,1]);
});
