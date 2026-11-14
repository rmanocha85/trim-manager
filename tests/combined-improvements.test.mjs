import test from 'node:test';
import assert from 'node:assert/strict';
import {visitList} from '../public/visit-list.mjs';
import {finishAppointment} from '../public/oat-schedule.mjs';
import {OatRepository} from '../public/oat-roster-repository.mjs';
const person=(id,unit,active=false)=>({id,name:id,phn:id==='Active'?'0000000001':id==='ADP'?'0000000002':'0000000003',unit,room:'101',activeIssue:active?{status:'active',description:'Reassess'}:undefined});
test('phone list includes Active + ADP exactly once, independent of filter; excludes resolved/non-ADP and removed',()=>{
 const r={patients:[person('Active','cedar',true),person('ADP','day'),person('Neither','cedar')],otherPatients:[person('Active','day',true)],removedPatients:[person('Removed','day',true)],units:[{id:'day',name:'ADP'},{id:'cedar',name:'Cedar'}]};
 const list=visitList(r);assert.equal(list.rows.length,2);assert.equal(list.rows[0].name,'Active');assert.match(list.text,/Reassess/);assert.match(list.text,/Cedar · room 101/);assert.doesNotMatch(list.text,/0000000001|Neither|Removed/);assert.equal(visitList(r,'otherPatients').rows.length,1);assert.equal(visitList(r,'patients').rows.length,2);
});
const sample=()=>({schemaVersion:1,clinic:'oat-fh',patients:[{id:'p',name:'Synthetic',phn:'0000000001',ava:null,status:'active'}],clinicDays:[{date:'2026-11-13',appointments:[{id:'a',time:'10:00',patientId:'p',note:'Keep'}]},{date:'2026-11-20',appointments:[{id:'a',time:'10:00',patientId:'p'}]}],extra:{keep:true}});
const action={date:'2026-11-13',appointmentId:'a',finished:true,expected:{time:'10:00',patientId:'p',finished:false}};
test('completion is dated, reversible, preserves patient/notes/other days and rejects stale identity/status',()=>{
 const r=sample(),next=finishAppointment(r,action);assert.equal(next.clinicDays[0].appointments[0].finished,true);assert.deepEqual(next.clinicDays[1],r.clinicDays[1]);assert.deepEqual(next.patients,r.patients);assert.deepEqual(next.extra,r.extra);assert.equal(next.clinicDays[0].appointments[0].note,'Keep');assert.equal(r.clinicDays[0].appointments[0].finished,undefined);
 assert.throws(()=>finishAppointment(next,action),/changed elsewhere/);
 assert.throws(()=>finishAppointment(r,{...action,expected:{...action.expected,time:'11:00'}}),/changed elsewhere/);
 assert.equal(finishAppointment(next,{...action,finished:false,expected:{...action.expected,finished:true}}).clinicDays[0].appointments[0].finishedAt,null);
});
test('cloud completion writes current full document with ETag and verifies readback, preserving unrelated updates',async()=>{
 let data=sample(),version=1,puts=0;data.otherUpdate=true;
 const repo=new OatRepository({mode:'cloud',request:async(url,opts)=>{
  if(opts?.method==='PUT'){assert.equal(opts.headers['If-Match'],'v1');data=JSON.parse(opts.body);version++;puts++;return {};}
  if(url.includes('?q='))return {items:[{id:'oat'}]};
  return url.includes('alt=media')?structuredClone(data):{etag:'v'+version};
 }});
 const saved=await repo.finish(action);assert.equal(puts,1);assert.equal(saved.roster.otherUpdate,true);assert.equal(saved.roster.clinicDays[0].appointments[0].finished,true);
 await assert.rejects(()=>repo.finish(action),/changed elsewhere/);assert.equal(puts,1);
});
test('cloud completion rejects conflicting uploads and unverifiable readback',async()=>{
 for(const conflict of [true,false]){
 const repo=new OatRepository({mode:'cloud',request:async(url,opts)=>{
  if(opts?.method==='PUT'){if(conflict)throw Object.assign(new Error('stale'),{status:409});return {};}
  if(url.includes('?q='))return {items:[{id:'oat'}]};
  return url.includes('alt=media')?sample():{etag:'v1'};
 }});
 await assert.rejects(()=>repo.finish(action),conflict?/stale/:/could not be verified/);
 }
});
import {OatStore} from '../oat-storage.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
test('re-import preserves only the same unambiguous finished visit, even if row IDs change',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'oat-reimport-'));
 try{
 const file=path.join(dir,'synthetic.json'),data=finishAppointment(sample(),action);await writeFile(file,JSON.stringify(data));const store=new OatStore(file);
 const result=await store.update((await store.load()).etag,next=>{next.clinicDays[0].appointments=[{id:'another',time:'10:00',patientId:'p'},{id:'later',time:'11:00',patientId:'p'}];return next;});
 assert.equal(result.roster.clinicDays[0].appointments[0].finished,true);assert.equal(result.roster.clinicDays[0].appointments[1].finished,undefined);assert.equal(result.roster.clinicDays[1].appointments[0].finished,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
