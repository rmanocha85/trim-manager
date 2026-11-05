import test from 'node:test';
import assert from 'node:assert/strict';
import {returnFromHospitalToday,undoHospitalReturn,canUndoHospitalReturn} from '../public/hospital.mjs';
import {today} from '../public/patients-core.mjs';
const key='phn:0000000001',date='2026-11-05';
const fixture=()=>({patients:[{id:'example',phn:'0000000001',name:'Synthetic',room:'1',hospitalStays:[{id:'previous',admittedDate:'2026-09-01',returnedDate:'2026-09-02'},{id:'current',admittedDate:'2026-10-19',returnedDate:null,updatedAt:'original',custom:{keep:true}}]}],otherPatients:[],units:[],billingDates:[],extra:{keep:true}});
test('quick return uses the Pacific calendar and exact undo preserves history and unrelated edits',()=>{
 assert.equal(today(new Date('2026-11-06T07:30:00Z')),date);
 const raw=fixture(),before=structuredClone(raw),{roster,undo}=returnFromHospitalToday(raw,key,date);
 assert.deepEqual(raw,before);assert.equal(roster.patients[0].hospitalStays[1].returnedDate,date);
 assert.throws(()=>returnFromHospitalToday(roster,key,date),/no longer/);
 assert.deepEqual(undoHospitalReturn(roster,undo),raw);
 roster.patients[0].room='2';roster.extra.new='preserved';
 const restored=undoHospitalReturn(roster,undo);assert.equal(restored.patients[0].room,'2');assert.equal(restored.extra.new,'preserved');assert.deepEqual(restored.patients[0].hospitalStays,raw.patients[0].hospitalStays);
});
test('coverage roster returns work and stale, removed or ambiguous identities cannot be undone',()=>{
 const raw=fixture();raw.otherPatients=raw.patients;raw.patients=[];
 const {roster,undo}=returnFromHospitalToday(raw,key,date);assert.equal(roster.otherPatients[0].hospitalStays[1].returnedDate,date);assert.deepEqual(undoHospitalReturn(roster,undo),raw);
 roster.otherPatients[0].hospitalStays[1].returnedDate='2026-11-04';assert.equal(canUndoHospitalReturn(roster,undo),false);assert.throws(()=>undoHospitalReturn(roster,undo),/changed/);
 assert.throws(()=>returnFromHospitalToday({...raw,patients:raw.otherPatients},key,date),/verified/);
 assert.throws(()=>returnFromHospitalToday({...raw,otherPatients:[],removedPatients:raw.otherPatients},key,date),/verified/);
});
