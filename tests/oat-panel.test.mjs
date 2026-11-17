import assert from 'node:assert/strict';
import test from 'node:test';
import {panelSource,reconcilePanel} from '../scripts/oat-panel.mjs';
const clinic='oat-fh',filename='OAT FH_complete.csv',source=s=>panelSource(Buffer.from(s),filename,clinic);
const header='ID,Name,DOB,Phone\n';
const csv=header+'0000000002,"Example, B",1980-01-01,\n0000000003,"Example, C",1981-01-01,604-555-0134\n';
const original={schemaVersion:1,clinic,patients:[{id:'one',name:'Example, A',phn:'0000000001',ava:'1111111',dob:'1980-01-01',status:'active'},{id:'two',name:'Example, B',phn:'0000000002',ava:'2222222',dob:'1980-01-01',phone:'604-555-0112',status:'history'}],clinicDays:[{date:'2026-11-12',appointments:[{id:'old',time:'09:00',patientId:'one',finished:true}]}]};
test('complete panel preserves charts, appointments and known phones, reactivates returning patients and archives absent patients',()=>{
  const next=reconcilePanel(original,clinic,source(csv),'2026-11-17');
  assert.deepEqual(next.patients.map(p=>[p.name,p.status]),[['Example, B','active'],['Example, C','active'],['Example, A','history']]);
  assert.equal(next.patients[0].id,'two');assert.equal(next.patients[0].phone,'604-555-0112');assert.equal(next.patients[1].ava,null);assert.deepEqual(next.clinicDays,original.clinicDays);assert.equal(next.patients[2].id,'one');
  assert.deepEqual(reconcilePanel(next,clinic,source(csv),'2026-11-17'),next);assert.throws(()=>reconcilePanel(next,clinic,source(csv),'2026-11-08'),/older/);
});
test('wrong clinic, truncated, empty and duplicate exports or conflicting identities cannot change membership',()=>{
  assert.throws(()=>panelSource(Buffer.from(csv),'OAT Purple_list.csv',clinic),/clinic/);
  for(const text of [header,header+'0000000002,"x',csv+csv.split('\n')[1]])assert.throws(()=>source(text));
  assert.throws(()=>reconcilePanel(original,clinic,source(csv.replace('1980-01-01','1979-01-01')),'2026-11-17'),/conflicting/);
  assert.equal(original.patients[0].status,'active');
});
