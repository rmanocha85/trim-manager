import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {ensurePatientContexts,contextRecord} from '../public/notes-core.mjs';
import {ensureRosterContext} from '../scripts/ensure-roster-context.mjs';
import {blankLedger} from '../public/core.mjs';
const patient={id:'synthetic',name:'SYNTHETIC, Resident',phn:'0000000001',unit:'test',room:'1',codes:'290 V15',ava:'123456'};
test('new intake creates an empty PHN context; returning patients retain all clinical fields',()=>{
  const context=contextRecord('synthetic'),roster={patients:[patient],units:[{id:'test',name:'TEST'}]};
  assert.equal(ensurePatientContexts(context,roster),1);
  const c=context.patients['phn:0000000001'];
  assert.equal(c.patient.name,patient.name);assert.equal(c.summaryMarkdown,'');assert.equal(c.lastReviewed,undefined);assert.equal(c.importStatus,undefined);
  c.summaryMarkdown='Preserve history';c.medicationSnapshot={scheduled:['Synthetic']};c.lastReviewed={text:'Keep reviewed text'};
  const before=structuredClone(context);
  assert.equal(ensurePatientContexts(context,{...roster,patients:[{...patient,id:'returning-id',name:'SYNTHETIC, Corrected name'}]}),0);
  assert.deepEqual(context,before);
  assert.throws(()=>ensurePatientContexts(context,{...roster,patients:[patient,patient]}),/Duplicate/);
  assert.throws(()=>ensurePatientContexts(context,{...roster,patients:[{...patient,phn:''}]}),/valid PHN/);
  assert.deepEqual(context,before);
});
test('skill Add initializes and verifies a real patient file in an isolated folder; retries preserve it',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'trim-intake-'));
  try{
    const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),notesRoot=path.join(dir,'notes');
    await writeFile(rosterPath,JSON.stringify({patients:[],otherPatients:[],removedPatients:[],units:[{id:'test',name:'TEST'}],billingDates:[]}));
    const billing=JSON.stringify(blankLedger('synthetic-intake'));await writeFile(billingPath,billing);
    const result=spawnSync('pwsh',['-NoProfile','-File',path.resolve('scripts/update_trim_roster.ps1'),'-Mode','Add','-JsonPath',rosterPath,'-NotesRoot',notesRoot,'-BillingPath',billingPath,'-Name',patient.name,'-Phn',patient.phn,'-Unit',patient.unit,'-Room',patient.room,'-Codes',patient.codes,'-Ava',patient.ava],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).NotesContext.verified,true);
    const filename=path.join(notesRoot,'patients',patient.phn+'.json'),record=JSON.parse(await readFile(filename));
    assert.equal(record.context.patient.phn,patient.phn);assert.equal(record.context.summaryMarkdown,'');
    record.context.summaryMarkdown='Existing clinical information';await writeFile(filename,JSON.stringify(record));
    const before=await readFile(filename,'utf8'),again=await ensureRosterContext({rosterPath,billingPath,notesRoot});
    assert.equal(again.created,0);assert.equal(await readFile(filename,'utf8'),before);assert.equal(await readFile(billingPath,'utf8'),billing);
  }finally{await rm(dir,{recursive:true,force:true});}
});
