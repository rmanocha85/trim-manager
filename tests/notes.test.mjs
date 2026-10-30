import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {blankLedger} from '../public/core.mjs';
import {contextRecord,dayRecord,startVisit,markReviewed,isReviewed,editVisit,makeHandoff,validateHandoff,generationInput,parseGenerated,roundCandidates,validateRecord,QUICK_STATEMENTS,visitStatements} from '../public/notes-core.mjs';
import {LocalNotesStore} from '../notes-local.mjs';
import {DriveNotesRepository,checkPath} from '../public/notes-storage.mjs';

test('Drive Notes finds one accessible existing folder when its ancestors are hidden, without creating folders',async()=>{
 const calls=[];const repo=new DriveNotesRepository({fileId:'billing',request:async(url,options)=>{calls.push({url,options});if(url.includes('permissions'))return {mimeType:'application/vnd.google-apps.folder',permissions:[{role:'owner'}]};if(url.includes('?q='))return {files:[{id:'existing-notes'}]};throw Object.assign(new Error('Hidden ancestor'),{status:404});}});
 assert.equal(await repo.root(true),'existing-notes');assert.ok(calls.every(c=>!c.options?.method));
 const missing=new DriveNotesRepository({fileId:'billing',request:async url=>{if(url.includes('?q='))return {files:[]};throw Object.assign(new Error('Hidden ancestor'),{status:403});}});
 await assert.rejects(missing.root(true),/not accessible/);
});
const date='2026-10-12',p={id:'test',key:'phn:0000000001',name:'SYNTHETIC, One',phn:'0000000001',unit:'test',room:'1',panel:true},units=[{id:'test',name:'SYNTHETIC'}];
function fixture(){const context=contextRecord('test'),day=dayRecord('test',date),entry=startVisit(day,p,units);return {context,day,entry};}
test('quick statements default off, remain specific to a visit and send only selected facts to AI',()=>{
  const {context,day,entry}=fixture();entry.confirmed=true;
  assert.equal(entry.reportMode,'combined');assert.deepEqual(visitStatements(entry),[]);
  editVisit(entry,'input','Nursing update.');editVisit(entry,'quickStatements',['bpsdStable','vitalsStable','glucometersStable']);
  editVisit(entry,'quickStatements',['bpsdStable','glucometersStable']);
  const input=generationInput(entry,context,date);
  assert.equal(input.today.input,'Nursing update.\n'+QUICK_STATEMENTS.bpsdStable+'\n'+QUICK_STATEMENTS.glucometersStable);
  assert.equal(input.today.noPlanChanges,false);assert.ok(!input.today.input.includes(QUICK_STATEMENTS.vitalsStable));assert.ok(!input.today.input.includes(QUICK_STATEMENTS.labsCurrent));
  const second=startVisit(day,{...p,id:'two',key:'phn:0000000002',phn:'0000000002'},units);
  assert.deepEqual(visitStatements(second),[]);assert.equal(second.reportMode,'combined');
  assert.deepEqual(visitStatements(startVisit(dayRecord('test','2026-10-13'),p,units)),[]);
  assert.deepEqual(visitStatements(JSON.parse(JSON.stringify(entry))),visitStatements(entry));
});
test('changed quick statements invalidate review and removed selections leave the next AI input',()=>{
  const {context,day,entry}=fixture();entry.confirmed=true;entry.assessment='Physician reviewed note.';
  editVisit(entry,'quickStatements',['labsCurrent']);markReviewed(entry,context,date);const version=entry.version;
  editVisit(entry,'quickStatements',['labsCurrent','labsCurrent']);assert.equal(entry.version,version);assert.equal(isReviewed(entry),true);
  editVisit(entry,'quickStatements',[]);assert.equal(isReviewed(entry),false);assert.throws(()=>makeHandoff(day),/No reviewed/);
  assert.equal(generationInput(entry,context,date).today.input,'');assert.equal(entry.reviews[0].assessment,'Physician reviewed note.');
  assert.throws(()=>editVisit(entry,'quickStatements',['unknown']),/Invalid visit statement/);
});
test('older visit records load without adding clinical statements or changing report source',()=>{
  const {context,day,entry}=fixture();delete entry.quickStatements;entry.confirmed=true;entry.reportMode='nursing';
  validateRecord(day,'test','visits',date);const input=generationInput(entry,context,date);
  assert.deepEqual(visitStatements(entry),[]);assert.equal(input.today.report,'No new concerns reported by nursing.');assert.equal(input.today.input,'');assert.equal(Object.hasOwn(entry,'quickStatements'),false);
  entry.quickStatements=['unknown'];assert.throws(()=>validateRecord(day,'test','visits',date),/Invalid visit statement/);
});
test('reviewed handoff contains exact text and no billing data; edits invalidate review',()=>{
  const {context,day,entry}=fixture();assert.throws(()=>makeHandoff(day),/No reviewed/);entry.confirmed=true;entry.generatedAssessment='AI version';entry.assessment='Physician edited version';entry.proposedSummary='Ongoing physician target';markReviewed(entry,context,date);
  assert.equal(isReviewed(entry),true);const h=makeHandoff(day);assert.equal(h.patients[0].assessment,'Physician edited version');assert.equal(context.patients[p.key].lastReviewed.text,'Physician edited version');assert.ok(!/billing|due|charge/.test(JSON.stringify(h)));assert.equal(entry.generatedAssessment,'AI version');
  editVisit(entry,'input','New concern');assert.equal(isReviewed(entry),false);assert.throws(()=>makeHandoff(day));assert.equal(entry.reviews[0].assessment,'Physician edited version');
});
test('handoff duplicate and identity mismatches rejected; unknown baseline not automatically due',()=>{
  const {context,day,entry}=fixture();entry.confirmed=true;entry.assessment='Reviewed';markReviewed(entry,context,date);const h=makeHandoff(day);h.patients.push({...h.patients[0],key:'other'});assert.throws(()=>validateHandoff(h),/duplicate/);assert.throws(()=>startVisit(day,{...p,id:'different'},units),/identity changed/);assert.throws(()=>startVisit(day,{...p,phn:'0000000002'},units),/PHN/);
  const ledger=blankLedger('test');assert.equal(roundCandidates([p],ledger,dayRecord('test',date)).length,0);assert.equal(roundCandidates([p],ledger,day).length,1);
  const empty=dayRecord('test',date);ledger.entries=[{patientKey:p.key,date,items:[{code:'00114'}]}];assert.equal(roundCandidates([p],ledger,empty).length,1);
});
test('generation uses prior reviewed output and explicit today source without identifiers or future review',()=>{
  const {context,entry}=fixture();entry.confirmed=true;context.patients[p.key]={summaryMarkdown:'Target established by physician',lastReviewed:{serviceDate:'2026-10-01',text:'Edited prior note'}};entry.reportMode='nursing';
  const input=generationInput(entry,context,date);assert.equal(input.previousReviewedNote,'Edited prior note');assert.equal(input.today.noPlanChanges,false);assert.match(input.today.report,/nursing/);assert.ok(!JSON.stringify(input).includes(p.phn));assert.ok(!JSON.stringify(input).includes(p.name));
  assert.throws(()=>generationInput(entry,context,'2026-09-01'),/later reviewed/);
});
test('old-day reviews do not replace newer summaries; incomplete AI JSON cannot become a note',()=>{
  const {context,entry}=fixture();entry.confirmed=true;entry.assessment='Historical note';entry.proposedSummary='Old';context.patients[p.key]={summaryMarkdown:'New',lastReviewed:{serviceDate:date,text:'New note'}};markReviewed(entry,context,'2026-10-01');assert.equal(context.patients[p.key].summaryMarkdown,'New');
  assert.throws(()=>parseGenerated('{"assessment":"partial'));assert.throws(()=>parseGenerated('{"assessment":""}'));assert.deepEqual(parseGenerated('```json\n{"assessment":"Note","summaryMarkdown":"Summary"}\n```'),{assessment:'Note',summaryMarkdown:'Summary'});assert.throws(()=>validateRecord(dayRecord('other',date),'test','visits',date));
});
test('local clinical save is atomic, idempotent, conflicts retained and path traversal refused',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'trim-notes-test-'));try{const store=new LocalNotesStore(path.join(dir,'records'),path.join(dir,'locks'));const a=contextRecord('test'),b=contextRecord('other');const saved=await store.save('patient-context.json',a,'new');assert.deepEqual((await store.load('patient-context.json')).data,a);assert.equal((await store.save('patient-context.json',a,'new')).etag,saved.etag);await assert.rejects(store.save('patient-context.json',b,'new'),/changed/);assert.deepEqual((await store.load('patient-context.json')).data,a);assert.throws(()=>checkPath('../secrets.json'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('Drive clinical save refuses a shared folder and a duplicate filename',async()=>{
  const shared=new DriveNotesRepository({request:async()=>({mimeType:'application/vnd.google-apps.folder',permissions:[{role:'owner'},{role:'reader'}]})},'test-folder');await assert.rejects(shared.load('patient-context.json'),/private/);
  const duplicate=new DriveNotesRepository({request:async url=>url.includes('permissions')?{mimeType:'application/vnd.google-apps.folder',permissions:[{role:'owner'}]}:{files:[{id:'one'},{id:'two'}]}},'test-folder');await assert.rejects(duplicate.save('patient-context.json',{},'new'),/Duplicate/);
});
test('Drive notes detects a stale revision before writes and verifies the uploaded content',async()=>{
  let current={v:1},revision=1,writes=0;
  const adapter={request:async(url,options={})=>{if(url.includes('permissions'))return {mimeType:'application/vnd.google-apps.folder',permissions:[{role:'owner'}]};if(url.includes('?q='))return {files:[{id:'clinical'}]};if(options.method==='PUT'){assert.equal(options.headers['If-Match'],'v1');current=JSON.parse(options.body);revision++;writes++;return {};}if(url.includes('alt=media'))return structuredClone(current);return {etag:'v'+revision};}};
  const repo=new DriveNotesRepository(adapter,'folder');await assert.rejects(repo.save('patient-context.json',{v:2},'v0'),/changed/);assert.equal(writes,0);const result=await repo.save('patient-context.json',{v:2},'v1');assert.equal(result.etag,'v2');assert.deepEqual(result.data,{v:2});assert.equal(writes,1);
});
