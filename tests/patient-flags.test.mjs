import test from 'node:test';
import assert from 'node:assert/strict';
import {setPatientFlag} from '../public/patients-core.mjs';
import {normalizeRoster} from '../public/core.mjs';
import {mergeRoster} from '../public/roster-merge.mjs';
const person=(id)=>({id,name:'Example, '+id,phn:id.padStart(10,'0'),ava:'12345'+id,unit:'cedar',room:id,pFlag:true,extra:{keep:true}});
const roster=()=>({patients:[person('1')],otherPatients:[{...person('2'),doctor:'Example doctor'}],removedPatients:[{...person('3'),removedDate:'2026-11-01'}],units:[{id:'cedar',name:'CEDAR'}],billingDates:[]});
test('flags are independent, preserve existing identities and coverage ownership, and normalize for all workspaces',()=>{
 const raw=roster();let changed=setPatientFlag(raw,'2','palliativeFlag',true);
 assert.equal(raw.otherPatients[0].palliativeFlag,undefined);
 assert.deepEqual(changed.otherPatients[0],{...raw.otherPatients[0],palliativeFlag:true});
 assert.deepEqual(changed.patients,raw.patients);assert.deepEqual(changed.removedPatients,raw.removedPatients);
 changed=setPatientFlag(changed,'2','pFlag',false);
 assert.equal(changed.otherPatients[0].palliativeFlag,true);
 const normalized=normalizeRoster(changed);assert.equal(normalized.otherPatients[0].palliativeFlag,true);assert.equal(normalized.otherPatients[0].pFlag,false);
 assert.throws(()=>setPatientFlag(raw,'3','palliativeFlag',true),/active/);
 assert.throws(()=>setPatientFlag(raw,'1','name',true),/Invalid/);
 assert.throws(()=>setPatientFlag(raw,'1','palliativeFlag','true'),/Invalid/);
});
test('independent remote changes merge while removal versus a flag requires review',()=>{
 const base=roster(),local=setPatientFlag(base,'1','palliativeFlag',true),remote=structuredClone(base);
 remote.patients[0].room='1509';
 const merged=mergeRoster(base,local,remote);assert.equal(merged.conflicts.length,0);assert.equal(merged.roster.patients[0].room,'1509');assert.equal(merged.roster.patients[0].palliativeFlag,true);
 remote.removedPatients.push({...remote.patients.pop(),removedDate:'2026-11-05'});
 assert.equal(mergeRoster(base,local,remote).conflicts.length,1);
});
