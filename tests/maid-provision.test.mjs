import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {applyMaidAction,validateClinicRoster,MaidRepository} from '../public/clinic-roster-repository.mjs';
import {provisionDefaults,provisionPlanningText,provisionMapUrl} from '../public/maid-provision.mjs';
import {MaidStore} from '../maid-storage.mjs';
const sample=()=>({schemaVersion:1,patients:[{id:'one',name:'Synthetic',status:'history',assessmentDate:'2026-11-11',forms:{'1634':{completedDate:'2026-11-11'}},contacts:[{role:'Patient',phone:'604-555-0101'}],currentLocation:{label:'Home',address:'10 Test Ave, Test City',source:'Synthetic referral',verified_date:'2026-11-12'}},{id:'two',name:'Other',status:'active'}]});
const action={type:'provision-planning',patientId:'one',schedule:{date:'2026-11-25',time:'13:00',location:'Home',address:'20 Example Ave, Test City',source:'Synthetic physician confirmation'}};

test('confirmed scheduling activates reviewed case without changing actual assessment, location or closeout',()=>{
 const old=sample(),next=applyMaidAction(old,action);const p=next.patients[0];
 for(const key of ['forms','contacts','assessmentDate','currentLocation'])assert.deepEqual(p[key],old.patients[0][key]);assert.deepEqual(next.patients[1],old.patients[1]);
 assert.equal(p.status,'active');assert.equal(p.statusHistory.length,1);assert.equal(p.provisionDate,undefined);assert.equal(p.postProvision,undefined);assert.equal(p.plannedProvision.timeZone,'America/Vancouver');
 assert.equal(provisionPlanningText(p).label,'Wed, NOV 25, 2026 · 1:00 PM');
 const rescheduled=applyMaidAction(next,{...action,schedule:{date:'2026-11-26',source:'New date; other details unchanged'}});
 assert.equal(rescheduled.patients[0].plannedProvision.address,action.schedule.address);assert.equal(rescheduled.patients[0].plannedProvision.time,'13:00');assert.equal(rescheduled.patients[0].statusHistory.length,1);
 assert.throws(()=>applyMaidAction(next,{...action,schedule:{location:'Different hospice',source:'Venue changed'}}),/full address/);
 const cancelled=applyMaidAction(rescheduled,{type:'provision-planning',patientId:'one',cancel:true,source:'Physician cancellation'});
 assert.equal(provisionPlanningText(cancelled.patients[0]).label,'Cancelled');assert.equal(cancelled.patients[0].status,'active');assert.equal(cancelled.patients[0].assessmentDate,old.patients[0].assessmentDate);
 assert.throws(()=>applyMaidAction(cancelled,{...action,schedule:{time:'14:00',source:'No new date'}}),/new date/);
 assert.equal(applyMaidAction(cancelled,action).patients[0].plannedProvision.status,'scheduled');
});

test('new provision writes require real dates, 24-hour time, venue, address and source; legacy reads remain available',()=>{
 for(const [key,value] of [['date','2026-02-30'],['date',null],['time','25:00'],['time','1pm'],['address',' '],['location',''],['source','']])assert.throws(()=>applyMaidAction(sample(),{...action,schedule:{...action.schedule,[key]:value}}));
 const legacy=sample();legacy.patients[0].plannedProvision={date:'2026-11-25',time:'13:00',timezone:'America/Vancouver',location:'Home',source:'Legacy booking'};
 assert.doesNotThrow(()=>validateClinicRoster(legacy));assert.equal(provisionPlanningText(legacy.patients[0]).incomplete,true);
 const next=applyMaidAction(legacy,{...action,schedule:{address:'10 Test Ave',source:'Verified address'}});assert.equal(next.patients[0].plannedProvision.timeZone,'America/Vancouver');assert.equal(next.patients[0].plannedProvision.timezone,undefined);
 assert.throws(()=>applyMaidAction(sample(),{type:'update',patientId:'one',changes:{plannedProvision:{...action.schedule,status:'scheduled',timeZone:'America/Vancouver',address:''}}}));
 const actual=sample();actual.patients[0].provisionDate='2026-11-12';assert.throws(()=>applyMaidAction(actual,action),/Actual provision/);
});

test('address prefills use verified current location without mixing venues; Maps uses only the encoded address',()=>{
 const p=sample().patients[0];assert.equal(provisionDefaults(p).address,'10 Test Ave, Test City');
 assert.equal(provisionDefaults({...p,currentLocation:{...p.currentLocation,source:null}}).address,'');
 assert.equal(provisionDefaults({...p,plannedProvision:{location:'Different hospice'}}).address,'');
 assert.equal(provisionDefaults({...p,plannedProvision:{location:'Different hospice',address:'30 Other St'}}).address,'30 Other St');
 const url=new URL(provisionMapUrl('Suite 2 & 3, 10 Test Ave #4'));assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('query'),'Suite 2 & 3, 10 Test Ave #4');assert.equal(provisionMapUrl(null),null);
 const future=applyMaidAction(sample(),action).patients[0];assert.equal(provisionPlanningText(future,new Date('2026-11-26T06:00:00Z')).past,false);assert.equal(provisionPlanningText(future,new Date('2026-11-26T16:00:00Z')).past,true);assert.equal(future.provisionDate,undefined);
});

test('workflow CLI persists provision fields and stale revisions are rejected',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'maid-provision-')),file=path.join(dir,'roster.json'),request=path.join(dir,'request.json');
 try{
  await writeFile(file,JSON.stringify(sample()));const store=new MaidStore(file),before=await store.load();await writeFile(request,JSON.stringify({expectedEtag:before.etag,action}));
  execFileSync(process.execPath,['scripts/update-maid-roster.mjs','--roster',file,'--request',request],{stdio:'pipe'});
  const saved=await store.load();assert.equal(saved.roster.patients[0].plannedProvision.address,action.schedule.address);assert.equal(saved.roster.patients[0].plannedProvision.time,'13:00');
  await assert.rejects(()=>store.mutate(action,before.etag),e=>e.status===409);assert.deepEqual(JSON.parse(await readFile(file,'utf8')),saved.roster);
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
});

test('cloud scheduling verifies saved data and rejects concurrent stale changes',async()=>{
 let data=sample(),revision=1;const adapter={mode:'cloud',request:async(url,options={})=>{if(url.includes('upload/')){assert.equal(options.headers['If-Match'],'v'+revision);data=JSON.parse(options.body);revision++;return {};}return url.includes('alt=media')?structuredClone(data):{etag:'v'+revision};}};
 const repo=new MaidRepository(adapter),before=await repo.load(),saved=await repo.mutate(action,before);assert.equal(saved.roster.patients[0].plannedProvision.address,action.schedule.address);
 await assert.rejects(()=>repo.mutate({...action,schedule:{...action.schedule,time:'14:00'}},before),e=>e.status===409);assert.equal(data.patients[0].plannedProvision.time,'13:00');
});
