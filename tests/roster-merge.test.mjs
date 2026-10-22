import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRoster} from '../public/roster-merge.mjs';
const base=()=>({patients:[{id:'one',name:'Synthetic',phn:'0000000001',room:'101',codes:'401'}],otherPatients:[],removedPatients:[],units:[],billingDates:['legacy'],unknown:{keep:true}});
test('roster combines independent fields, retains unknown data and identical edits',()=>{
 const b=base(),l=base(),r=base();l.patients[0].notesDataUploaded=true;r.patients[0].room='102';r.unknown.new='remote';
 const out=mergeRoster(b,l,r);assert.equal(out.conflicts.length,0);assert.equal(out.roster.patients[0].room,'102');assert.equal(out.roster.patients[0].notesDataUploaded,true);assert.deepEqual(out.roster.unknown,{keep:true,new:'remote'});assert.deepEqual(out.roster.billingDates,['legacy']);
 assert.deepEqual(mergeRoster(b,r,r).roster,r);assert.equal(b.patients[0].room,'101');
});
test('roster overlap needs explicit choices tied to exact remote version',()=>{
 const b=base(),l=base(),r=base();l.patients[0].room='local';r.patients[0].room='remote';
 const first=mergeRoster(b,l,r),c=first.conflicts[0],choices={[c.id]:{side:'local',token:c.token}};
 assert.equal(first.conflicts.length,1);assert.equal(mergeRoster(b,l,r,choices).roster.patients[0].room,'local');
 r.patients[0].room='new remote';assert.equal(mergeRoster(b,l,r,choices).conflicts.length,1);
});
test('roster deletion or collection move conflicts with edits; independent additions survive',()=>{
 const b=base(),l=base(),r=base();l.patients=[];r.patients[0].room='changed';assert.equal(mergeRoster(b,l,r).conflicts.length,1);
 l.removedPatients=[{...b.patients[0],removedDate:'2026-10-22'}];assert.equal(mergeRoster(b,l,r).conflicts.length,1);
 const added={id:'two',name:'Second',phn:'0000000002'};r.patients=[...b.patients,added];const out=mergeRoster(b,l,r);assert.equal(out.conflicts.length,0);assert.deepEqual(out.roster.patients,[added]);assert.equal(out.roster.removedPatients.length,1);
});
test('roster duplicate identities and missing baseline cannot be merged silently',()=>{
 const b=base(),l=base(),r=base();l.patients.push({id:'local',name:'Local',phn:'0000000002'});r.patients.push({id:'remote',name:'Remote',phn:'0000000002'});
 assert.throws(()=>mergeRoster(b,l,r),/Duplicate/);assert.throws(()=>mergeRoster(null,l,r),/starting copy/);
});
