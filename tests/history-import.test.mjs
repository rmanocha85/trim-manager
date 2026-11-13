import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {savedHistoryImport,isHistoryDocument} from '../history-import.mjs';
import {profileDisplay,setProfileDisplay} from '../public/profile-display.mjs?v=20261113-history1';
import {pmhxUploadedHTML} from '../public/patient-identity.mjs?v=20261113-history1';
test('history recognition uses source content and explicit classifications, not retained merged history',()=>{
 for(const sourceSummary of ['LTC Admission Note with transfer history.','Past medical history and allergies.','Discharge summary.','Typed history.'])assert.equal(isHistoryDocument({sourceSummary}),true);
 for(const sourceSummary of ['CBC and electrolytes results.','Medication list only.','Appointment confirmation.'])assert.equal(isHistoryDocument({sourceSummary}),false);
 assert.equal(isHistoryDocument({historyDocument:false,sourceSummary:'Merged past medical history'}),false);
 assert.equal(isHistoryDocument({historyDocument:true,sourceSummary:'History described in a nursing letter.'}),true);
});
test('existing verified archived history imports check PMHx without modifying review, medication or roster state',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'trim-history-'));try{
 const id='12345678-1234-4234-8234-123456789012',phn='0000000001',file=path.join(root,'Intake jobs','intake-'+id+'.json');await mkdir(path.dirname(file));
 const context={patient:{phn},summaryMarkdown:'## MOST\nDNR M1 carried forward (changed from DNR M2 during admission).',sourceDocuments:[{intakeId:id,path:'extracted/2026-11-11/source.pdf',sha256:'synthetic-hash',retained:true,importedAt:'2026-11-11T18:00:00Z',originalName:'History.pdf'}],importStatus:{clinicalReviewStatus:'pending'},medicationSnapshot:{clinicalReviewStatus:'pending'}};
 const job={id,phn,datasetId:'test',status:'accepted',proposal:{sourceSummary:'LTC Admission Note with history.'},files:[{sha256:'synthetic-hash'}]};const write=()=>writeFile(file,JSON.stringify(job));await write();
 const before=structuredClone(context),receipt=await savedHistoryImport(context,'test',root);assert.equal(receipt.sourceName,'History.pdf');const display=profileDisplay(context,receipt);assert.equal(display.mostStatus,'DNACPR M1');
 setProfileDisplay({patients:{[phn]:display}});const patient={id:'synthetic',phn,name:'Example'};const html=pmhxUploadedHTML(patient,true);assert.match(html,/checked disabled/);assert.match(html,/Automatically recorded from History.pdf/);assert.equal(patient.pmhxUploadedDate,undefined);assert.equal(patient.medReconciliationDate,undefined);assert.deepEqual(context,before);setProfileDisplay(null);
 for(const status of ['queued','processing','saved','held','error']){job.status=status;await write();assert.equal(await savedHistoryImport(context,'test',root),null);}job.status='accepted';
 job.phn='0000000002';await write();assert.equal(await savedHistoryImport(context,'test',root),null);job.phn=phn;job.datasetId='other';await write();assert.equal(await savedHistoryImport(context,'test',root),null);job.datasetId='test';
 job.files=[];await write();assert.equal(await savedHistoryImport(context,'test',root),null);
 }finally{setProfileDisplay(null);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,force:true});}
});
test('MOST changed-from history is distinct from unresolved current designations',()=>{
 assert.equal(profileDisplay({summaryMarkdown:'MOST DNR M1, carried from hospital (changed from DNR M2 during the admission).'}).mostStatus,'DNACPR M1');
 assert.equal(profileDisplay({summaryMarkdown:'MOST DNR M1. MOST DNR M2, reconciliation pending.'}).mostStatus,'');
});
