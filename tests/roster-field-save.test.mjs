import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRosterFieldSave} from '../public/roster-field-save.mjs';
const fixture=()=>({patients:[{id:'one',name:'Example, Alex',phn:'0000000001',room:'1'}],otherPatients:[{id:'two',name:'Example, Robin',phn:'0000000002',ava:'1234567'}],removedPatients:[],units:[],billingDates:[],custom:{keep:true}});
const contact={name:'Example, Casey',relationship:'Son',phone:'604-555-0100',extension:'42'};
function args(){const base=fixture();return {base,local:structuredClone(base),remote:structuredClone(base),patientId:'one',field:'familyContacts',expected:[],next:[contact]};}
test('field save preserves pending edits locally and remote changes without persisting pending edits',()=>{
  const a=args();a.local.patients[0].room='2';a.remote.otherPatients[0].room='3';
  const result=prepareRosterFieldSave(a);
  assert.equal(result.saved.patients[0].room,'1');assert.equal(result.pending.patients[0].room,'2');
  assert.equal(result.pending.otherPatients[0].room,'3');assert.deepEqual(result.saved.patients[0].familyContacts,[contact]);
  assert.deepEqual(result.saved.custom,{keep:true});assert.equal(a.remote.patients[0].familyContacts,undefined);
});
test('Other Patients Ava saves share the same adapter and reject duplicate or stale identifiers',()=>{
  const a={...args(),patientId:'two',field:'ava',expected:'1234567',next:'7654321'};
  assert.equal(prepareRosterFieldSave(a).saved.otherPatients[0].ava,'7654321');
  a.remote.patients[0].ava='7654321';assert.throws(()=>prepareRosterFieldSave(a),/already assigned/);
  delete a.remote.patients[0].ava;a.remote.otherPatients[0].ava='3456789';assert.throws(()=>prepareRosterFieldSave(a),/changed elsewhere/);
});
test('field writes refuse moved identities, edited contacts, unsaved same-field work and unrelated merge conflicts',()=>{
  let a=args();a.remote.patients[0].phn='0000000003';assert.throws(()=>prepareRosterFieldSave(a),/identity/);
  a=args();a.remote.patients[0].familyContacts=[contact];assert.throws(()=>prepareRosterFieldSave({...a,next:[{...contact,phone:'604-555-0199'}]}),/changed elsewhere/);
  a=args();a.local.patients[0].familyContacts=[contact];assert.throws(()=>prepareRosterFieldSave({...a,expected:[contact]}),/pending changes/);
  a=args();a.local.patients[0].room='2';a.remote.patients[0].room='3';assert.throws(()=>prepareRosterFieldSave(a),/other pending roster conflicts/);
});
test('lost acknowledgement can be retried idempotently without losing other pending work',()=>{
  const a=args();a.remote.patients[0].familyContacts=[contact];a.local.patients[0].room='2';
  const result=prepareRosterFieldSave(a);assert.equal(result.pending.patients[0].room,'2');assert.deepEqual(result.saved,a.remote);
});
