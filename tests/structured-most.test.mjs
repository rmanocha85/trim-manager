import test from 'node:test';
import assert from 'node:assert/strict';
import {profileDisplay,legacyMost} from '../public/profile-display.mjs';
import {reconcileMost,validateMostFindings} from '../public/intake-core.mjs';

const existing={mostStatus:'DNACPR M2',mostSource:{sourceDate:'2026-09-15',evidence:'MOST M2'}};
const file={name:'Review.pdf',sha256:'synthetic'},now='2026-11-16T22:00:00Z';
const finding=(designation,sourceDate,evidence=designation)=>({kind:'documented',designation,sourceDate,evidence});
const apply=(current,findings)=>({...current,...reconcileMost(current,findings,findings.map(()=>file),now)});

test('the display copies the structured field even when the narrative differs',()=>{
 assert.equal(profileDisplay({...existing,summaryMarkdown:'MOST CPR C2'}).mostStatus,'DNACPR M2');
 assert.equal(profileDisplay({mostStatus:null,summaryMarkdown:'MOST CPR C2'}).mostStatus,'');
 assert.equal(legacyMost({summaryMarkdown:'## Goals and function\n- M3 continued at review.'}).mostStatus,'DNACPR M3');
 assert.equal(legacyMost({summaryMarkdown:'## Imaging\n- C1 fracture.'}).mostStatus,'');
});
test('each actual upload must account for every source, including no mention',()=>{
 assert.throws(()=>validateMostFindings({},1));assert.throws(()=>validateMostFindings({mostFindings:[null]},2));
 assert.throws(()=>validateMostFindings({mostFindings:[finding('C2',null)]},1));
 assert.doesNotThrow(()=>validateMostFindings({mostFindings:[null]},1));
});
test('only newer supported designations replace the stored value',()=>{
 for(const findings of [[null],[{kind:'discussion',designation:null,evidence:'Family considering M1'}],[finding('CPR C2','2026-08-01')]]){
   assert.deepEqual(apply(existing,findings),existing);
 }
 const next=apply(existing,[finding('DNACPR M3','2026-10-01','MOST DNR M3')]);
 assert.equal(next.mostStatus,'DNACPR M3');assert.equal(next.mostSource.source,file.name);
 assert.deepEqual(apply(next,[null]),next);
 for(const findings of [[finding('CPR C2',null)],[finding('CPR C2','2026-09-15')],[finding('CPR C2','2026-10-01','C2')],[finding('CPR C2','2026-10-01','Unchecked CPR C2')],[finding('CPR C2','2026-10-01'),finding('DNACPR C2','2026-10-01')]]){
   const result=apply(existing,findings);assert.equal(result.mostStatus,existing.mostStatus);assert.ok(result.mostReview);
 }
});
