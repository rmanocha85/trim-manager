import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat,access,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {importPatientContext} from '../scripts/import-patient-context.mjs';
import os from 'node:os';
import path from 'node:path';
import {LocalNotesStore} from '../notes-local.mjs';
import {contextRecord,clinicalRecords,generationInput} from '../public/notes-core.mjs';
const key='phn:0000000001',second='phn:0000000002';
const record=k=>({patient:{key:k,phn:k.slice(4),name:'Synthetic'},summaryMarkdown:'Background',medicationSnapshot:{sourceDate:'2026-01-01',scheduled:['Test drug held'],prn:[],caveats:['Not reconciled'],clinicalReviewStatus:'pending'},custom:{preserve:true}});
async function fixture(fn){
  const root=await mkdtemp(path.join(os.tmpdir(),'trim-patient-files-'));
  try{await fn(root,new LocalNotesStore(root,path.join(root,'locks')));}finally{await rm(root,{recursive:true,force:true});}
}
test('legacy context migrates losslessly to PHN files; backup and index contain the correct identities',()=>fixture(async(root,store)=>{
  const data=contextRecord('synthetic');data.patients[key]=record(key);data.patients[second]=record(second);
  const raw=JSON.stringify(data);await writeFile(path.join(root,'patient-context.json'),raw);
  const old=await store.load('patient-context.json'),saved=await store.save('patient-context.json',data,old.etag);
  assert.deepEqual(saved.data,data);await assert.rejects(access(path.join(root,'patient-context.json')));
  assert.equal(await readFile(path.join(root,'archive',`patient-context-${old.etag}.json`),'utf8'),raw);
  const index=JSON.parse(await readFile(path.join(root,'index.json')));
  assert.equal(index.patients[key].path,'patients/0000000001.json');
  assert.ok(!JSON.stringify(index).includes('Background'));
  const unchanged=await stat(path.join(root,'patients','0000000002.json'));
  data.patients[key].summaryMarkdown='Updated';await store.save('patient-context.json',data,saved.etag);
  assert.equal((await stat(path.join(root,'patients','0000000002.json'))).mtimeMs,unchanged.mtimeMs);
  await assert.rejects(store.save('patient-context.json',old.data,old.etag),/changed/);
}));
test('identity mismatch, missing indexed file and patient removal cannot erase records',()=>fixture(async(root,store)=>{
  const data=contextRecord('synthetic');data.patients[key]=record(key);
  const saved=await store.save('patient-context.json',data,'new');
  const mismatch=structuredClone(data);mismatch.patients[key].patient.phn='0000000002';
  await assert.rejects(store.save('patient-context.json',mismatch,saved.etag),/identity/);
  await assert.rejects(store.save('patient-context.json',contextRecord('synthetic'),saved.etag),/missing/);
  await rm(path.join(root,'patients','0000000001.json'));
  await assert.rejects(store.load('patient-context.json'),/Missing/);
}));
test('interrupted transaction is replayed and checked before returning records',()=>fixture(async(root,store)=>{
  const data=contextRecord('synthetic');data.patients[key]=record(key);
  await store.save('patient-context.json',data,'new');
  const filename='patients/0000000001.json',before=await store.load(filename),changed=structuredClone(before.data);
  changed.context.summaryMarkdown='Recovered transaction';
  await writeFile(path.join(root,'.context-transaction.json'),JSON.stringify({changes:[{name:filename,before:before.etag,data:changed}]}));
  assert.equal((await store.load('patient-context.json')).data.patients[key].summaryMarkdown,'Recovered transaction');
  await assert.rejects(access(path.join(root,'.context-transaction.json')));
}));
test('external patient edits invalidate stale browser etags; conflicting recovery stops',()=>fixture(async(root,store)=>{
  const data=contextRecord('synthetic');data.patients[key]=record(key);
  const saved=await store.save('patient-context.json',data,'new'),filename='patients/0000000001.json',before=await store.load(filename),external=structuredClone(before.data);
  external.context.summaryMarkdown='External import';await writeFile(path.join(root,filename),JSON.stringify(external));
  data.patients[key].summaryMarkdown='Stale browser';
  await assert.rejects(store.save('patient-context.json',data,saved.etag),/changed/);
  await writeFile(path.join(root,'.context-transaction.json'),JSON.stringify({changes:[{name:filename,before:before.etag,data:before.data}]}));
  await assert.rejects(store.load('patient-context.json'),/interrupted save/);
}));
test('AI receives dated medication changes and lab context without identity or source paths',()=>{
  const c=record(key);c.medicationSnapshot.sourceWorkingRecord='private/path';c.medicationSnapshot.documentedChanges=['Stop test drug'];c.labs=[{date:'2026-01-01',results:['Synthetic result']}];
  const output=clinicalRecords(c);
  assert.deepEqual(output.medications[0].documentedChanges,['Stop test drug']);
  assert.equal(output.medications[0].reviewStatus,'pending');
  assert.ok(!JSON.stringify(output).includes('private/path'));assert.ok(!JSON.stringify(output).includes('0000000001'));
  assert.throws(()=>generationInput({confirmed:true,patient:c.patient},{patients:{[key]:c}},'2025-12-31'),/later source/);
});
test('import matches PHN, preserves existing context and removes only verified incoming copies; retry is idempotent',()=>fixture(async(root,store)=>{
  const data=contextRecord('synthetic');data.patients[second]=record(second);await store.save('patient-context.json',data,'new');
  const rosterPath=path.join(root,'roster.json'),preparedPath=path.join(root,'prepared.json'),raw='synthetic source only',sha256=createHash('sha256').update(raw).digest('hex');
  await writeFile(rosterPath,JSON.stringify({patients:[key,second].map((k,i)=>({id:String(i),phn:k.slice(4),name:'Synthetic',unit:'test'})),units:[]}));
  await mkdir(path.join(root,'Incoming'));await writeFile(path.join(root,'Incoming','test.pdf'),raw);await writeFile(path.join(root,'Incoming','unmatched.png'),'keep');
  await writeFile(preparedPath,JSON.stringify([{phn:key.slice(4),summaryMarkdown:'Source-derived summary',medicationSnapshot:{sourceDate:'2026-01-01',scheduled:['Test held'],prn:[]},sources:[{originalName:'test.pdf',sha256,path:`sources/${sha256}.pdf`}]}]));
  const args={root,rosterPath,preparedPath,datasetId:'synthetic'};
  assert.equal((await importPatientContext(args)).updatedPatients,1);await access(path.join(root,'Incoming','test.pdf'));
  const result=await importPatientContext({...args,commit:true});assert.equal(result.verified,true);
  await assert.rejects(access(path.join(root,'Incoming','test.pdf')));assert.equal(await readFile(path.join(root,'sources',sha256+'.pdf'),'utf8'),raw);
  assert.equal(await readFile(path.join(root,'Incoming','unmatched.png'),'utf8'),'keep');
  const saved=(await store.load('patient-context.json')).data;assert.deepEqual(saved.patients[second],data.patients[second]);assert.equal(saved.patients[key].importStatus.clinicalReviewStatus,'pending');
  assert.equal((await importPatientContext({...args,commit:true})).updatedPatients,0);
}));
