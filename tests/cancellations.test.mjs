import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger,upsertInteractiveEntry,cancelBillingCodes,undoBillingCancellation,inheritConferenceDiagnoses,validateLedger,lastBilling} from '../public/core.mjs';
const patient={key:'synthetic',name:'SYNTHETIC',panel:true,codes:'401'};
function fixture(){return upsertInteractiveEntry(blankLedger('synthetic-cancel'),patient,'2026-09-22',[{code:'00114',units:1,diagnosis:'038.9'},{code:'13121',units:1,start:'18:30',end:'18:40'}]);}
test('individual cancellation keeps other codes, snapshot, and original untouched',()=>{
 const initial=fixture(),before=structuredClone(initial),id=initial.entries[0].id;
 const next=cancelBillingCodes(initial,id,'13121');validateLedger(next);
 assert.deepEqual(next.entries[0].items.map(i=>i.code),['00114','13334']);assert.deepEqual(initial,before);
 assert.deepEqual(next.cancellations[0].before,initial.entries[0]);
 const restored=undoBillingCancellation(next,next.cancellations[0].id);assert.deepEqual(restored.entries,initial.entries);assert.ok(restored.cancellations[0].undoneAt);
});
test('qualifying-code cancellation removes orphan bonus, last billing recalculates',()=>{
 const initial=fixture(),next=cancelBillingCodes(initial,initial.entries[0].id,'00114');
 assert.deepEqual(next.entries[0].items.map(i=>i.code),['13121']);assert.equal(lastBilling(next,patient.key,'9999-12-31',true),null);
 const removed=cancelBillingCodes(next,next.entries[0].id,'13121');assert.equal(removed.entries.length,0);validateLedger(removed);
 const restored=undoBillingCancellation(removed,removed.cancellations.at(-1).id);assert.deepEqual(restored.entries,next.entries);
});
test('bonus can be independently removed and undo cannot overwrite later edits',()=>{
 const initial=fixture(),next=cancelBillingCodes(initial,initial.entries[0].id,'13334');assert.equal(next.entries[0].items.length,2);
 next.entries[0].items[0].reason='later edit';assert.throws(()=>undoBillingCancellation(next,next.cancellations[0].id),/changed after/);
 initial.entries[0].batchId='handed-over';assert.throws(()=>cancelBillingCodes(initial,initial.entries[0].id,'00114'),/read-only/);
});
test('remove-all is recoverable; recreated patient/date is not overwritten',()=>{
 const initial=fixture(),next=cancelBillingCodes(initial,initial.entries[0].id);assert.equal(next.entries.length,0);
 assert.deepEqual(undoBillingCancellation(next,next.cancellations[0].id).entries,initial.entries);
 const recreated=upsertInteractiveEntry(next,patient,'2026-09-22',[{code:'00114',units:1}]);assert.throws(()=>undoBillingCancellation(recreated,next.cancellations[0].id),/Another entry/);
});
test('both conference codes inherit primary 114 and retain manual/legacy diagnoses',()=>{
 const items=[{code:'00114',diagnosis:'038.9'},{code:'13121',diagnosisSource:'primary114'},{code:'14077',diagnosisSource:'primary114'}];
 let next=inheritConferenceDiagnoses(items,'401');assert.equal(next[1].diagnosis,'038.9');assert.equal(next[2].diagnosis,'038.9');assert.equal(items[1].diagnosis,undefined);
 next[1].diagnosis='485';next[1].diagnosisSource='manual';next[0].diagnosis='786.2';next=inheritConferenceDiagnoses(next,'401');assert.equal(next[1].diagnosis,'485');assert.equal(next[2].diagnosis,'786.2');
 assert.equal(inheritConferenceDiagnoses([{code:'14077',diagnosis:'250'}],'401')[0].diagnosis,'250');
 assert.equal(inheritConferenceDiagnoses([{code:'14077',diagnosisSource:'primary114'}],'401')[0].diagnosis,'401');
 assert.equal(inheritConferenceDiagnoses([{code:'14077',diagnosisSource:'primary114'}],'401, 250')[0].diagnosis,'401');
 assert.equal(inheritConferenceDiagnoses([{code:'14077',diagnosis:'786.2',diagnosisSource:'primary114'}],'401')[0].diagnosis,'786.2');
});
