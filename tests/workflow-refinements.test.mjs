import test from 'node:test';
import assert from 'node:assert/strict';
import {setMedReconciliation} from '../public/patients-core.mjs';
import {newPatient} from '../public/patient-identity.mjs';
import {inheritConferenceDiagnoses} from '../public/core.mjs';
import {mergeRoster} from '../public/roster-merge.mjs';
import {saveIndicator} from '../public/session.mjs';
const fixture=()=>({patients:[{id:'new',name:'Example, Alex',panelAddedDate:'2026-11-01',newPanelPatient:true,unit:'cedar',room:'1',extra:'keep'}],otherPatients:[{id:'other',name:'Coverage, Casey',panelAddedDate:'2026-11-01',newPanelPatient:true,doctor:'Example doctor'}],units:[],billingDates:[]});
test('med reconciliation shares the 14-day window; completion remains in the record after expiry',()=>{
 const original=fixture();for(const id of ['new','other']){
 const next=setMedReconciliation(original,id,true,'2026-11-14'),p=[...next.patients,...next.otherPatients].find(p=>p.id===id);
 assert.equal(p.medReconciliationDate,'2026-11-14');assert.equal(newPatient(p,'2026-11-14'),true);assert.equal(newPatient(p,'2026-11-15'),false);assert.equal(p.medReconciliationDate,'2026-11-14');
 assert.throws(()=>setMedReconciliation(next,id,false,'2026-11-15'),/14 days/);
 const undone=setMedReconciliation(next,id,false,'2026-11-14');assert.equal([...undone.patients,...undone.otherPatients].find(p=>p.id===id).medReconciliationDate,'');
 }assert.equal(original.patients[0].medReconciliationDate,undefined);
 assert.throws(()=>setMedReconciliation(original,'new',true,'2026-10-31'),/14 days/);
});
test('reconciliation merges independent room edits without losing clinician or patient details',()=>{
 const base=fixture(),local=setMedReconciliation(base,'other',true,'2026-11-02'),remote=structuredClone(base);remote.otherPatients[0].room='205';
 const result=mergeRoster(base,local,remote);assert.equal(result.conflicts.length,0);assert.equal(result.roster.otherPatients[0].medReconciliationDate,'2026-11-02');assert.equal(result.roster.otherPatients[0].room,'205');assert.equal(result.roster.otherPatients[0].doctor,'Example doctor');
});
test('both conference codes copy all 114 diagnoses including usual-code fallback and preserve manual overrides',()=>{
 for(const code of ['13121','14077']){
 const source={code:'00114',diagnosis:'250 311 V66.7'},conference={code,diagnosisSource:'primary114'};
 assert.equal(inheritConferenceDiagnoses([source,conference],'401')[1].diagnosis,source.diagnosis);
 assert.equal(inheritConferenceDiagnoses([{code:'00114'},conference],'250 311')[1].diagnosis,'250 311');
 assert.equal(inheritConferenceDiagnoses([source,{...conference,diagnosis:'401',diagnosisSource:'manual'}])[1].diagnosis,'401');
 }
});
test('save feedback never claims cloud verification for local, failed, partial or disconnected saves',()=>{
 const input={states:[{name:'Roster',ready:true}],session:{},connection:{mode:'cloud',ready:true,connected:true}};
 assert.equal(saveIndicator(input).label,'✓ Saved to Drive');
 assert.equal(saveIndicator({...input,connection:{...input.connection,mode:'local'}}).label,'✓ Saved to folder');
 assert.equal(saveIndicator({...input,states:[{name:'Roster',dirty:true}]}).label,'● Changes pending');
 assert.equal(saveIndicator({...input,session:{saving:true}}).label,'◌ Saving…');
 assert.equal(saveIndicator({...input,session:{lastError:'Unavailable',message:'Roster saved. Billing failed.'}}).detail,'Roster saved. Billing failed.');
 assert.equal(saveIndicator({...input,session:{lastError:'Unavailable'}}).state,'error');
 assert.equal(saveIndicator({...input,connection:{...input.connection,connected:false}}).label,'⚠ Connection lost');
});
