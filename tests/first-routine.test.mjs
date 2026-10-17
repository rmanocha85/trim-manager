import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger,setFirstRoutineReview,dueState,upsertEntry,entryIssues,lastBilling,removeEntry,validateLedger} from '../public/core.mjs';
import {routineCandidates} from '../public/workspace.mjs';
import {mergeSession} from '../public/merge.mjs';
const p={id:'new',key:'phn:0000000001',name:'EXAMPLE, New',phn:'0000000001',panel:true,codes:'401'};
const setup=()=>setFirstRoutineReview(blankLedger(),p,'2026-09-01','2026-09-03');
test('external admission creates planning metadata, never charges or a fictitious last billing',()=>{
 const l=setup();assert.equal(l.entries.length,0);assert.deepEqual(l.baselines,{});
 assert.equal(lastBilling(l,p.key),null);assert.equal(dueState(l,p,'2026-08-31').kind,'unknown');
 assert.equal(dueState(l,p,'2026-09-01').kind,'due');assert.equal(dueState(l,p,'2026-09-03').kind,'due');
 assert.equal(dueState(l,p,'2026-09-03').firstRoutine,true);
 assert.equal(routineCandidates(l,[p],'2026-09-03')[0].status,'due');
 assert.equal(dueState(l,{...p,panel:false},'2026-09-03').kind,'adhoc');
});
test('first 114 starts the interval; cancellation restores first-review planning',()=>{
 let l=upsertEntry(setup(),p,'2026-09-03',[{code:'00114',units:1}]);
 assert.deepEqual(entryIssues(l.entries[0],l,p),[]);
 assert.equal(dueState(l,p,'2026-09-04').due,'2026-09-17');
 l=removeEntry(l,l.entries[0].id);assert.equal(dueState(l,p,'2026-09-04').kind,'due');
});
test('admission charge does not reset interval or create an early-114 warning',()=>{
 let l=upsertEntry(setup(),p,'2026-09-01',[{code:'13115',units:1,attested:true,reason:'Synthetic'}]);
 assert.equal(dueState(l,p,'2026-09-03').kind,'due');
 l=upsertEntry(l,p,'2026-09-03',[{code:'00114',units:1}]);
 assert.ok(!entryIssues(l.entries[1],l,p).some(s=>s.includes('14 days')));
 assert.equal(lastBilling(l,p.key,'2026-09-01',true),null);
 assert.equal(lastBilling(l,p.key,'2026-09-01'), '2026-09-01');
});
test('older 114 still controls timing; imported admission alone does not',()=>{
 const l=upsertEntry(setup(),p,'2026-08-30',[{code:'00114',units:1}]);
 assert.equal(dueState(l,p,'2026-09-03').due,'2026-09-13');
 const imported=setup();imported.historicalBillings=[{id:'imported',patientKey:p.key,date:'2026-09-01',codes:['13115'],status:'already_billed'}];
 validateLedger(imported);assert.equal(dueState(imported,p,'2026-09-03').kind,'due');
 assert.equal(dueState(blankLedger(),p,'2026-09-03').kind,'unknown');
});
test('validate dates, identity, eligibility, and conflicting setup',()=>{
 assert.throws(()=>setFirstRoutineReview(blankLedger(),{...p,panel:false},'2026-09-01','2026-09-03'),/panel/);
 assert.throws(()=>setFirstRoutineReview(blankLedger(),p,'2026-09-01','2026-09-01'),/Invalid/);
 assert.throws(()=>setFirstRoutineReview(blankLedger(),p,'2099-09-01','2099-09-03'),/Invalid/);
 assert.throws(()=>setFirstRoutineReview(setup(),p,'2026-09-01','2026-09-04'),/already/);
 assert.deepEqual(setFirstRoutineReview(setup(),p,'2026-09-01','2026-09-03').routineStarts,setup().routineStarts);
});
test('a stale billing session preserves external first-review setup on merge',()=>{
 const base=blankLedger(),local=upsertEntry(base,p,'2026-09-01',[{code:'14077',units:1}]);
 const remote=setFirstRoutineReview(base,p,'2026-09-01','2026-09-03');
 const result=mergeSession(base,local,remote);
 assert.equal(result.conflicts.length,0);assert.deepEqual(result.ledger.routineStarts,remote.routineStarts);assert.equal(result.ledger.entries.length,1);
});
