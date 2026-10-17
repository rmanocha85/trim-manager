import test from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger,upsertEntry,finalizeBatch,clone} from '../public/core.mjs';
import {mergeSession} from '../public/merge.mjs';
const p=n=>({key:`phn:${n}`,name:`Synthetic ${n}`,panel:true});
const add=(l,n,reason='test')=>upsertEntry(l,p(n),'2026-09-22',[{code:'00114',units:1,reason}]);
const resolve=(b,l,r,side)=>{const first=mergeSession(b,l,r);return mergeSession(b,l,r,Object.fromEntries(first.conflicts.map(c=>[c.id,{token:c.token,side}])));};
test('independent additions preserve both computers and input objects',()=>{
 const b=blankLedger('test'),l=add(b,1),r=add(b,2),before=JSON.stringify([b,l,r]);
 const m=mergeSession(b,l,r);assert.equal(m.conflicts.length,0);assert.equal(m.ledger.entries.length,2);assert.equal(JSON.stringify([b,l,r]),before);
});
test('identical same-patient/date additions deduplicate despite different IDs and timestamps',()=>{
 const b=blankLedger('test'),l=add(b,1),r=add(b,1);const m=mergeSession(b,l,r);assert.equal(m.conflicts.length,0);assert.equal(m.ledger.entries.length,1);assert.equal(m.ledger.entries[0].id,r.entries[0].id);
});
test('same-patient edits require one explicit choice and retain unrelated remote work',()=>{
 const b=add(blankLedger('test'),1),l=add(b,1,'local'),r=add(add(b,1,'remote'),2);
 assert.equal(mergeSession(b,l,r).conflicts.length,1);
 const m=resolve(b,l,r,'local');assert.equal(m.conflicts.length,0);assert.equal(m.ledger.entries.length,2);assert.equal(m.ledger.entries.find(e=>e.patientKey==='phn:1').items[0].reason,'local');
 assert.equal(resolve(b,l,r,'drive').ledger.entries.find(e=>e.patientKey==='phn:1').items[0].reason,'remote');
});
test('removed entries stay removed and delete/edit conflicts are explicit',()=>{
 const b=add(blankLedger('test'),1),l=clone(b);l.entries=[];
 assert.equal(mergeSession(b,l,add(b,2)).ledger.entries.length,1);
 const r=add(b,1,'remote');assert.equal(mergeSession(b,l,r).conflicts.length,1);assert.equal(resolve(b,l,r,'local').ledger.entries.length,0);
 const remoteDeleted=clone(b);remoteDeleted.entries=[];
 assert.equal(mergeSession(b,b,remoteDeleted).ledger.entries.length,0);
});
test('choice expires when Drive changes again',()=>{
 const b=add(blankLedger('test'),1),l=add(b,1,'local'),r=add(b,1,'remote');const c=mergeSession(b,l,r).conflicts[0];
 assert.equal(mergeSession(b,l,add(r,1,'newer'),{[c.id]:{token:c.token,side:'local'}}).conflicts.length,1);
});
test('handed-over remote billing cannot be replaced by a local choice',()=>{
 const b=add(blankLedger('test'),1),l=add(b,1,'local'),r=clone(b);r.entries[0].batchId='batch';r.batches=[{id:'batch',entryIds:[r.entries[0].id]}];
 const m=mergeSession(b,l,r);assert.equal(m.conflicts[0].locked,true);assert.equal(resolve(b,l,r,'local').conflicts.length,1);assert.equal(resolve(b,l,r,'drive').ledger.entries[0].batchId,'batch');
});
test('same-day automatic bonuses do not duplicate',()=>{
 const b=blankLedger('test'),l=add(b,1),r=add(b,2);for(const x of [l,r])x.entries[0].items.push({code:'13334',units:1,autoAdded:true});
 const m=mergeSession(b,l,r);assert.equal(m.conflicts.length,0);assert.equal(m.ledger.entries.flatMap(e=>e.items).filter(i=>i.code==='13334').length,1);assert.equal(m.ledger.entries.find(e=>e.patientKey==='phn:2').items.length,2);
});
test('independent settings and baseline changes merge',()=>{
 const b=blankLedger('test'),l=clone(b),r=clone(b);l.settings.parallel=false;r.settings.portalYears=['2026'];l.baselines['phn:1']={date:'2026-09-01'};r.baselines['phn:2']={date:'2026-09-02'};
 const m=mergeSession(b,l,r);assert.equal(m.conflicts.length,0);assert.equal(Object.keys(m.ledger.baselines).length,2);assert.deepEqual(m.ledger.settings,{parallel:false,portalYears:['2026']});
});
test('missing baseline and wrong dataset never blindly overwrite Drive',()=>{
 const b=blankLedger('test');assert.throws(()=>mergeSession(null,b,b),/starting copy/);assert.throws(()=>mergeSession(b,b,blankLedger('other')),/different billing/);
});
