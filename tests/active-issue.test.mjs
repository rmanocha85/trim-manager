import test from 'node:test';
import assert from 'node:assert/strict';
import {saveActiveIssue,resolveActiveIssue,hasActiveIssue,validate,remove} from '../public/patients-core.mjs';
import {mergeRoster} from '../public/roster-merge.mjs';
const started='2026-11-11T18:00:00.000Z',edited='2026-11-12T18:00:00.000Z',resolved='2026-11-13T18:00:00.000Z',reopened='2026-11-14T18:00:00.000Z';
const base=()=>({patients:[{id:'mine',name:'Example, Mine',phn:'0000000001',unit:'test',room:'1',palliativeFlag:true,custom:{keep:true}}],otherPatients:[{id:'other',name:'Example, Other',phn:'0000000002',unit:'test',room:'2',doctor:'Dr. Example'}],removedPatients:[],units:[{id:'test',name:'Synthetic'}],billingDates:[]});
for(const [collection,id] of [['patients','mine'],['otherPatients','other']])test(collection+' retains issue history, identity and unrelated patient fields',()=>{
 const original=base(),saved=saveActiveIssue(original,id,'  Respiratory illness: reassess recovery.  ',started),patient=saved[collection][0];
 assert.equal(hasActiveIssue(patient),true);assert.equal(patient.activeIssue.description,'Respiratory illness: reassess recovery.');assert.equal(original[collection][0].activeIssue,undefined);
 const {activeIssue,...unchanged}=patient;assert.deepEqual(unchanged,original[collection][0]);
 const changed=saveActiveIssue(saved,id,'Improving; review again tomorrow.',edited),done=resolveActiveIssue(changed,id,resolved);
 assert.equal(done[collection][0].activeIssue.openedAt,started);assert.equal(done[collection][0].activeIssue.resolvedAt,resolved);assert.equal(hasActiveIssue(done[collection][0]),false);
 assert.deepEqual(resolveActiveIssue(done,id,reopened),done);assert.deepEqual(saveActiveIssue(changed,id,'Improving; review again tomorrow.',resolved),changed);
 const next=saveActiveIssue(done,id,'New follow-up.',reopened),issue=next[collection][0].activeIssue;
 assert.equal(issue.openedAt,reopened);assert.equal(issue.resolvedAt,null);assert.equal(issue.history.length,1);assert.equal(issue.history[0].description,'Improving; review again tomorrow.');assert.equal(issue.history[0].resolvedAt,resolved);assert.equal(issue.history[0].history,undefined);
 const untouched=collection==='patients'?'otherPatients':'patients';assert.deepEqual(next[untouched],original[untouched]);assert.deepEqual(next.units,original.units);assert.deepEqual(next.billingDates,original.billingDates);
});
test('issue editing requires an active roster identity and valid brief description',()=>{
 for(const text of ['', '   ',null,42,'x'.repeat(501)])assert.throws(()=>saveActiveIssue(base(),'mine',text,started),/brief follow-up/);
 assert.equal(saveActiveIssue(base(),'mine','x'.repeat(500),started).patients[0].activeIssue.description.length,500);
 assert.throws(()=>saveActiveIssue(base(),'missing','Review',started),/active roster patient/);
 assert.throws(()=>saveActiveIssue(remove(base(),'mine','2026-11-11'),'mine','Review',started),/active roster patient/);
 assert.throws(()=>resolveActiveIssue(base(),'mine',resolved),/no active issue/);
 assert.throws(()=>saveActiveIssue(base(),'mine','Review','invalid'),/Invalid active issue/);
 const active=saveActiveIssue(base(),'mine','Review',edited);assert.throws(()=>resolveActiveIssue(active,'mine',started),/Invalid active issue/);
 const bad=structuredClone(active);bad.patients[0].activeIssue.history=[{...bad.patients[0].activeIssue}];assert.throws(()=>validate(bad),/resolved issues/);
});
test('concurrent description edit and resolution need one whole issue choice',()=>{
 const b=saveActiveIssue(base(),'mine','Follow up symptoms.',started),local=saveActiveIssue(b,'mine','New symptoms need reassessment.',edited),remote=resolveActiveIssue(b,'mine',resolved);
 const merged=mergeRoster(b,local,remote);assert.equal(merged.conflicts.length,1);const conflict=merged.conflicts[0];assert.equal(conflict.id,'patient:mine.activeIssue');
 const selected=mergeRoster(b,local,remote,{[conflict.id]:{side:'local',token:conflict.token}});assert.equal(selected.conflicts.length,0);assert.equal(selected.roster.patients[0].activeIssue.status,'active');assert.equal(selected.roster.patients[0].activeIssue.description,'New symptoms need reassessment.');
 const remoteChoice=mergeRoster(b,local,remote,{[conflict.id]:{side:'drive',token:conflict.token}});assert.deepEqual(remoteChoice.roster.patients[0].activeIssue,remote.patients[0].activeIssue);
});
test('independent location edits merge with issue changes without losing either',()=>{
 const b=base(),local=saveActiveIssue(b,'other','Review tomorrow.',started),remote=base();remote.otherPatients[0].room='42';
 const merged=mergeRoster(b,local,remote);assert.equal(merged.conflicts.length,0);assert.equal(merged.roster.otherPatients[0].room,'42');assert.equal(merged.roster.otherPatients[0].activeIssue.description,'Review tomorrow.');
});
