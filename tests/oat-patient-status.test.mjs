import test from 'node:test';
import assert from 'node:assert/strict';
import {oatStatusAction,oatStatusVersion,oatStatusDate,oatPatientMatches} from '../public/oat-patient-status.mjs';
import {applyOatAction,validateOatRoster,OatRepository} from '../public/oat-roster-repository.mjs';
import {panelSource,reconcilePanel} from '../scripts/oat-panel.mjs';
const roster=clinic=>({schemaVersion:1,clinic,patients:[
  {id:'one',name:'Example, Alex',phn:'0000000001',ava:'1234567',dob:'1980-01-01',phone:'604-555-0101',status:'history',statusHistory:[{from:'active',to:'history',date:'2026-11-17',source:'earlier.csv'}]},
  {id:'two',name:'Sample, Robin',phn:'0000000002',ava:'1234568',dob:'1981-01-01',status:'active'}
],clinicDays:[{date:'2026-11-13',appointments:[{id:'visit',patientId:'one',time:'09:00',finished:true}]}]});
const action=(r,status,options={})=>oatStatusAction(r.patients[0],r.clinic,status,{at:'2026-11-28T04:00:00Z',...options});
for(const clinic of ['oat-fh','oat-purple'])test(clinic+' reactivation and Undo retain the same identity, current phone and visits',()=>{
  const original=roster(clinic),move=action(original,'active'),next=validateOatRoster(applyOatAction(original,move),clinic);
  assert.equal(next.patients.length,2);assert.equal(next.patients[0].status,'active');assert.equal(next.patients[0].statusOverride.status,'active');
  assert.equal(oatStatusDate(next.patients[0]),'2026-11-27');assert.equal(original.patients[0].status,'history');
  for(const key of ['id','phn','ava','dob','name','phone'])assert.equal(next.patients[0][key],original.patients[0][key]);
  assert.deepEqual(next.clinicDays,original.clinicDays);assert.deepEqual(next.patients[1],original.patients[1]);
  const phone=applyOatAction(next,{type:'patient-phone',patientId:'one',expectedPhone:'604-555-0101',phone:'604-555-0199'});
  const undone=applyOatAction(phone,action(next,'history',{undoOf:move.id}));
  assert.equal(undone.patients[0].phone,'604-555-0199');assert.equal(undone.patients[0].status,'history');assert.equal(undone.patients[0].statusOverride,undefined);
  assert.equal(undone.patients[0].statusHistory.at(-1).undoOf,move.id);assert.deepEqual(undone.clinicDays,original.clinicDays);
});
test('wrong clinic, stale status, ABA changes and repeated Undo cannot overwrite a newer decision',()=>{
  const r=roster('oat-fh'),move=action(r,'active'),a=applyOatAction(r,move);
  assert.throws(()=>applyOatAction(r,{...move,clinic:'oat-purple'}),/Invalid/);
  assert.throws(()=>applyOatAction(a,move),e=>e.status===409);
  const b=applyOatAction(a,action(a,'history'));
  assert.throws(()=>applyOatAction(b,move),e=>e.status===409);
  assert.throws(()=>applyOatAction(b,action(b,'history',{undoOf:move.id})),e=>e.status===409);
  const undone=applyOatAction(a,action(a,'history',{undoOf:move.id}));
  assert.throws(()=>applyOatAction(undone,action(undone,'active',{undoOf:undone.patients[0].statusHistory.at(-1).id})),e=>e.status===409);
});
for(const clinic of ['oat-fh','oat-purple'])test(clinic+' full exports preserve contrary physician changes and flag review until resolved',()=>{
  const filename=(clinic==='oat-fh'?'OAT FH':'OAT Purple')+'_complete.csv';
  const source=text=>panelSource(Buffer.from('ID,Name,DOB,Phone\n'+text),filename,clinic);
  const absent=source('0000000002,"Sample, Robin",1981-01-01,604-555-0102\n');
  const present=source('0000000001,"Example, Alex",1980-01-01,604-555-0111\n0000000002,"Sample, Robin",1981-01-01,\n');
  const initial=reconcilePanel(roster(clinic),clinic,absent,'2026-11-17');
  const old=initial.patients.find(p=>p.id==='one');
  const manual=applyOatAction(initial,oatStatusAction(old,clinic,'active'));
  assert.deepEqual(reconcilePanel(manual,clinic,absent,'2026-11-17'),manual,'Replaying an already-applied file does nothing');
  const conflicting=reconcilePanel(manual,clinic,absent,'2026-11-28');
  const p=conflicting.patients.find(p=>p.id==='one');assert.equal(p.status,'active');assert.equal(p.statusReview.panelStatus,'history');
  assert.equal(conflicting.patients.find(p=>p.id==='two').phone,'604-555-0102');
  const keep=oatStatusAction(p,clinic,p.status,{review:'keep'}),kept=applyOatAction(conflicting,keep);
  const kp=kept.patients.find(p=>p.id==='one');assert.equal(kp.statusReview,undefined);assert.equal(kp.statusOverride.status,'active');
  const restored=applyOatAction(kept,oatStatusAction(kp,clinic,kp.status,{undoOf:keep.id}));
  const rp=restored.patients.find(p=>p.id==='one');assert.deepEqual(rp.statusReview,p.statusReview);
  const accepted=applyOatAction(restored,oatStatusAction(rp,clinic,'history',{review:'panel'}));
  assert.equal(accepted.patients.find(p=>p.id==='one').statusOverride,undefined);assert.equal(accepted.patients.find(p=>p.id==='one').status,'history');
  const agreed=reconcilePanel(conflicting,clinic,present,'2026-11-29');
  const agreedP=agreed.patients.find(p=>p.id==='one');assert.equal(agreedP.statusOverride,undefined);assert.equal(agreedP.statusReview,undefined);assert.equal(agreedP.phone,'604-555-0111');
  assert.deepEqual(agreed.clinicDays,manual.clinicDays);
  // A physician's manual move to history is protected in the other direction too.
  const archived=applyOatAction(agreed,oatStatusAction(agreedP,clinic,'history'));
  const later=reconcilePanel(archived,clinic,present,'2026-11-30').patients.find(p=>p.id==='one');assert.equal(later.status,'history');assert.equal(later.statusReview.panelStatus,'active');
});
test('search handles given-name-first, surname-first, Ava IDs and formatted PHNs',()=>{
  const p=roster('oat-fh').patients[0];
  for(const q of ['','alex example','Example, Alex','0000-000-001','1234567'])assert.equal(oatPatientMatches(p,q),true,q);
  assert.equal(oatPatientMatches(p,'Robin'),false);assert.equal(oatStatusDate({status:'active'}),'');
  assert.equal(oatPatientMatches({...p,name:'Example, Alex 20',phn:'0000000001'},'Alex 01'),false,'Numeric name fragments must match the name');
  assert.notEqual(oatStatusVersion(p),oatStatusVersion({...p,statusReview:{panelStatus:'active'}}));
});
for(const clinic of ['oat-fh','oat-purple'])test(clinic+' cloud status saves use the existing file, conditional revision and verified readback across devices',async()=>{
  let data=roster(clinic),revision=1,writes=0,deny=false,readbackChanged=false;
  const adapter={mode:'cloud',request:async(url,options)=>{
    assert.ok(url.includes('/'+clinic+'-synthetic?'),'Uses this clinic file only');
    if(options?.method==='PUT'){
      assert.equal(options.headers['If-Match'],String(revision));writes++;
      if(deny)throw Object.assign(new Error('Changed before write'),{status:412});
      data=JSON.parse(options.body);revision++;if(readbackChanged)data.patients[0].phone='604-555-0198';return {};
    }
    return url.includes('alt=media')?structuredClone(data):{etag:String(revision)};
  }};
  const device=()=>{const repo=new OatRepository(adapter,clinic);repo.fileId=clinic+'-synthetic';return repo;};
  const first=device(),move=action(data,'active'),saved=await first.save(move);
  assert.equal(saved.roster.patients[0].status,'active');assert.equal(writes,1);
  assert.deepEqual((await device().load()).roster,saved.roster);
  await assert.rejects(()=>device().save(move),e=>e.status===409);assert.equal(writes,1,'Stale status does not write');
  deny=true;await assert.rejects(()=>device().save(action(data,'history')),e=>e.status===412);assert.equal(data.patients[0].status,'active');
  deny=false;readbackChanged=true;await assert.rejects(()=>device().save(action(data,'history')),/could not be verified/);
});
