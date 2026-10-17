import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveAdapter} from '../public/adapters.mjs';
import {blankLedger} from '../public/core.mjs';

test('missing billing offers setup without creating any file',async()=>{
 const a=new DriveAdapter();const calls=[];a.request=async url=>{calls.push(url);return {items:[]};};
 await assert.rejects(a.load(),e=>e.code==='MISSING_BILLING');assert.equal(calls.length,1);
});
test('setup refuses an unavailable original roster before writing',async()=>{
 const a=new DriveAdapter();let writes=0;a.roster=async()=>{throw new Error('Roster unavailable');};a.request=async()=>{writes++;};
 await assert.rejects(a.createEmpty(),/Roster unavailable/);assert.equal(writes,0);
});
test('setup reuses an existing billing file instead of making a duplicate',async()=>{
 const a=new DriveAdapter();a.roster=async()=>({patients:[]});a.locate=async()=>{a.fileId='existing';};a.load=async()=>({ledger:blankLedger('existing'),etag:'e1'});
 a.request=async()=>{throw new Error('Unexpected write');};assert.equal((await a.createEmpty()).ledger.datasetId,'existing');
});
test('setup creates only an empty ledger, and verifies it after upload',async()=>{
 const a=new DriveAdapter();a.roster=async()=>({patients:[]});a.locate=async()=>{const e=new Error();e.code='MISSING_BILLING';throw e;};
 const calls=[];a.request=async(url,options)=>{calls.push({url,options});return url.includes('generateIds')?{ids:['reserved-id']}:{id:'reserved-id'};};
 a.load=async()=>{assert.equal(a.fileId,'reserved-id');return {ledger:blankLedger('verified'),etag:'e1'};};
 assert.equal((await a.createEmpty()).etag,'e1');assert.equal(calls.length,2);const upload=calls[1];assert.equal(upload.options.method,'POST');assert.ok(upload.options.body.includes('"id":"reserved-id"'));assert.ok(upload.options.body.includes('"entries":[]'));assert.ok(!upload.options.body.includes('"permissions"'));
});
test('interrupted creation keeps its reserved ID when retried',async()=>{
 const a=new DriveAdapter();a.roster=async()=>({patients:[]});a.locate=async()=>{const e=new Error();e.code='MISSING_BILLING';throw e;};let generated=0,uploads=0;
 a.request=async(url,options)=>{if(url.includes('generateIds')){generated++;return {ids:['same-id']};}uploads++;assert.ok(options.body.includes('"id":"same-id"'));if(uploads===1)throw new Error('Disconnected');const e=new Error('Already exists');e.status=409;throw e;};a.load=async()=>({ledger:blankLedger(),etag:'verified'});
 await assert.rejects(a.createEmpty(),/Disconnected/);assert.equal((await a.createEmpty()).etag,'verified');assert.equal(generated,1);assert.equal(uploads,2);
});
