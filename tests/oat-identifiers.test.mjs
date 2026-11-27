import test from 'node:test';import assert from 'node:assert/strict';
import {validateOatRoster} from '../public/oat-roster-repository.mjs';
import {prepareOatImport,setOatAva} from '../oat-import.mjs';
import {panelSource,reconcilePanel} from '../scripts/oat-panel.mjs';
import {oatPatientMatches} from '../public/oat-patient-status.mjs';
const base=()=>({schemaVersion:1,clinic:'oat-fh',patients:[{id:'one',name:'Example, Alex',phn:'0000000001',alternatePhns:[{phn:'0000000002',jurisdiction:'BC'}],nameAliases:['Example, Alex James'],ava:'1234567',dob:'1980-01-01',status:'active'}],clinicDays:[]});
test('confirmed alternate PHN and name match schedules, chart updates, and future complete panels without duplication',()=>{
  const r=base(),input={clinicDate:'2026-11-27',source:{pdfSha256:'a'.repeat(64),emailUrl:'https://outlook.example.test/synthetic'},appointments:[{time:'13:20',phn:'0000000002',name:'Example, Alex James',dob:'1980-01-01'}]};
  const prepared=prepareOatImport(r,input);assert.equal(prepared.added.length,0);assert.equal(prepared.roster.patients.length,1);assert.equal(prepared.roster.clinicDays[0].appointments[0].sourcePhn,'0000000002');assert.equal(prepared.roster.clinicDays[0].appointments[0].patientId,'one');
  assert.equal(setOatAva(prepared.roster,'0000000002','1234567').patients[0].id,'one');
  assert.equal(oatPatientMatches(r.patients[0],'0000-000-002'),true);assert.equal(oatPatientMatches(r.patients[0],'Alex James'),true);
  const source=panelSource(Buffer.from('ID,Name,DOB,Phone\n0000000002,"Example, Alex James",1980-01-01,604-555-0101\n'),'OAT FH_complete.csv','oat-fh');
  const panel=reconcilePanel(prepared.roster,'oat-fh',source,'2026-11-27');assert.equal(panel.patients.length,1);assert.equal(panel.patients[0].id,'one');assert.equal(panel.patients[0].phn,'0000000001');assert.deepEqual(panel.patients[0].nameAliases,['Example, Alex']);assert.deepEqual(panel.clinicDays,prepared.roster.clinicDays);
});
test('unconfirmed conflicting identifiers, duplicate aliases and duplicate rows for one identity are rejected',()=>{
  const r=base();r.patients.push({id:'two',name:'Sample, Robin',phn:'0000000002',ava:null,status:'active'});assert.throws(()=>validateOatRoster(r),/duplicate OAT PHN/);
  const bad=base();bad.patients[0].alternatePhns=[null];assert.throws(()=>validateOatRoster(bad),/Invalid OAT alternate/);
  const wrong=base();wrong.clinicDays=[{date:'2026-11-27',appointments:[{id:'a',patientId:'one',time:'09:00',sourcePhn:'0000000009'}]}];assert.throws(()=>validateOatRoster(wrong),/source PHN conflicts/);
  const source=panelSource(Buffer.from('ID,Name,DOB\n0000000001,"Example, Alex",1980-01-01\n0000000002,"Example, Alex James",1980-01-01\n'),'OAT FH_complete.csv','oat-fh');assert.throws(()=>reconcilePanel(base(),'oat-fh',source,'2026-11-27'),/two identifiers/);
});
