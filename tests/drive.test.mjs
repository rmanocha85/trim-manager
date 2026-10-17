import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveAdapter} from '../public/adapters.mjs';
import {blankLedger} from '../public/core.mjs';
test('cloud adapter refuses original roster as billing target',()=>{assert.throws(()=>new DriveAdapter('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'),/never/);});
test('cloud adapter maps conditional write conflict without retrying overwrite',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return new Response('{}',{status:412});};const a=new DriveAdapter('synthetic-billing');a.token='synthetic';a.current=blankLedger();await assert.rejects(a.save(a.current,'"etag-1"'),e=>e.status===409);assert.equal(calls.length,1);assert.equal(calls[0].opts.headers['If-Match'],'"etag-1"');assert.equal(calls[0].opts.method,'PUT');
});
test('cloud load refuses missing etags',async t=>{const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);globalThis.fetch=async url=>new Response(JSON.stringify(url.includes('alt=media')?blankLedger():{id:'test'}));const a=new DriveAdapter('test');a.token='synthetic';await assert.rejects(a.load(),/stable Drive revision/);});
test('cloud expired credentials produce recoverable 401, never success',async t=>{const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);globalThis.fetch=async()=>new Response('{}',{status:401});const a=new DriveAdapter('test');await assert.rejects(a.load(),e=>e.status===401&&e.message.includes('draft stays'));});
