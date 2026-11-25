import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingRosterChanges} from '../public/patients-core.mjs';
const roster=()=>({patients:[{id:'one',name:'Example, Alex',unit:'cedar',room:'101',activeIssue:{status:'active',description:'Cough',history:[],updatedAt:'old'}}],otherPatients:[],removedPatients:[],units:[{id:'cedar',name:'CEDAR',floor:1},{id:'fern',name:'FERN',floor:2}],billingDates:[]});
test('pending roster review lists changed values, resolving unit names and retaining issue wording',()=>{
 const before=roster(),after=structuredClone(before);after.patients[0].room='102';after.patients[0].unit='fern';after.patients[0].activeIssue.description='<b>Review swelling</b>';
 const changes=pendingRosterChanges(before,after);assert.equal(changes.length,1);assert.equal(changes[0].name,'Example, Alex');
 assert.deepEqual(changes[0].fields.find(f=>f.label==='Unit'),{label:'Unit',before:'CEDAR',after:'FERN'});
 assert.deepEqual(changes[0].fields.find(f=>f.label==='Active issue'),{label:'Active issue',before:'Active — Cough',after:'Active — <b>Review swelling</b>'});
 assert.equal(before.patients[0].room,'101');
});
test('roster review includes additions, moves to removed patients and permanent removal',()=>{
 const before=roster(),after=structuredClone(before);after.removedPatients.push({...after.patients.pop(),removedDate:'2026-11-25'});after.otherPatients.push({id:'two',name:'Example, Morgan'});
 const changes=pendingRosterChanges(before,after);assert.equal(changes[0].kind,'Patient moved');assert.deepEqual(changes[0].fields[0],{label:'Roster',before:'My Patients',after:'Removed patients'});assert.equal(changes[1].kind,'Patient added');
 assert.equal(pendingRosterChanges(after,{...after,removedPatients:[]})[0].kind,'Patient removed');
});
test('roster review includes flags, hospital dates, family contacts, units and settings',()=>{
 const before=roster(),after=structuredClone(before);Object.assign(after.patients[0],{palliativeFlag:true,hospitalStays:[{id:'stay',admittedDate:'2026-11-20',returnedDate:'2026-11-25'}],familyContacts:[{name:'Example, Jamie',phone:'555-0100'}]});after.units[0].floor=3;after.billingDates=['2026-11-25'];
 const changes=pendingRosterChanges(before,after);assert.equal(changes.length,3);assert.equal(changes[1].kind,'Unit updated');assert.equal(changes[2].kind,'Settings updated');assert.match(changes[0].fields.find(f=>f.label==='Hospital dates').after,/Admitted: 2026-11-20\nReturned: 2026-11-25/);assert.equal(changes[0].fields.find(f=>f.label==='Palliative protocol').after,'Yes');
});
test('review has no changes after save or undo, ignores ordering of object keys and revision timestamps',()=>{
 const before=roster(),after=structuredClone(before);after.updatedAt='now';after.patients[0].updatedAt='now';after.patients[0].activeIssue={updatedAt:'now',history:[],description:'Cough',status:'active'};
 assert.deepEqual(pendingRosterChanges(before,after),[]);assert.deepEqual(pendingRosterChanges(after,after),[]);assert.deepEqual(pendingRosterChanges(null,after),[]);
});
