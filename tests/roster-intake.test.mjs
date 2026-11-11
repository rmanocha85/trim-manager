import test from 'node:test';import assert from 'node:assert/strict';
import {setPmhxUploaded,setMedReconciliation,addOther} from '../public/patients-core.mjs';
import {blankLedger,planNewPatients,normalizeRoster} from '../public/core.mjs';
import {mergeRoster} from '../public/roster-merge.mjs';
import {typedHistorySource,clipboardImages} from '../public/intake-sources.mjs';
import {signatureMatches,checkManifest} from '../public/intake-core.mjs';
test('new Other Patients receive completion controls without creating routine billing plans',()=>{
 const roster=addOther({patients:[],otherPatients:[],units:[{id:'test',name:'Test'}]},{name:'Example, Other',phn:'0000000001',unit:'test',room:'1',codes:'401',ava:'123456'},'2026-11-11',()=> 'new');
 assert.equal(roster.otherPatients[0].newPanelPatient,true);assert.equal(setPmhxUploaded(roster,'new',true,'2026-11-11').otherPatients[0].pmhxUploadedDate,'2026-11-11');
 const ledger=blankLedger('synthetic');assert.deepEqual(planNewPatients(ledger,normalizeRoster(roster),'2026-11-11').entries,[]);assert.equal(planNewPatients(ledger,normalizeRoster(roster),'2026-11-11').newPatientStarts,undefined);
});
test('PMHx completion saves independently on both rosters, merges, and expires without erasing dates',()=>{
 const p={id:'one',name:'Example, Alex',phn:'0000000001',panelAddedDate:'2026-11-01',newPanelPatient:true,room:'1'};
 for(const collection of ['patients','otherPatients']){
  const base={patients:[],otherPatients:[],units:[],[collection]:[p]};
  const local=setPmhxUploaded(base,p.id,true,'2026-11-02'),remote=setMedReconciliation(base,p.id,true,'2026-11-03');remote[collection][0].room='2';
  const merged=mergeRoster(base,local,remote);assert.equal(merged.conflicts.length,0);assert.equal(merged.roster[collection][0].pmhxUploadedDate,'2026-11-02');assert.equal(merged.roster[collection][0].medReconciliationDate,'2026-11-03');assert.equal(merged.roster[collection][0].room,'2');
  assert.equal(setPmhxUploaded(local,p.id,true,'2026-11-04')[collection][0].pmhxUploadedDate,'2026-11-02');
  assert.equal(setPmhxUploaded(local,p.id,false,'2026-11-04')[collection][0].pmhxUploadedDate,'');
  assert.throws(()=>setPmhxUploaded(local,p.id,false,'2026-11-15'),/14 days/);assert.equal(local[collection][0].pmhxUploadedDate,'2026-11-02');
 }
});
test('typed sources preserve Unicode and selected identity and reject invalid or oversize inputs',()=>{
 const text=typedHistorySource({name:'Example, Alex',phn:'0000000001'},'History: café — prior surgery\nUncertain date.');
 assert.match(text,/PHN: 0000000001/);assert.match(text,/café — prior surgery\nUncertain date/);assert.match(text,/not the date of the clinical events/);
 assert.equal(signatureMatches(new TextEncoder().encode(text),'text/plain'),true);
 assert.equal(signatureMatches(Uint8Array.of(0,1,2),'text/plain'),false);assert.equal(signatureMatches(Uint8Array.of(255),'text/plain'),false);
 assert.equal(typedHistorySource({},'  '),null);assert.throws(()=>typedHistorySource({},'history'),/saved patient/);assert.throws(()=>typedHistorySource({name:'Example',phn:'0000000001'},'x'.repeat(80001)),/80,000/);
});
test('clipboard images accept file and item formats without duplicating a pasted image',()=>{
 const f={type:'image/png'},item={kind:'file',type:'image/png',getAsFile:()=>f};assert.deepEqual(clipboardImages({files:[f],items:[item]}),[f]);assert.deepEqual(clipboardImages({files:[],items:[item]}),[f]);assert.deepEqual(clipboardImages({files:[],items:[{kind:'string',type:'text/plain'}]}),[]);
});
