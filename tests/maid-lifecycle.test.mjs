import test from 'node:test';import assert from 'node:assert/strict';
import {applyMaidAction,validateClinicRoster} from '../public/clinic-roster-repository.mjs';
import {closeoutSteps,isProvisionClosed,isProvisionPending,maidAppPatients,patientLocation} from '../public/maid-lifecycle.mjs';
const sample=()=>({schemaVersion:1,patients:[{id:'one',name:'Synthetic',status:'history',provisionDate:'2026-11-08',provisionSource:'Physician confirmed',contacts:[{role:'Patient',phone:'604-555-0101'}],forms:{'1634':{signedDate:'2026-10-01',finalSignedDate:'2026-11-08'}}},{id:'two',name:'Other synthetic',status:'active'}]});
const checkpoints=()=>Object.fromEntries(closeoutSteps.map(key=>[key,{status:'verified',verifiedAt:'2026-11-08T19:00:00Z',source:'Synthetic verified evidence'}]));
test('procedure facts remain visible until all closeout components verified, without erasing history',()=>{
 const initial=sample(),steps=checkpoints();delete steps.pharmacyDraft;
 assert.equal(isProvisionPending(initial.patients[0]),true);
 const pending=applyMaidAction(initial,{type:'closeout',patientId:'one',checkpoints:steps});
 assert.equal(maidAppPatients(pending.patients).length,2);
 assert.throws(()=>applyMaidAction(pending,{type:'closeout',patientId:'one',complete:true}),/incomplete/);
 const closed=applyMaidAction(pending,{type:'closeout',patientId:'one',checkpoints:{pharmacyDraft:checkpoints().pharmacyDraft},complete:true});
 assert.equal(isProvisionClosed(closed.patients[0]),true);assert.deepEqual(maidAppPatients(closed.patients),[initial.patients[1]]);
 assert.deepEqual(closed.patients[0].forms,initial.patients[0].forms);assert.deepEqual(closed.patients[0].contacts,initial.patients[0].contacts);assert.deepEqual(closed.patients[1],initial.patients[1]);
 assert.equal(applyMaidAction(closed,{type:'closeout',patientId:'one',complete:true}),closed);
 assert.throws(()=>applyMaidAction(closed,{type:'status',patientId:'one',status:'active'}),/no longer/);
});
test('planned dates, forged completion and undocumented exclusions cannot hide a case',()=>{
 const initial=sample();delete initial.patients[0].provisionDate;initial.patients[0].plannedProvision={date:'2026-11-08'};
 assert.throws(()=>applyMaidAction(initial,{type:'closeout',patientId:'one',checkpoints:checkpoints(),complete:true}),/incomplete/);
 assert.throws(()=>applyMaidAction(initial,{type:'update',patientId:'one',changes:{postProvision:{status:'complete'}}}),/cannot be overwritten/);
 const invalid=sample();invalid.patients[0].postProvision={status:'complete'};assert.throws(()=>validateClinicRoster(invalid),/Invalid provision/);
 assert.equal(maidAppPatients(invalid.patients).length,2);
 assert.throws(()=>applyMaidAction(sample(),{type:'closeout',patientId:'one',checkpoints:{pharmacyDraft:{status:'excluded',verifiedAt:'today',source:'Unavailable'}}}),/require verified/);
 const steps=checkpoints();steps.pharmacyDraft={status:'excluded',verifiedAt:'2026-11-08T19:00:00Z',source:'Explicit physician direction',reason:'Physician already handled pharmacy'};
 assert.equal(isProvisionClosed(applyMaidAction(sample(),{type:'closeout',patientId:'one',checkpoints:steps,complete:true}).patients[0]),true);
});
test('current location stays consistent across workflow writes and app display',()=>{
 const data=applyMaidAction(sample(),{type:'update',patientId:'one',changes:{currentLocation:{display_name:'Synthetic hospice',source:'Referral',verified_date:'2026-11-08'}}});
 assert.equal(data.patients[0].location,'Synthetic hospice');assert.equal(patientLocation(data.patients[0]),'Synthetic hospice');
 assert.equal(patientLocation({location:'Last recorded: Synthetic hospital'}),'Last recorded: Synthetic hospital');
});
