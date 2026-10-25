import test from 'node:test';
import assert from 'node:assert/strict';
import {hospitalAt,validateHospitalStays,updateHospitalStay} from '../public/hospital.mjs';
import {blankLedger,normalizeRoster,rosterView,upsertEntry,upsertInteractiveEntry,dueState,entryIssues,addDays,today,isPostHospitalReview} from '../public/core.mjs';
import {routineCandidates,addRoutineBatch} from '../public/workspace.mjs';
import {roundCandidates,dayRecord,startVisit,generationInput,contextRecord} from '../public/notes-core.mjs';
import {mergeRoster} from '../public/roster-merge.mjs';
const date=today(),admitted=addDays(date,-3),prior=addDays(date,-5),phn='0000000001',key='phn:'+phn;
const p=()=>({id:'test',name:'SYNTHETIC, Hospital',phn,key,unit:'a',room:'1',codes:'401',panel:true});
const roster=()=>({patients:[p()],units:[{id:'a',name:'Synthetic'}]});
const admittedRoster=()=>updateHospitalStay(roster(),key,{admittedDate:admitted},date);
const bill=()=>{const l=blankLedger();l.patients[key]=p();l.baselines[key]={date:prior};return l;};
test('legacy roster, exact PHN identity and hospital history validation',()=>{
  assert.equal(hospitalAt(p(),date),null);
  assert.throws(()=>updateHospitalStay(roster(),'phn:0000000002',{admittedDate:admitted},date),/verified roster PHN/);
  assert.throws(()=>updateHospitalStay(roster(),key,{admittedDate:addDays(date,1)},date),/future/);
  assert.throws(()=>validateHospitalStays({hospitalStays:[{id:'x',admittedDate:'2026-02-30',returnedDate:null}]}),/Invalid/);
  const raw=admittedRoster(),s=raw.patients[0].hospitalStays[0];
  assert.throws(()=>updateHospitalStay(raw,key,{admittedDate:date},date),/overlap/);
  assert.throws(()=>updateHospitalStay(raw,key,{id:'missing',admittedDate:admitted},date),/changed/);
  assert.throws(()=>updateHospitalStay(raw,key,{id:s.id,admittedDate:admitted,returnedDate:prior},date),/Invalid/);
  const normalized=normalizeRoster(raw);assert.deepEqual(normalized.patients[0].hospitalStays,raw.patients[0].hospitalStays);
  assert.deepEqual(rosterView(normalized,bill()).find(p=>p.key===key).hospitalStays,raw.patients[0].hospitalStays);
});
test('hospital status follows service date with inclusive admission and exclusive return',()=>{
  const raw=admittedRoster(),s=raw.patients[0].hospitalStays[0];
  const returned=updateHospitalStay(raw,key,{...s,returnedDate:date},date).patients[0];
  assert.equal(hospitalAt(returned,prior),null);assert.ok(hospitalAt(returned,admitted));assert.ok(hospitalAt(returned,addDays(date,-1)));assert.equal(hospitalAt(returned,date),null);
  const sameDay={...p(),hospitalStays:[{id:'day',admittedDate:date,returnedDate:date}]};assert.equal(hospitalAt(sameDay,date),null);
});
test('114 is hard blocked while 14077 remains valid and its duration checks remain',()=>{
  const patient=normalizeRoster(admittedRoster()).patients[0],l=bill();
  for(const fn of [upsertEntry,upsertInteractiveEntry])assert.throws(()=>fn(l,patient,date,[{code:'00114',units:1,reason:'Early visit reason'}]),/114 is blocked/);
  const next=upsertInteractiveEntry(l,patient,date,[{code:'14077',units:1,start:'10:00',end:'10:10',diagnosis:'401'}]);
  assert.deepEqual(next.entries[0].items.map(i=>i.code),['14077']);assert.deepEqual(entryIssues(next.entries[0],next,patient),[]);
  next.entries[0].items[0].end='10:03';assert.match(entryIssues(next.entries[0],next,patient).join(' '),/eight minutes/);
  const earlier=upsertEntry(l,p(),date,[{code:'00114',units:1,reason:'Review'}]);
  assert.match(entryIssues(earlier.entries[0],earlier,patient).join(' '),/in hospital/);
});
test('routine billing and default Notes queue exclude hospital patients, Show all retains visibility',()=>{
  const patient=normalizeRoster(admittedRoster()).patients[0],l=bill(),day=dayRecord(l.datasetId,date);
  assert.equal(dueState(l,patient,date).kind,'hospital');assert.equal(routineCandidates(l,[patient],date)[0].status,'hospital');
  assert.throws(()=>addRoutineBatch(l,[patient],date,[key]),/not eligible/);
  day.entries[key]={patient:{key}};assert.equal(roundCandidates([patient],l,day).length,0);assert.equal(roundCandidates([patient],l,day,'',true).length,1);
});
test('return resets 114 planning immediately; conference does not reset it; actual visit does',()=>{
  const raw=admittedRoster(),s=raw.patients[0].hospitalStays[0],patient=normalizeRoster(updateHospitalStay(raw,key,{...s,returnedDate:date},date)).patients[0],l=bill();
  assert.equal(dueState(l,patient,date).postHospitalReview,true);assert.equal(dueState(l,patient,date).due,date);
  const conference=upsertEntry(l,patient,addDays(date,-1),[{code:'14077',units:1,start:'10:00',end:'10:10'}]);
  assert.equal(dueState(conference,patient,date).kind,'due');
  const next=addRoutineBatch(conference,[patient],date,[key]).ledger;
  const entry=next.entries.find(e=>e.date===date);assert.deepEqual(entryIssues(entry,next,patient),[]);
  assert.equal(dueState(next,patient,date).due,addDays(date,14));assert.equal(isPostHospitalReview(next,patient,date),true);assert.equal(isPostHospitalReview(next,patient,addDays(date,1)),false);
  assert.equal(l.entries.length,0);assert.equal(l.baselines[key].date,prior);
});
test('post hospital Notes draft has a title and dates, without clinical assertions or review',()=>{
  const raw=admittedRoster(),s=raw.patients[0].hospitalStays[0],patient=normalizeRoster(updateHospitalStay(raw,key,{...s,returnedDate:date},date)).patients[0],l=bill();
  const day=dayRecord(l.datasetId,date),entry=startVisit(day,patient,roster().units,l);
  assert.equal(entry.title,'Post hospital review');assert.equal(entry.hospitalStay.returnedDate,date);assert.equal(entry.reportMode,'custom');assert.equal(entry.assessment,'');assert.equal(entry.confirmed,false);assert.equal(entry.reviewedAt,null);assert.equal(l.entries.length,0);
  entry.confirmed=true;assert.equal(generationInput(entry,contextRecord(l.datasetId),date).visitTitle,'Post hospital review');
});
test('hospital history persists through later stays; concurrent date edits require review',()=>{
  const base=admittedRoster(),s=base.patients[0].hospitalStays[0];
  const local=updateHospitalStay(base,key,{...s,returnedDate:addDays(date,-1)},date),remote=updateHospitalStay(base,key,{...s,returnedDate:date},date);
  assert.equal(mergeRoster(base,local,remote).conflicts.length,1);
  const other=structuredClone(base);other.patients[0].room='2';const merged=mergeRoster(base,local,other);assert.equal(merged.conflicts.length,0);assert.equal(merged.roster.patients[0].hospitalStays[0].returnedDate,addDays(date,-1));
  const again=updateHospitalStay(local,key,{admittedDate:date},date);assert.equal(again.patients[0].hospitalStays.length,2);assert.equal(again.patients[0].hospitalStays[0].id,s.id);assert.ok(hospitalAt(again.patients[0],date));
});
