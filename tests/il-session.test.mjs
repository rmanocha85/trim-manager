import test from 'node:test';
import assert from 'node:assert/strict';
import {FacilityRosterSession,rosterFileId,pleasantviewFileId,sitePatients} from '../public/il-data.mjs';

function fixture() {
  const files = new Map([
    [rosterFileId,{version:1,roster:{schemaVersion:1,sites:Object.fromEntries(['carrington','cedarbrook','the-cedars'].map((site,i)=>[site,{patients:[{name:'Synthetic '+site,ava:'12345'+i,phn:null,dob:null}]}]))}}],
    [pleasantviewFileId,{version:1,roster:{schemaVersion:1,groups:{pleasantview_rc:{patients:[{name:'Synthetic RC',emrNumber:'223456',phn:null,dob:null}]},pleasantview_al:{patients:[]}}}}]
  ]);
  const calls=[];
  let failRead=false, failReadback=false, beforeRead;
  const adapter={mode:'cloud',accountEmail:'first@example.test',ensureConnected:async()=>{},request:async(url,options={})=>{
    const u=new URL(url),id=u.pathname.split('/').at(-1),file=files.get(id);
    calls.push({id,method:options.method||'GET',media:u.searchParams.get('alt')==='media'});
    if(options.method==='PUT') {
      if(options.headers['If-Match']!==`"v${file.version}"`) throw Object.assign(new Error('Drive changed elsewhere.'),{status:409});
      file.roster=JSON.parse(options.body);file.version++;
      if(failReadback)failRead=true;
      return {id};
    }
    await beforeRead?.();
    if(failRead)throw Object.assign(new Error('Temporary read failure'),{status:503});
    return u.searchParams.get('alt')==='media'?structuredClone(file.roster):{id,etag:`"v${file.version}"`};
  }};
  let active=adapter;
  return {files,calls,adapter,session:new FacilityRosterSession(()=>active),use:value=>{active=value;},fail:value=>{failRead=value;},failReadback:()=>{failReadback=true;},beforeRead:fn=>{beforeRead=fn;}};
}

test('three facility tabs share one verified read, including simultaneous first opens',async()=>{
  const f=fixture();
  const [a,b,c]=await Promise.all(['carrington','cedarbrook','the-cedars'].map(site=>f.session.load(site)));
  assert.equal(a,b);assert.equal(b,c);assert.equal(f.calls.length,3);
  assert.equal(sitePatients(b.roster,'cedarbrook')[0].name,'Synthetic cedarbrook');
  await f.session.load('carrington');assert.equal(f.calls.length,3);
  const pv=await f.session.load('pleasantview');assert.notEqual(pv,a);
  await f.session.load('pleasantview');assert.equal(f.calls.length,6);
});

test('refresh replaces the shared snapshot and failed refresh cannot become a cached success',async()=>{
  const f=fixture(),first=await f.session.load('carrington');
  f.files.get(rosterFileId).roster.sites.cedarbrook.patients[0].name='Synthetic remote change';
  f.files.get(rosterFileId).version++;
  assert.equal(await f.session.load('cedarbrook'),first);
  const next=await f.session.load('the-cedars',{refresh:true});
  assert.equal((await f.session.load('cedarbrook')).roster.sites.cedarbrook.patients[0].name,'Synthetic remote change');
  assert.notEqual(first,next);assert.equal(f.calls.length,6);
  f.fail(true);await assert.rejects(f.session.load('carrington',{refresh:true}),/Temporary read failure/);
  f.fail(false);await f.session.load('cedarbrook');assert.equal(f.calls.length,10);
});

test('verified additions and removals update all tabs, while form errors preserve the snapshot',async()=>{
  const f=fixture(),first=await f.session.load('carrington');
  await assert.rejects(f.session.save(first,'carrington',{type:'add',patient:{name:'Duplicate',ava:'123450'}}),/already on this site/);
  assert.equal(await f.session.load('carrington'),first);assert.equal(f.calls.length,3);
  const added=await f.session.save(first,'carrington',{type:'add',patient:{name:'Synthetic Added',ava:'334455'}});
  assert.equal(f.calls.length,7);assert.equal(added.etag,'"v2"');
  assert.equal(await f.session.load('cedarbrook'),added);
  assert.equal((await f.session.load('carrington')).roster.sites.carrington.patients.length,2);
  const removed=await f.session.save(added,'carrington',{type:'remove',ava:'334455',group:'carrington'});
  assert.equal((await f.session.load('the-cedars')).etag,removed.etag);
  assert.equal((await f.session.load('carrington')).roster.sites.carrington.patients.length,1);
  assert.equal(f.calls.length,11);
});

test('stale cached saves preserve another computer’s changes and require a reload',async()=>{
  const f=fixture(),snapshot=await f.session.load('carrington'),file=f.files.get(rosterFileId);
  file.roster.sites.cedarbrook.patients[0].name='Synthetic newer version';file.version++;
  await assert.rejects(f.session.save(snapshot,'carrington',{type:'add',patient:{name:'Synthetic Added',ava:'334455'}}),error=>error.status===409&&error.reloadRequired);
  assert.equal(file.roster.sites.carrington.patients.length,1);
  const fresh=await f.session.load('cedarbrook');
  assert.equal(fresh.roster.sites.cedarbrook.patients[0].name,'Synthetic newer version');
  await assert.rejects(f.session.save(snapshot,'carrington',{type:'add',patient:{name:'Synthetic Added',ava:'334455'}}),/Reload the roster/);
});

test('an unverified write is not cached and a reload reveals its actual result',async()=>{
  const f=fixture(),snapshot=await f.session.load('carrington');f.failReadback();
  await assert.rejects(f.session.save(snapshot,'carrington',{type:'add',patient:{name:'Synthetic Added',ava:'334455'}}),error=>error.reloadRequired);
  f.fail(false);
  const fresh=await f.session.load('carrington');
  assert.equal(fresh.roster.sites.carrington.patients.length,2);
  assert.equal(fresh.etag,'"v2"');
});

test('connection and account changes discard memory, including late reads from an old connection',async()=>{
  const f=fixture();await f.session.load('carrington');
  f.adapter.accountEmail='second@example.test';await f.session.load('carrington');assert.equal(f.calls.length,6);
  f.use(null);await assert.rejects(f.session.load('carrington'),/Connect patient records/);
  f.use(f.adapter);await f.session.load('carrington');assert.equal(f.calls.length,9);
  f.session.clear();await f.session.load('carrington');assert.equal(f.calls.length,12);
  let release;const hold=new Promise(resolve=>{release=resolve;});f.beforeRead(()=>hold);
  const old=f.session.load('carrington',{refresh:true});
  const other=fixture();f.use(other.adapter);await f.session.load('carrington');
  release();await assert.rejects(old,/Connection changed/);
  await f.session.load('cedarbrook');assert.equal(other.calls.length,3);
});
