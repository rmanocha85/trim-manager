import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMost,latestDocumentedMost} from '../public/most-designations.mjs';
import {profileDisplay} from '../public/profile-display.mjs';
import {addOther} from '../public/patients-core.mjs';
test('MOST uses the six form designations and does not infer an ambiguous C2',()=>{
 for(const value of ['CPR C2','DNACPR C2','DNACPR C1','DNACPR M3','DNACPR M2','DNACPR M1'])assert.equal(normalizeMost(value),value);
 for(const value of ['C2','CPR M1','CPR C1','Review'])assert.equal(normalizeMost(value),'');
 assert.equal(normalizeMost('DNA CPR M3'),'DNACPR M3');assert.equal(normalizeMost('M2'),'DNACPR M2');
});
test('latest dated MOST takes precedence, with review wording and source retained',()=>{
 const summaryMarkdown='MOST DNACPR M2 retained on 2025-01-01.\nMOST CPR C2 documented on 2026-06-18; reconciliation pending.';
 const d=profileDisplay({summaryMarkdown});assert.equal(d.mostStatus,'CPR C2');assert.match(d.mostEvidence,/Pending review/);assert.ok(d.mostEvidence.includes(summaryMarkdown));
 assert.equal(latestDocumentedMost(['MOST M1 on 2026-06-18; MOST M2 on 2026-06-18']).designation,'');
});
test('discussion does not turn a proposed MOST into a current order',()=>{
 for(const text of ['MOST M2 retained after discussion of possible M1.','MOST M2, possible future M1 discussed.'])assert.equal(profileDisplay({summaryMarkdown:text}).mostStatus,'DNACPR M2');
 for(const text of ['MOST M1 proposed.','MOST possible M1.','MOST C2, pending review.'])assert.equal(profileDisplay({summaryMarkdown:text}).mostStatus,'');
});
test('adding Other Patients preserves panel and data, rejects duplicates, and restores retained identity',()=>{
 const p={id:'one',name:'Example, One',phn:'0000000001',ava:'123456',unit:'test',room:'1',codes:'401'},raw={patients:[p],units:[{id:'test',name:'TEST'}],otherPatients:[],removedPatients:[],billingDates:[],custom:{keep:true}};
 const fields={...p,id:undefined,name:'Example, Two',phn:'0000000002',ava:'123457',doctor:'Dr. Adam Siemens'},before=structuredClone(raw);
 const result=addOther(raw,fields,'2026-10-31',()=> 'two');assert.deepEqual(raw,before);assert.deepEqual(result.patients,raw.patients);assert.deepEqual(result.custom,raw.custom);assert.equal(result.otherPatients[0].doctor,fields.doctor);assert.equal(result.otherPatients[0].newPanelPatient,false);
 assert.throws(()=>addOther(result,fields),/already belongs/);assert.throws(()=>addOther(raw,p),/already belongs/);
 const retained={...fields,id:'retained',removedDate:'2026-10-01',custom:{preserve:true}};const restored=addOther({...raw,removedPatients:[retained]},fields,'2026-10-31');assert.equal(restored.otherPatients[0].id,'retained');assert.deepEqual(restored.otherPatients[0].custom,retained.custom);assert.equal(restored.removedPatients.length,0);
});

test('documented transitions and discussions retain the actual order, not a recommendation',()=>{
 for(const [summaryMarkdown,expected] of [
 ['MOST changed from CPR C2 to DNR M3 after discussion with patient and daughter on 2026-04-10.','DNACPR M3'],
 ['MOST M3 changed to M2. Possible future M1 discussed, not an actual change.','DNACPR M2'],
 ['MOST DNR M2 changed to M3 after discussion.','DNACPR M3'],
 ['MOST M2 left pending family discussion; physician recommended M1.','DNACPR M2'],
 ['MOST DNR M2 carried forward after prior family discussion.','DNACPR M2'],
 ['MOST DNR M3 after son discussion supersedes earlier DNACPR C1.','DNACPR M3'],
 ['MOST family agreed M3 replacing prior DNACPR C1.','DNACPR M3'],
 ['MOST December admission DNR C1. January 16, 2026 review records M3 without SDM present.','DNACPR M3'],
 ['MOST retains M2, but concluding paragraph DNR M3: unresolved internal conflict, no single designation inferred.',''],
 ])assert.equal(profileDisplay({summaryMarkdown}).mostStatus,expected,summaryMarkdown);
});
