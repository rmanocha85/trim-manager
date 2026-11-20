import test from 'node:test';import assert from 'node:assert/strict';
import {blankLedger,upsertEntry,batchEntries,entryIssues,effectiveBillingEntries,assertImmutable,validateLedger} from '../public/core.mjs';
import {freezeExport,completeExport,suggestedDates} from '../public/billing-export.mjs';import {correctionDraft,saveCorrection} from '../public/billing-corrections.mjs';
const p={id:'synthetic',key:'phn:0000000001',name:'SYNTHETIC, Correction',phn:'0000000001',codes:'401',panel:true},roster={patients:[p],units:[]};
test('sent correction is a separate labelled export, retains original and never doubles usage',async()=>{
 let ledger=upsertEntry(blankLedger('synthetic-correction'),p,'2026-09-22',[{code:'14077',units:1,start:'10:00',end:'10:10',reason:'Original',diagnosis:'401'}]);ledger.settings.parallel=false;
 const r=await freezeExport(ledger,roster,ledger.entries,{recipient:'synthetic@example.invalid'});ledger=await completeExport(ledger,r,{basis:'user-confirmed-existing',at:new Date().toISOString()});const original=structuredClone(ledger);
 const draft=correctionDraft(ledger,ledger.entries[0].id);draft.correctionReason='Correct documented duration';draft.items[0].end='10:30';draft.items[0].units=2;ledger=saveCorrection(ledger,draft);
 assert.deepEqual(ledger.entries,original.entries);assertImmutable(original,ledger);assert.equal(batchEntries(ledger,'2026-09-01','2026-11-18').length,1);assert.equal(suggestedDates(ledger,new Date('2026-11-19T20:00Z')).from,'2026-09-22');assert.equal(effectiveBillingEntries(ledger).length,1);assert.equal(effectiveBillingEntries(ledger)[0].items[0].units,2);assert.deepEqual(entryIssues(ledger.corrections[0],ledger,p),[]);
 const correction=await freezeExport(ledger,roster,ledger.corrections,{recipient:'synthetic@example.invalid'});ledger=await completeExport(ledger,correction,{basis:'user-confirmed-existing',at:new Date().toISOString()});validateLedger(ledger);assert.equal(ledger.batches.length,2);assert.equal(ledger.corrections[0].batchId,correction.id);assert.deepEqual(ledger.entries,original.entries);
 const next=correctionDraft(ledger,ledger.entries[0].id);assert.equal(next.correctionOf,ledger.corrections[0].id);assert.throws(()=>saveCorrection(ledger,{...next,correctionReason:''}),/explanation/);
 const altered=structuredClone(ledger);altered.corrections[0].items[0].units=1;assert.throws(()=>assertImmutable(ledger,altered),/Sent corrections/);
});
