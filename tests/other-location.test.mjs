import test from 'node:test';
import assert from 'node:assert/strict';
import {editOtherLocation} from '../public/patients-core.mjs';
import {mergeRoster} from '../public/roster-merge.mjs';
const person={id:'coverage',name:'Example, Casey',phn:'0000000001',ava:'123456',unit:'',room:'',doctor:'Example doctor',pFlag:true,palliativeFlag:true,extra:{keep:true}};
const roster=()=>({patients:[],otherPatients:[structuredClone(person)],removedPatients:[],units:[{id:'cedar',name:'CEDAR'}],billingDates:[]});
test('Other Patients location edits preserve ownership, flags, identity and unrelated fields; blank location is supported',()=>{
 const before=roster(),after=editOtherLocation(before,'coverage',{unit:'cedar',room:' 1506A '});
 assert.deepEqual(after.otherPatients[0],{...person,unit:'cedar',room:'1506A'});assert.deepEqual(before,roster());
 assert.deepEqual(editOtherLocation(after,'coverage',{unit:'',room:''}),before);
 assert.throws(()=>editOtherLocation(before,'coverage',{unit:'invented',room:'1'}),/Choose a unit/);
 assert.throws(()=>editOtherLocation(before,'missing',{unit:'cedar',room:'1'}),/one Other/);
 const legacy=roster();legacy.otherPatients[0].unit='old unknown value';
 assert.equal(editOtherLocation(legacy,'coverage',{unit:'old unknown value',room:'2'}).otherPatients[0].unit,'old unknown value');
});
test('different location edits require reconciliation while independent doctor edits merge',()=>{
 const base=roster(),local=editOtherLocation(base,'coverage',{unit:'cedar',room:'1506'}),remote=editOtherLocation(base,'coverage',{unit:'',room:'1507'});
 assert.equal(mergeRoster(base,local,remote).conflicts.length,1);
 const doctor=roster();doctor.otherPatients[0].doctor='Another doctor';const merged=mergeRoster(base,local,doctor);
 assert.equal(merged.conflicts.length,0);assert.equal(merged.roster.otherPatients[0].doctor,'Another doctor');assert.equal(merged.roster.otherPatients[0].room,'1506');
});
