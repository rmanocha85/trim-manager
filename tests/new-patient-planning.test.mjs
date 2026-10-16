import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {blankLedger,normalizeRoster,planNewPatients,dueState,upsertEntry,validateLedger,setFirstRoutineReview} from '../billing/core.mjs';
import {routineCandidates,sessionChanges,changedBillCount,addRoutineBatch} from '../billing/workspace.mjs';
import {mergeSession} from '../billing/merge.mjs';
const sandbox={};vm.runInNewContext(readFileSync(new URL('../roster-core.js',import.meta.url),'utf8'),sandbox);const manager=sandbox.TrimRoster;
const fields={name:'EXAMPLE, New',phn:'0000000001',ava:'123456',unit:'a',room:'1',codes:'401'};
const raw={patients:[],removedPatients:[],units:[{id:'a',name:'Synthetic unit'}],billingDates:[]};
const added=manager.add(raw,fields,'2026-09-01',()=> 'new');
const roster=normalizeRoster(added),p=roster.patients[0];
const base=()=>blankLedger('synthetic');
test('new panel patient is immediately due, without admission, calendar, or charge',()=>{
 const b=base(),l=planNewPatients(b,roster,'2026-09-01');
 assert.equal(p.panelAddedDate,'2026-09-01');assert.equal(p.newPanelPatient,true);
 assert.equal(dueState(b,p,'2026-09-01').kind,'due');
 assert.deepEqual(l.newPatientStarts[p.key],{addedDate:'2026-09-01',firstRoutineDate:null});
 assert.equal(l.entries.length,0);assert.deepEqual(l.baselines,{});assert.equal(l.routineStarts,undefined);
 assert.equal(dueState(l,p,'2026-08-31').kind,'unknown');assert.equal(dueState(l,p,'2026-09-01').kind,'due');
 assert.equal(routineCandidates(l,[p],'2026-09-01')[0].status,'due');
 assert.equal(changedBillCount(sessionChanges(b,l)),0);assert.deepEqual(planNewPatients(l,roster,'2026-09-01'),l);
});
test('legacy unknown, coverage and restored patients are not inferred to be new',()=>{
 const legacy=normalizeRoster({...raw,patients:[{id:'old',...fields}]});assert.equal(planNewPatients(base(),legacy,'2026-09-01').newPatientStarts,undefined);
 assert.equal(dueState(base(),legacy.patients[0],'2026-09-01').kind,'unknown');
 const coverage=normalizeRoster({...raw,otherPatients:added.patients});assert.equal(planNewPatients(base(),coverage,'2026-09-01').newPatientStarts,undefined);
 assert.equal(dueState(base(),coverage.otherPatients[0],'2026-09-01').kind,'adhoc');
 const restored=manager.add(manager.remove(added,'new','2026-09-01'),fields,'2026-09-02');
 assert.equal(restored.patients[0].id,'new');assert.equal(restored.patients[0].newPanelPatient,false);
 assert.equal(planNewPatients(base(),normalizeRoster(restored),'2026-09-02').newPatientStarts,undefined);
});
test('actual 114 takes precedence and begins two-week countdown',()=>{
 let l=planNewPatients(base(),roster,'2026-09-01');
 l=upsertEntry(l,p,'2026-09-01',[{code:'00114',units:1}]);assert.equal(dueState(l,p,'2026-09-02').due,'2026-09-15');
 const existing=upsertEntry(base(),p,'2026-08-30',[{code:'00114',units:1}]);
 assert.equal(planNewPatients(existing,roster,'2026-09-01').newPatientStarts,undefined);
 assert.equal(dueState(existing,p,'2026-09-01').kind,'later');
});
test('saved future and missing calendar plans no longer delay first routine billing',()=>{
 for(const firstRoutineDate of [null,'2026-09-10']){
  const l=base();l.patients[p.key]=p;l.newPatientStarts={[p.key]:{addedDate:'2026-09-01',firstRoutineDate}};
  const before=structuredClone(l);assert.equal(dueState(l,p,'2026-09-01').kind,'due');assert.deepEqual(l,before);
 }
 const old=setFirstRoutineReview(base(),p,'2026-09-01','2026-09-10');
 assert.equal(dueState(old,p,'2026-09-01').kind,'due');assert.equal(old.routineStarts[p.key].firstRoutineDate,'2026-09-10');
});
test('unused calendar cache retires without changing charges or historical provenance',()=>{
 const l=setFirstRoutineReview(base(),p,'2026-09-01','2026-09-10');
 l.settings.trimVisitCalendar={dates:[],checkedAt:'old-unused-value'};
 const n=planNewPatients(l,roster,'2026-09-01');
 assert.equal(n.settings.trimVisitCalendar,undefined);
 assert.deepEqual(n.entries,l.entries);assert.deepEqual(n.baselines,l.baselines);assert.deepEqual(n.routineStarts,l.routineStarts);validateLedger(n);
});
test('device merge retains separate patients and their immediate-start markers',()=>{
 const b=base(),local=planNewPatients(b,roster,'2026-09-01'),other={...p,id:'other',key:'phn:0000000002',phn:'0000000002'};
 const remote=planNewPatients(b,{patients:[other]},'2026-09-01');
 const m=mergeSession(b,local,remote);assert.deepEqual(m.conflicts,[]);assert.equal(Object.keys(m.ledger.newPatientStarts).length,2);validateLedger(m.ledger);
});
test('routine batch includes new patient immediately but still requires selection and prevents duplicates',()=>{
 const l=planNewPatients(base(),roster,'2026-09-01');
 assert.equal(l.entries.length,0);
 const built=addRoutineBatch(l,[p],'2026-09-01',[p.key]).ledger;
 assert.equal(built.entries.length,1);assert.ok(built.entries[0].items.some(i=>i.code==='00114'));
 assert.equal(routineCandidates(built,[p],'2026-09-01')[0].status,'billed');
 assert.equal(routineCandidates(built,[p],'2026-09-02')[0].status,'later');
 const missing={...p,codes:''};assert.equal(routineCandidates(l,[missing],'2026-09-01')[0].status,'review');
});
