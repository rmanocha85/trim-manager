import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {ageOn,newPatient,demographicsHTML} from '../public/patient-identity.mjs';
import {profileDisplay,setProfileDisplay} from '../public/profile-display.mjs?v=20261030-workspace3';
import {DocumentIntake} from '../intake-local.mjs';
import {LocalNotesStore} from '../notes-local.mjs';
import {contextRecord} from '../public/notes-core.mjs';
import {checkManifest} from '../public/intake-core.mjs';
const phn='0000000001',key='phn:'+phn;
test('current age and fourteen-day new label handle birthday and date boundaries',()=>{
 assert.equal(ageOn('1940-10-31','2026-10-30'),85);assert.equal(ageOn('1940-10-31','2026-10-31'),86);assert.equal(ageOn('1940-02-30'),null);assert.equal(ageOn('2099-01-01'),null);
 const p={newPanelPatient:true,panelAddedDate:'2026-10-01'};assert.equal(newPatient(p,'2026-10-14'),true);assert.equal(newPatient(p,'2026-10-15'),false);assert.equal(newPatient({...p,newPanelPatient:false},'2026-10-02'),false);
});
test('profile projection reads exact wording, distinguishes C2, and flags proposed or conflicting orders',()=>{
 assert.equal(profileDisplay({summaryMarkdown:'## MOST\n- MOST CPR C2 retained.'}).mostStatus,'CPR C2');
 assert.equal(profileDisplay({summaryMarkdown:'- MOST DNR M2 retained.'}).mostStatus,'DNACPR M2');
 assert.equal(profileDisplay({summaryMarkdown:'- MOST M2 confirmed with son.'}).mostStatus,'M2');
 assert.equal(profileDisplay({summaryMarkdown:'- MOST M2, possible future M1 discussed.'}).mostStatus,'Review');
 assert.equal(profileDisplay({summaryMarkdown:'- DNACPR M1 narrative.\n- DNACPR M2 field; reconciliation pending.'}).mostStatus,'Review');
 setProfileDisplay({patients:{[phn]:{dateOfBirth:'1940-10-31',mostStatus:'M2',mostEvidence:'MOST M2 confirmed.'}}});const h=demographicsHTML({phn},'2026-10-30');assert.match(h,/85 y/);assert.match(h,/MOST M2/);setProfileDisplay(null);
});
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'trim-intake-'));try{
 const notes=new LocalNotesStore(root,path.join(root,'locks')),patient={id:'synthetic',key,phn,name:'Example, Alex',unit:'test',room:'1',ava:'123456'};
 const context=contextRecord('synthetic');context.patients[key]={patient,summaryMarkdown:'Existing important history.',custom:{keep:true}};await notes.save('patient-context.json',context,'new');
 let calls=0,enabled=true,proposal={documentPhns:[[phn]],summaryMarkdown:'Existing important history. New documented result.',sourceSummary:'Synthetic result.',reviewIssues:[]};
 const intake=new DocumentIntake({root,notes,roster:async()=>({patients:[patient],units:[]}),ledger:async()=>({datasetId:'synthetic'}),ai:{status:async()=>({planEnabled:enabled}),models:async()=>[{id:'synthetic-model'}],analyzeDocuments:async args=>{calls++;assert.equal(args.documents[0].mime,'application/pdf');return structuredClone(proposal);}}});
 const payload=()=>{const id=randomUUID(),raw=Buffer.from('%PDF-1.4\nsynthetic source\n%%EOF'),sha256=createHash('sha256').update(raw).digest('hex');return {job:{app:'trim-document-intake',schema:1,id,phn,datasetId:'synthetic',files:[{name:'synthetic.pdf',mime:'application/pdf',size:raw.length,sha256,file:id+'-0.pdf'}]},documents:['data:application/pdf;base64,'+raw.toString('base64')]};};
 const settle=async()=>{while(intake.running)await new Promise(r=>setTimeout(r,5));};
 await fn({root,notes,intake,payload,settle,calls:()=>calls,disable:()=>enabled=false,enable:()=>enabled=true,proposal:v=>proposal=v,context});await settle();
 }finally{await rm(root,{recursive:true,force:true});}}
test('uploads verify and retain original, analyze once, accept conditionally without losing unrelated fields',()=>fixture(async({root,notes,intake,payload,settle,calls})=>{
 const p=payload();await intake.submit(p);await settle();assert.equal((await intake.read(p.job.id)).status,'ready');assert.equal(calls(),1);await intake.submit(p);await settle();assert.equal(calls(),1);
 assert.equal((await notes.load('patient-context.json')).data.patients[key].summaryMarkdown,'Existing important history.');
 await intake.accept(p.job.id);await intake.accept(p.job.id);const c=(await notes.load('patient-context.json')).data.patients[key];assert.equal(c.sourceDocuments.length,1);assert.equal(c.importStatus.clinicalReviewStatus,'pending');assert.deepEqual(c.custom,{keep:true});assert.match(await readFile(path.join(root,'Incoming',p.job.files[0].file),'utf8'),/%PDF/);
}));
test('changed context, missing PHN, and wrong file contents cannot be imported',()=>fixture(async({notes,intake,payload,settle,proposal})=>{
 const p=payload();await intake.submit(p);await settle();const c=await notes.load('patient-context.json');c.data.patients[key].summaryMarkdown='Newer physician edit';await notes.save('patient-context.json',c.data,c.etag);await assert.rejects(intake.accept(p.job.id),/changed since analysis/);
 proposal({documentPhns:[[]],summaryMarkdown:'Unmatched',sourceSummary:'No PHN',reviewIssues:[]});const missing=payload();await intake.submit(missing);await settle();assert.equal((await intake.read(missing.job.id)).status,'identity-review');await assert.rejects(intake.accept(missing.job.id),/identity/);
 const corrupt=payload();corrupt.documents[0]='data:application/pdf;base64,eHl6';await assert.rejects(intake.submit(corrupt),/contents/);const unsafe=payload();unsafe.job.files[0].file='../bad.pdf';assert.throws(()=>checkManifest(unsafe.job),/Invalid source/);
}));
test('offline queue resumes automatically and every document must have the matching PHN',()=>fixture(async({intake,payload,settle,disable,enable,proposal})=>{
 disable();const p=payload();await intake.submit(p);await settle();assert.equal((await intake.read(p.job.id)).status,'waiting');enable();await intake.tick();assert.equal((await intake.read(p.job.id)).status,'ready');
 proposal({documentPhns:[[phn],['0000000002']],summaryMarkdown:'Mixed',sourceSummary:'Mixed identities',reviewIssues:[]});const mixed=payload();const f={...mixed.job.files[0],file:mixed.job.id+'-1.pdf'};mixed.job.files.push(f);mixed.documents.push(mixed.documents[0]);await intake.submit(mixed);await settle();assert.equal((await intake.read(mixed.job.id)).status,'identity-review');
}));
