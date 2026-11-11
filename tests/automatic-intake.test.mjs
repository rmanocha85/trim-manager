import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,readdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {DocumentIntake} from '../intake-local.mjs';
import {LocalNotesStore} from '../notes-local.mjs';
import {contextRecord} from '../public/notes-core.mjs';
import {checkManifest,reconciledFields} from '../public/intake-core.mjs';
import {mergeImportedContext} from '../public/context-refresh.mjs';
const phn='0000000001',key='phn:'+phn;
const result=()=>({reconciliationVersion:2,documentPhns:[[phn]],summaryMarkdown:'Existing important history. New documented result.',sourceSummary:'Synthetic result.',reviewIssues:[],sourceDates:['2026-11-05'],followUp:['Existing follow-up.'],labs:[{date:'2026-11-01',results:['Synthetic lab result']}],medicationUpdate:null});
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'trim-auto-intake-'));let intake;try{
 const notes=new LocalNotesStore(root,path.join(root,'locks')),patient={id:'synthetic',key,phn,name:'Example, Alex',unit:'test',room:'1',ava:'123456'},context=contextRecord('synthetic');
 context.patients[key]={patient,summaryMarkdown:'Existing important history.',followUp:['Existing follow-up.'],custom:{keep:true}};await notes.save('patient-context.json',context,'new');
 let calls=0,identifications=0,enabled=true,clock=Date.now(),proposal=result(),verify=async()=>({safeToSave:true,issues:[]}),identity={documentPhns:[[phn]]};
 const options={root,notes,stableMs:5000,now:()=>clock,lockRoot:path.join(root,'worker-locks'),roster:async()=>({patients:[patient],units:[]}),ledger:async()=>({datasetId:'synthetic'}),ai:{status:async()=>({planEnabled:enabled}),models:async()=>[{id:'synthetic-model'}],identifyDocuments:async()=>{identifications++;return identity;},analyzeDocuments:async()=>{calls++;return structuredClone(proposal);},verifyDocuments:async a=>verify(a)}};
 intake=new DocumentIntake(options);
 const payload=(text='synthetic source')=>{const id=randomUUID(),raw=Buffer.from('%PDF-1.4\n'+text+'\n%%EOF');return {job:{app:'trim-document-intake',schema:1,id,phn,datasetId:'synthetic',files:[{name:'synthetic.pdf',mime:'application/pdf',size:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),file:id+'-0.pdf'}]},documents:['data:application/pdf;base64,'+raw.toString('base64')]};};
 const settle=async()=>{while(intake.running)await new Promise(r=>setTimeout(r,5));};
 await fn({root,notes,intake,options,payload,settle,calls:()=>calls,identifications:()=>identifications,clock:n=>clock+=n,disable:()=>enabled=false,enable:()=>enabled=true,proposal:v=>proposal=v,verify:fn=>verify=fn,identity:v=>identity=v,context});await settle();
 }finally{while(intake?.running)await new Promise(r=>setTimeout(r,5));await rm(root,{recursive:true,force:true});}}
test('upload automatically saves structured context, verifies, archives, and is idempotent',()=>fixture(async({root,notes,intake,payload,settle,calls})=>{
 const p=payload();await intake.submit(p);await settle();const job=await intake.read(p.job.id);assert.equal(job.status,'accepted');assert.equal(calls(),1);await intake.submit(p);await settle();assert.equal(calls(),1);
 const c=(await notes.load('patient-context.json')).data.patients[key];assert.equal(c.sourceDocuments.length,1);assert.equal(c.importStatus.clinicalReviewStatus,'pending');assert.deepEqual(c.custom,{keep:true});assert.equal(c.labs.length,1);assert.match(c.sourceDocuments[0].path,/^extracted\//);assert.match(await readFile(path.join(root,c.sourceDocuments[0].path),'utf8'),/%PDF/);assert.deepEqual(await readdir(path.join(root,'Incoming')),[]);assert.equal((await readdir(path.join(root,'Intake jobs'))).length,1);
}));
test('folder drops wait for explicit request, freeze membership and deduplicate repeated requests',()=>fixture(async({root,notes,intake,payload,clock,calls,identifications,settle})=>{
 await mkdir(path.join(root,'Incoming'));const raw=Buffer.from(payload().documents[0].split(',')[1],'base64'),file=path.join(root,'Incoming','requested.pdf');await writeFile(file,raw);await intake.tick();clock(6000);await intake.tick();assert.equal((await intake.list()).length,0);
 const request=await intake.requestIncoming({id:randomUUID(),datasetId:'synthetic'});await writeFile(path.join(root,'Incoming','later.pdf'),Buffer.from('%PDF-1.4\nlater\n%%EOF'));await settle();assert.equal((await intake.incomingRequests()).find(r=>r.id===request.id).status,'completed');assert.equal(identifications(),1);assert.equal(calls(),1);assert.deepEqual(await readdir(path.join(root,'Incoming')),['later.pdf']);
 await intake.tick();assert.equal(calls(),1);await intake.requestIncoming({id:request.id,datasetId:'synthetic'});await settle();assert.equal(calls(),1);assert.equal((await intake.readIncoming(request.id)).files.length,1);
 await writeFile(file,raw);await intake.requestIncoming({id:randomUUID(),datasetId:'synthetic'});await settle();assert.equal(calls(),2);assert.ok((await intake.list()).some(j=>j.duplicate));assert.equal((await notes.load('patient-context.json')).data.patients[key].sourceDocuments.length,2);
}));
test('Drive request survives restart and waits for its exact source version, excluding later files',()=>fixture(async({root,intake,options,payload,clock,calls})=>{
 const id=randomUUID(),raw=Buffer.from(payload().documents[0].split(',')[1],'base64'),request={app:'trim-incoming-request',schema:1,id,datasetId:'synthetic',createdAt:new Date().toISOString(),files:[{name:'shared.pdf',size:raw.length,sha256:createHash('sha256').update(raw).digest('hex')}],issues:[],retryJobs:[]};
 await mkdir(path.join(root,'Intake jobs'),{recursive:true});await writeFile(intake.requestFile(id),JSON.stringify(request));await intake.tick();assert.equal((await intake.incomingRequests())[0].status,'waiting');assert.equal(calls(),0);
 await writeFile(path.join(root,'Incoming','shared.pdf'),Buffer.from('%PDF-wrong version'));await writeFile(path.join(root,'Incoming','later.pdf'),raw);await intake.tick();assert.equal(calls(),0);
 await writeFile(path.join(root,'Incoming','shared.pdf'),raw);const restarted=new DocumentIntake(options);await restarted.tick();assert.equal((await restarted.incomingRequests())[0].status,'completed');assert.equal(calls(),1);assert.deepEqual(await readdir(path.join(root,'Incoming')),['later.pdf']);
}));
test('direct app uploads do not discover unrelated folder drops; requests report invalid and missing sources',()=>fixture(async({root,intake,payload,settle,clock,calls})=>{
 await mkdir(path.join(root,'Incoming'));await writeFile(path.join(root,'Incoming','left-alone.pdf'),Buffer.from('%PDF-1.4\nunrequested'));await intake.submit(payload());await settle();assert.equal(calls(),1);assert.ok(await readFile(path.join(root,'Incoming','left-alone.pdf')));
 await writeFile(path.join(root,'Incoming','bad.png'),Buffer.from('not an image'));const requested=await intake.requestIncoming({id:randomUUID(),datasetId:'synthetic'});await settle();assert.equal((await intake.incomingRequests()).find(r=>r.id===requested.id).status,'attention');assert.ok(await readFile(path.join(root,'Incoming','bad.png')));
 await assert.rejects(intake.requestIncoming({id:randomUUID(),datasetId:'wrong'}),/another workspace/);
}));
test('offline queue resumes and transient verification failures retry automatically',()=>fixture(async({intake,payload,settle,disable,enable,clock,verify,calls})=>{
 disable();const p=payload();await intake.submit(p);await settle();assert.equal((await intake.read(p.job.id)).status,'waiting');enable();let n=0;verify(async()=>{if(!n++)throw new Error('Temporary network outage');return {safeToSave:true,issues:[]};});await intake.tick();assert.equal((await intake.read(p.job.id)).status,'waiting');clock(16000);await intake.tick();assert.equal((await intake.read(p.job.id)).status,'accepted');assert.equal(calls(),2);
}));
test('web retry requests reprocess held jobs and missing requested versions become needs-attention',()=>fixture(async({root,intake,payload,settle,verify,clock})=>{
 verify(async()=>({safeToSave:false,issues:['Synthetic review issue']}));const p=payload();await intake.submit(p);await settle();assert.equal((await intake.read(p.job.id)).status,'held');
 verify(async()=>({safeToSave:true,issues:[]}));await intake.requestIncoming({id:randomUUID(),datasetId:'synthetic',retryJobs:[p.job.id]});await settle();assert.equal((await intake.read(p.job.id)).status,'accepted');assert.equal((await intake.incomingRequests())[0].status,'completed');
 const request={app:'trim-incoming-request',schema:1,id:randomUUID(),datasetId:'synthetic',createdAt:new Date().toISOString(),files:[{name:'missing.pdf',size:20,sha256:'a'.repeat(64)}],issues:[],retryJobs:[]};await writeFile(intake.requestFile(request.id),JSON.stringify(request));await intake.tick();clock(15*60*1000+1);await intake.tick();const view=(await intake.incomingRequests()).find(r=>r.id===request.id);assert.equal(view.status,'attention');assert.match(view.items[0].message,/Check Drive sync/);
}));
test('mixed or missing identity and failed extraction audit hold sources without changing context',()=>fixture(async({root,intake,notes,payload,settle,proposal,verify})=>{
 for(const ids of [[[]],[['0000000002']],[['0000000001','0000000002']]]){proposal({...result(),documentPhns:ids});const p=payload(JSON.stringify(ids));await intake.submit(p);await settle();const j=await intake.read(p.job.id);assert.equal(j.status,'held');assert.equal(j.files[0].held,true);assert.match(await readFile(intake.source(j,j.files[0]),'utf8'),/%PDF/);}
 proposal(result());verify(async()=>({safeToSave:false,issues:['Important history was omitted.']}));const p=payload('omission');await intake.submit(p);await settle();assert.equal((await intake.read(p.job.id)).status,'held');assert.equal((await notes.load('patient-context.json')).data.patients[key].summaryMarkdown,'Existing important history.');assert.deepEqual(await readdir(path.join(root,'Incoming')),[]);
}));

test('Incoming identification still blocks absent, conflicting and non-roster PHNs before extraction',()=>fixture(async({root,intake,notes,payload,settle,identity,calls})=>{
 const before=(await notes.load('patient-context.json')).data;
 for(const documentPhns of [[[]],[['0000000001','0000000002']],[['0000000002']]]){
  const id=randomUUID(),raw=Buffer.from(payload().documents[0].split(',')[1],'base64'),name=id+'.pdf';
  await mkdir(path.join(root,'Incoming'),{recursive:true});await writeFile(path.join(root,'Incoming',name),raw);identity({documentPhns});
  await intake.requestIncoming({id,datasetId:'synthetic'});await settle();
  const job=(await intake.list()).find(j=>j.files[0].name===name);assert.equal(job.status,'held');assert.equal(calls(),0);
 }
 assert.deepEqual((await notes.load('patient-context.json')).data,before);
}));
test('concurrent target edit is preserved and another patient edit does not block import',()=>fixture(async({notes,intake,payload,settle,verify})=>{
 verify(async()=>{const c=await notes.load('patient-context.json');c.data.patients[key].summaryMarkdown='New physician edit';await notes.save('patient-context.json',c.data,c.etag);return {safeToSave:true,issues:[]};});const p=payload();await intake.submit(p);await settle();assert.equal((await intake.read(p.job.id)).status,'held');assert.equal((await notes.load('patient-context.json')).data.patients[key].summaryMarkdown,'New physician edit');
 verify(async()=>{const c=await notes.load('patient-context.json');c.data.patients['phn:0000000002']={patient:{phn:'0000000002',key:'phn:0000000002',name:'Other, Example'},summaryMarkdown:'Keep this edit'};await notes.save('patient-context.json',c.data,c.etag);return {safeToSave:true,issues:[]};});const other=payload('other change');await intake.submit(other);await settle();assert.equal((await intake.read(other.job.id)).status,'accepted');assert.equal((await notes.load('patient-context.json')).data.patients['phn:0000000002'].summaryMarkdown,'Keep this edit');
}));
test('restart after clinical save resumes archival without repeating extraction',()=>fixture(async({root,intake,notes,options,payload,settle,clock,calls})=>{
 const move=intake.moveVerified.bind(intake);intake.moveVerified=async()=>{throw new Error('Simulated interruption');};const p=payload();await intake.submit(p);await settle();assert.equal((await notes.load('patient-context.json')).data.patients[key].sourceDocuments.length,1);assert.equal(calls(),1);intake.moveVerified=move;clock(16000);const restarted=new DocumentIntake(options);await restarted.tick();assert.equal((await restarted.read(p.job.id)).status,'accepted');assert.equal(calls(),1);assert.deepEqual(await readdir(path.join(root,'Incoming')),[]);
}));
test('legacy Incoming job migrates; out-of-order Drive sync waits without a second click',()=>fixture(async({root,intake,payload,clock})=>{
 const p=payload();await mkdir(path.join(root,'Incoming'));await writeFile(path.join(root,'Incoming','intake-'+p.job.id+'.json'),JSON.stringify({...p.job,status:'ready'}));await intake.tick();assert.equal((await intake.read(p.job.id)).status,'waiting');assert.equal((await readdir(path.join(root,'Incoming'))).filter(n=>n.endsWith('.json')).length,0);await writeFile(path.join(root,'Incoming',p.job.files[0].file),Buffer.from(p.documents[0].split(',')[1],'base64'));clock(16000);await intake.tick();assert.equal((await intake.read(p.job.id)).status,'accepted');
}));
test('bad signatures and unsafe source paths are rejected',()=>fixture(async({intake,payload})=>{const p=payload();p.documents[0]='data:application/pdf;base64,eHl6';await assert.rejects(intake.submit(p),/contents/);p.job.files[0].file='../bad.pdf';assert.throws(()=>checkManifest(p.job),/Invalid source/);}));
test('the same source twice in one upload creates one clinical source receipt',()=>fixture(async({notes,intake,payload,settle,calls})=>{const p=payload();p.job.files.push({...p.job.files[0],file:p.job.id+'-1.pdf'});p.documents.push(p.documents[0]);await intake.submit(p);await settle();assert.equal((await intake.read(p.job.id)).status,'accepted');assert.equal((await notes.load('patient-context.json')).data.patients[key].sourceDocuments.length,1);assert.equal(calls(),1);}));
test('partial medication update preserves unseen items and blocks older or ambiguous removals',()=>{
 const current={summaryMarkdown:'DOB: 1940-01-01\nDOB source: intake\nHistory',medicationSnapshot:{sourceDate:'2026-11-01',scheduled:['A 1 mg','B 2 mg'],prn:['C as needed']}},v=result();v.medicationUpdate={sourceDate:'2026-11-05',scheduled:['A 2 mg'],prn:null,scheduledComplete:false,prnComplete:false,removeScheduled:['A 1 mg'],removePrn:[],caveats:[],regimenBasis:'documented_plan_not_administration_verified'};
 const merged=reconciledFields(current,v,'now');assert.deepEqual(merged.medicationSnapshot.scheduled,['B 2 mg','A 2 mg']);assert.deepEqual(merged.medicationSnapshot.prn,['C as needed']);assert.match(merged.summaryMarkdown,/DOB: 1940-01-01/);v.medicationUpdate.removeScheduled=['Unknown'];assert.throws(()=>reconciledFields(current,v,'now'),/does not match/);v.medicationUpdate.sourceDate='2026-10-30';v.sourceDates=['2026-10-30'];assert.throws(()=>reconciledFields(current,v,'now'),/Older/);
});
test('browser drafts rebase independent fields but preserve a conflicting draft for reconciliation',()=>{
 const base=contextRecord('synthetic');base.patients[key]={summaryMarkdown:'Old history',currentMost:{designation:'M2'}};const local=structuredClone(base),remote=structuredClone(base);local.patients[key].currentMost={designation:'M1'};remote.patients[key].summaryMarkdown='New imported history';const merged=mergeImportedContext(base,local,remote);assert.equal(merged.patients[key].summaryMarkdown,'New imported history');assert.equal(merged.patients[key].currentMost.designation,'M1');local.patients[key].summaryMarkdown='My edit';assert.throws(()=>mergeImportedContext(base,local,remote),/both changed summaryMarkdown/);assert.equal(local.patients[key].summaryMarkdown,'My edit');
});
