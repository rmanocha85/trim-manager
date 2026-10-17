import test from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger} from '../public/core.mjs';
import {snapshot,cutoff,owned,validateSnapshot,writeLocal,pruneLocal,BackupManager,DriveBackups} from '../public/backups.mjs';
const make=(revision=1,date='2026-10-12T18:00:00.000Z')=>({...blankLedger('synthetic-backup'),revision,updatedAt:date});
function local(){const files=new Map();return {files,queryPermission:async()=> 'granted',getFileHandle:async(name,{create=false}={})=>{if(!files.has(name)){if(!create){const e=new Error('missing');e.name='NotFoundError';throw e;}files.set(name,'');}return {kind:'file',getFile:async()=>({text:async()=>files.get(name)}),createWritable:async()=>({write:async text=>files.set(name,text),close:async()=>{},abort:async()=>{}})};},async *entries(){for(const n of files.keys())yield [n,await this.getFileHandle(n)];},removeEntry:async name=>files.delete(name)};}
test('snapshots deterministic, complete, distinct by revision, wrong ledger/corruption refused',async()=>{
 const l=make(),s=await snapshot(l);assert.deepEqual(await validateSnapshot(s.text,s.dataset,s.sha),l);assert.deepEqual(await snapshot(l),s);
 assert.notEqual((await snapshot(make(2))).name,s.name);await assert.rejects(validateSnapshot(s.text,'wrong',s.sha));await assert.rejects(validateSnapshot(s.text+' ',s.dataset,s.sha));
});
test('three calendar months clamp month ends, including leap years',()=>{
 assert.equal(cutoff(new Date('2026-05-31T12:00:00Z')),'2026-02-28T12:00:00.000Z');assert.equal(cutoff(new Date('2024-05-31T12:00:00Z')),'2024-02-29T12:00:00.000Z');
});
test('local verified write deduplicates; permission failure and divergent file preserved',async()=>{
 const d=local(),s=await snapshot(make());await writeLocal(d,s);await writeLocal(d,s);assert.equal(d.files.size,1);
 d.files.set(s.name,'divergent');await assert.rejects(writeLocal(d,s),/not been overwritten/);assert.equal(d.files.get(s.name),'divergent');
 d.queryPermission=async()=> 'prompt';await assert.rejects(writeLocal(d,s),/Allow laptop/);
});
test('local retention removes only verified old copies of this dataset; keeps newest and unrelated files',async()=>{
 const d=local(),old=await snapshot(make(1,'2026-06-01T00:00:00Z')),latest=await snapshot(make(2)),other=await snapshot({...make(),datasetId:'other'});
 for(const s of [old,latest,other])await writeLocal(d,s);d.files.set('do-not-delete.json','important');
 await pruneLocal(d,old.dataset,latest.sha,new Date('2026-10-12'));assert.equal(d.files.has(old.name),false);assert.equal(d.files.size,3);
});
test('backup capture persists locally without waiting for slow cloud; failed jobs survive reload and retry',async()=>{
 let stored,fail=true;const s=await snapshot(make()),files=[],statuses=[];
 const drive={ensure:async()=>{if(fail)throw new Error('offline');files.push({id:'1',name:s.name,appProperties:{sha:s.sha,date:s.date}});},list:async()=>files,prune:async()=>{}};
 const args={drive,load:async()=>stored,save:async(k,v)=>{stored=structuredClone(v);},onStatus:t=>statuses.push(t)};
 const m=await new BackupManager(args).init(make());await m.capture(make());clearTimeout(m.timer);assert.equal(stored.pending.length,1);await m.run();assert.equal(stored.pending.length,1);assert.match(statuses.at(-1),/offline/);
 fail=false;const recovered=await new BackupManager(args).init(make());await recovered.run();assert.equal(stored.pending.length,0);assert.match(statuses.at(-1),/Drive backup verified/);
 let unblock;drive.ensure=()=>new Promise(r=>unblock=r);const next=make(2);await recovered.capture(next);clearTimeout(recovered.timer);const run=recovered.run();await new Promise(r=>setTimeout(r,0));
 await recovered.capture(make(3));clearTimeout(recovered.timer);assert.equal(stored.pending.length,2);recovered.stop();unblock();await run;
});
test('Drive success plus local failure is reported separately; retry catches up without new billing',async()=>{
 const s=await snapshot(make()),f={name:s.name,appProperties:{sha:s.sha,date:s.date}};let stored,pruned=false;const statuses=[];
 const drive={ensure:async()=>f,list:async()=>[f],read:async()=>s.text,prune:async()=>{pruned=true;}};
 const d=local();d.queryPermission=async()=> 'prompt';const m=await new BackupManager({drive,directory:d,load:async()=>stored,save:async(k,v)=>stored=structuredClone(v),onStatus:t=>statuses.push(t)}).init(make());
 await m.capture(make());clearTimeout(m.timer);await m.run();assert.equal(stored.pending.length,0);assert.equal(pruned,false);assert.match(statuses.at(-1),/Allow laptop/);
 d.queryPermission=async()=> 'granted';await m.run();assert.equal(d.files.size,1);assert.equal(pruned,true);assert.match(statuses.at(-1),/Drive \+ laptop backups verified/);
});
test('Drive pruning uses Trash only for app-owned same-dataset snapshots and excludes keep',async()=>{
 const s=await snapshot(make(1,'2026-06-01T00:00:00Z')),f={id:'old',name:s.name,appProperties:{owner:'trim-billing-backup-v1',dataset:s.dataset,sha:s.sha,date:s.date}};
 assert.equal(owned(f,s.dataset),true);assert.equal(owned(f,'wrong'),false);assert.equal(owned({...f,appProperties:{}},s.dataset),false);
 const d=new DriveBackups({});d.list=async()=>[f];const calls=[];d.request=async(...a)=>calls.push(a);
 await d.prune(s.dataset,s.sha,new Date('2026-10-12'));assert.equal(calls.length,0);await d.prune(s.dataset,'latest',new Date('2026-10-12'));assert.equal(calls[0][1].body,'{"trashed":true}');
});
test('shared backup folder is refused on every retry, never cached as safe',async()=>{
 const d=new DriveBackups({fileId:'synthetic-ledger'});d.listQuery=async()=>[{id:'shared'}];
 d.request=async()=>({permissions:[{role:'owner'},{role:'reader'}]});
 await assert.rejects(d.root(),/privacy needs review/);assert.equal(d.rootId,undefined);
 await assert.rejects(d.root(),/privacy needs review/);
});
