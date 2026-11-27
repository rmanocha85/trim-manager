import test from 'node:test';import assert from 'node:assert/strict';
import {applyOatAction,OatRepository,validateOatRoster} from '../public/oat-roster-repository.mjs';
const roster=clinic=>({schemaVersion:1,clinic,patients:[{id:'one',name:'Example, Alex',phn:'0000000001',dob:'1980-01-01',alternatePhns:[{phn:'0000000009'}],ava:null,phone:'604-555-0101',status:'history',avaRegistration:{status:'sent',messageUrl:'https://example.test/sent'}},{id:'two',name:'Sample, Robin',phn:'0000000002',ava:'1234568',status:'active'}],clinicDays:[{date:'2026-11-27',appointments:[{id:'a',time:'09:00',patientId:'one',sourcePhn:'0000000009',finished:true}]}]});
const action=(r,ava)=>({type:'patient-ava',clinic:r.clinic,patientId:'one',expectedPhn:r.patients[0].phn,expectedAva:String(r.patients[0].ava||''),expectedAvaHistory:JSON.stringify(r.patients[0].avaHistory||[]),ava});
for(const clinic of ['oat-fh','oat-purple'])test(clinic+' adds and edits Ava on the same record while retaining identifiers, appointments and receipts',()=>{
  const original=roster(clinic),added=validateOatRoster(applyOatAction(original,action(original,'1234567')),clinic),edited=validateOatRoster(applyOatAction(added,action(added,'7654321')),clinic);
  assert.equal(original.patients[0].ava,null);assert.equal(edited.patients.length,2);assert.equal(edited.patients[0].ava,'7654321');
  for(const key of ['id','phn','dob','alternatePhns','phone','status','avaRegistration'])assert.deepEqual(edited.patients[0][key],original.patients[0][key]);
  assert.deepEqual(edited.patients[1],original.patients[1]);assert.deepEqual(edited.clinicDays,original.clinicDays);
  assert.deepEqual(edited.patients[0].avaHistory.map(h=>[h.from,h.to]),[[null,'1234567'],['1234567','7654321']]);
  assert.deepEqual(applyOatAction(edited,action(edited,'7654321')),edited,'Saving the same value does not add audit entries');
});
test('invalid, duplicate, wrong-clinic and stale Ava changes fail before writing',()=>{
  const r=roster('oat-fh');
  for(const value of ['',null,1234567,'12345','12345678901','123.456','1e23456','https://avaemr.ca/patients/1234567'])assert.throws(()=>applyOatAction(r,action(r,value)),/6–10 digits/);
  assert.throws(()=>applyOatAction(r,action(r,'1234568')),/already assigned/);
  const number=structuredClone(r);number.patients[1].ava=1234568;assert.throws(()=>applyOatAction(number,action(number,'1234568')),/already assigned/);
  assert.throws(()=>applyOatAction(r,{...action(r,'1234567'),clinic:'oat-purple'}),/6–10 digits/);
  for(const changes of [{patientId:'missing'},{expectedPhn:'0000000008'},{expectedAva:'7654321'},{expectedAvaHistory:'wrong'}])assert.throws(()=>applyOatAction(r,{...action(r,'1234567'),...changes}),e=>e.status===409);
  const first=applyOatAction(r,action(r,'1234567')),pending=action(first,'1234570'),second=applyOatAction(first,action(first,'7654321')),back=applyOatAction(second,action(second,'1234567'));
  assert.throws(()=>applyOatAction(back,pending),e=>e.status===409,'A number changed away and back still invalidates an older editor');
  const phone=structuredClone(first);phone.patients[0].phone='604-555-0199';assert.equal(applyOatAction(phone,pending).patients[0].phone,'604-555-0199');
});
for(const clinic of ['oat-fh','oat-purple'])test(clinic+' saves Ava to the linked cloud JSON, verifies readback, and rejects a stale second device',async()=>{
  let data=roster(clinic),version=1,writes=0,corrupt=false;
  const adapter={mode:'cloud',request:async(url,options)=>{
    assert.ok(url.includes('/'+clinic+'-synthetic?'));
    if(options?.method==='PUT'){assert.equal(options.headers['If-Match'],String(version));data=JSON.parse(options.body);writes++;version++;if(corrupt)data.patients[0].ava='1234999';return {};}
    return url.includes('alt=media')?structuredClone(data):{etag:String(version)};
  }};
  const device=()=>{const repo=new OatRepository(adapter,clinic);repo.fileId=clinic+'-synthetic';return repo;};
  const old=action(data,'1234567'),saved=await device().save(old);assert.equal(saved.roster.patients[0].ava,'1234567');assert.deepEqual((await device().load()).roster,saved.roster);
  await assert.rejects(()=>device().save(old),e=>e.status===409);assert.equal(writes,1);
  await assert.rejects(()=>device().save(action(data,'1234568')),/already assigned/);assert.equal(writes,1);
  corrupt=true;await assert.rejects(()=>device().save(action(data,'7654321')),/could not be verified/);
});
