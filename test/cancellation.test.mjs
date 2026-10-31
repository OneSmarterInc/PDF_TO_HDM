import test from 'node:test';
import assert from 'node:assert/strict';
import {abortable} from '../cancellation.mjs';
test('cancellation releases a stalled operation without waiting for OCR',async()=>{
 const controller=new AbortController();const pending=abortable(new Promise(()=>{}),controller.signal);
 controller.abort(new Error('Cancelled'));await assert.rejects(pending,/Cancelled/);
});
test('completion and failure are preserved when not cancelled',async()=>{
 const controller=new AbortController();assert.equal(await abortable(Promise.resolve(42),controller.signal),42);
 await assert.rejects(abortable(Promise.reject(new Error('OCR error')),controller.signal),/OCR error/);
});
test('already-cancelled work consumes late rejections safely',async()=>{
 const controller=new AbortController();controller.abort(new Error('Cancelled'));
 await assert.rejects(abortable(Promise.reject(new Error('Late failure')),controller.signal),/Cancelled/);
});
