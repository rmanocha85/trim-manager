import test from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger,upsertEntry,entryIssues,validDiagnoses,inheritConferenceDiagnoses,validateLedger} from '../public/core.mjs';
import {reportGroups} from '../public/reports.mjs';
const p={id:'synthetic',key:'phn:0000000001',phn:'0000000001',name:'SYNTHETIC, Example',room:'101',unit:'a',panel:true,codes:'401'};
test('one to three individually valid diagnoses accept common separators and reject incomplete codes or a fourth',()=>{
  for(const value of ['250','250 311','250, 311; V66.7','  038.9   E888.9 C19  ','250;311;401'])assert.equal(validDiagnoses(value),true,value);
  for(const value of ['',' , ; ','250 311 401 298','295 787.','250 invalid','250 <x>'])assert.equal(validDiagnoses(value),false,value);
});
test('three diagnoses survive save, conference inheritance and both report layouts without changing source data',()=>{
  const diagnosis='250 311 V66.7';
  const items=inheritConferenceDiagnoses([{code:'00114',units:1,reason:'Synthetic review',diagnosis,diagnosisMode:'per-charge'},{code:'14077',units:1,start:'10:00',end:'10:15',diagnosisSource:'primary114'}]);
  const l=upsertEntry(blankLedger('synthetic-diagnoses'),p,'2026-10-19',items),before=JSON.stringify(l);
  assert.deepEqual(entryIssues(l.entries[0],l,p),[]);
  const saved=validateLedger(JSON.parse(before));assert.equal(saved.entries[0].items[1].diagnosis,diagnosis);
  for(const layout of ['date','patient'])assert.ok(reportGroups(saved,{patients:[p],units:[]},saved.entries,layout).flatMap(g=>g.rows).some(r=>r.html.includes(diagnosis)));
  assert.equal(JSON.stringify(l),before);
  saved.entries[0].items[0].diagnosis+=' 401';assert.ok(entryIssues(saved.entries[0],saved,p).some(s=>s.includes('up to 3')));
});
test('14077 ignores imported annual history but still validates times, duration, units and overlaps',()=>{
  const l=upsertEntry(blankLedger('synthetic-annual'),p,'2026-10-19',[{code:'14077',units:1,start:'10:00',end:'10:10'}]);
  l.historicalBillings=[{id:'old',patientKey:p.key,date:'2026-09-15',codes:['14077'],status:'already_billed'}];
  const before=structuredClone(l.historicalBillings),i=l.entries[0].items[0];
  assert.deepEqual(entryIssues(l.entries[0],l,p),[]);assert.deepEqual(l.historicalBillings,before);
  i.end='';assert.ok(entryIssues(l.entries[0],l,p).some(s=>s.includes('start/end')));
  i.end='10:05';assert.ok(entryIssues(l.entries[0],l,p).some(s=>s.includes('eight minutes')));
  i.end='10:10';i.units=2;assert.ok(entryIssues(l.entries[0],l,p).some(s=>s.includes('units exceed')));
  i.units=1;l.entries.push({...structuredClone(l.entries[0]),id:'overlap',patientKey:'other'});assert.ok(entryIssues(l.entries[0],l,p).some(s=>s.includes('overlapping')));
});
