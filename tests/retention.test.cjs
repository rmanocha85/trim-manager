const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const vm=require('node:vm');
const R=require('../roster-core.js');
const patient={id:'synthetic-1',name:'Synthetic Patient',phn:'9000000001',ava:'900001',unit:'cedar',room:'1',codes:'TEST',pFlag:true,extra:{preserve:true}};
const fixture=()=>({patients:[structuredClone(patient)],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[{id:'date',label:'Test',sortKey:20261001}],unrelated:{keep:['all',1]},driveFileId:'synthetic'});
test('old schema, complete retention, idempotence and preservation',()=>{
  const raw=fixture(),r=R.remove(raw,patient.id,'2026-10-05');
  assert.equal(raw.patients.length,1);
  assert.equal(r.patients.length,0);
  assert.deepEqual(r.removedPatients,[{...patient,removedDate:'2026-10-05'}]);
  assert.deepEqual(R.remove(r,patient.id,'2026-10-06'),r);
  assert.deepEqual(r.billingDates,raw.billingDates);assert.deepEqual(r.unrelated,raw.unrelated);
  assert.equal(R.expire(r,'2027-01-04').removedPatients.length,1);
  assert.equal(R.expire(r,'2027-01-05').removedPatients.length,0);
});
test('calendar month clamping, leap years and Pacific midnight/DST',()=>{
  for(const [a,b] of [['2026-01-31','2026-04-30'],['2026-11-30','2027-02-28'],['2023-11-30','2024-02-29'],['2024-02-29','2024-05-29'],['2026-08-31','2026-11-30']])assert.equal(R.expiresOn(a),b);
  assert.equal(R.today(new Date('2026-10-06T06:59:59Z')),'2026-10-05');
  assert.equal(R.today(new Date('2026-10-06T07:00:00Z')),'2026-10-06');
  assert.equal(R.today(new Date('2026-03-08T09:59:59Z')),'2026-03-08');
  assert.throws(()=>R.expiresOn('2026-02-30'));
});
test('reactivation preserves ID, unknown fields and rejects duplicate/conflicting identity',()=>{
  const removed=R.remove(fixture(),patient.id,'2026-10-05');
  const returned=R.add(removed,{...patient,id:'ignore',room:'2'},'2026-10-06');
  assert.equal(returned.patients[0].id,patient.id);assert.equal(returned.patients[0].room,'2');
  assert.deepEqual(returned.patients[0].extra,patient.extra);assert.equal(returned.removedPatients.length,0);
  assert.equal('removedDate' in returned.patients[0],false);
  assert.throws(()=>R.add(returned,patient,'2026-10-06'));
  assert.throws(()=>R.add(removed,{...patient,ava:'999999'},'2026-10-06'));
  assert.throws(()=>R.normalize({...removed,patients:[patient]}));
  assert.throws(()=>R.normalize({...removed,removedPatients:null}));
  const reremoved=R.remove(returned,patient.id,'2026-10-10');
  assert.equal(reremoved.removedPatients[0].removedDate,'2026-10-10');
});
const helperSource=fs.readFileSync(path.join(__dirname,'../scripts/update_trim_roster.ps1'),'utf8');
function harness(t,date='2026-10-05',source=helperSource){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trim-synthetic-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'roster.json'),script=path.join(dir,'helper.ps1');
  fs.writeFileSync(script,source.replace("return [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $zone).ToString('yyyy-MM-dd')",`return '${date}'`));
  const write=x=>fs.writeFileSync(file,JSON.stringify(x));
  const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
  const run=(...args)=>{
    const p=spawnSync('pwsh',['-NoProfile','-File',script,'-JsonPath',file,...args],{encoding:'utf8'});
    assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
  };
  const fail=(...args)=>{const before=fs.readFileSync(file,'utf8');const p=spawnSync('pwsh',['-NoProfile','-File',script,'-JsonPath',file,...args],{encoding:'utf8'});assert.notEqual(p.status,0);assert.equal(fs.readFileSync(file,'utf8'),before);};
  return {file,write,read,run,fail};
}
test('helper removal and app/helper round trips; repeated removal retains original date',t=>{
  const h=harness(t);h.write(fixture());
  h.fail('-Mode','Remove','-MatchPhn',patient.phn);
  h.run('-Mode','Verify','-MatchPhn',patient.phn);assert.equal('removedPatients' in h.read(),false);
  h.run('-Mode','Remove','-MatchPhn',patient.phn,'-ConfirmRemove');
  assert.deepEqual(h.read(),R.remove(fixture(),patient.id,'2026-10-05'));
  h.run('-Mode','Remove','-MatchPhn',patient.phn,'-ConfirmDelete');
  assert.equal(h.read().removedPatients[0].removedDate,'2026-10-05');
  h.run('-Mode','Add','-Name',patient.name,'-Phn',patient.phn,'-Ava',patient.ava,'-Unit','cedar','-Room','2','-Codes','TEST');
  assert.equal(h.read().patients[0].id,patient.id);assert.deepEqual(h.read().patients[0].extra,patient.extra);
  assert.equal(h.read().removedPatients.length,0);
  h.write(R.remove(h.read(),patient.id,'2026-10-04'));
  h.run('-Mode','Remove','-MatchAva',patient.ava,'-ConfirmRemove');
  assert.equal(h.read().removedPatients[0].removedDate,'2026-10-04');
  h.fail('-Mode','Add','-Name',patient.name,'-Phn',patient.phn,'-Ava','999999','-Unit','cedar','-Room','2','-Codes','TEST');
});
test('helper expiry, month end, read-only verify and repeat maintenance',t=>{
  const h=harness(t,'2027-02-28');
  const r=R.remove(fixture(),patient.id,'2026-11-30');
  h.write(r);h.run('-Mode','Maintain');
  assert.deepEqual(h.read(),R.expire(r,'2027-02-28'));
  assert.equal(h.run('-Mode','Maintain').Changed,false);
  h.write(fixture());h.run('-Mode','Maintain');assert.equal(h.read().patients.length,1);assert.deepEqual(h.read().removedPatients,[]);
  h.write({...fixture(),removedPatients:[{...patient,id:'other',phn:'9000000002',ava:'900002',removedDate:'2026-01-31'}]});
  h.run('-Mode','Verify','-MatchPhn',patient.phn);assert.equal(h.read().removedPatients.length,1);
  h.run('-Mode','Edit','-MatchPhn',patient.phn,'-Room','3');assert.equal(h.read().removedPatients.length,0);
});
test('helper blocks duplicate identities and malformed removal dates',t=>{
  const h=harness(t);h.write({...fixture(),removedPatients:[{...patient,removedDate:'2026-10-01'}]});h.fail('-Mode','Maintain');
  h.write({...fixture(),removedPatients:[{...patient,id:'other',phn:'9000000002',ava:'900002',removedDate:'2026-02-30'}]});h.fail('-Mode','Maintain');
});
test('helper detects a competing file write before replacement',t=>{
  const source=helperSource.replace('Assert-RosterSchema $roundTrip',`Assert-RosterSchema $roundTrip
        [System.IO.File]::WriteAllText($resolvedJsonPath, '{"competing":"write"}')`);
  const h=harness(t,'2026-10-05',source);h.write(fixture());
  const p=spawnSync('pwsh',['-NoProfile','-File',path.join(path.dirname(h.file),'helper.ps1'),'-JsonPath',h.file,'-Mode','Maintain'],{encoding:'utf8'});
  assert.notEqual(p.status,0);assert.deepEqual(h.read(),{competing:'write'});
});
test('expiry cannot rewrite independent saved billing identity or charges',async()=>{
  const B=await import('../billing/core.mjs');
  const key=B.patientKey(patient),ledger={patients:{[key]:{...patient,key}},entries:[{patientKey:key,code:'synthetic'}],pendingCharges:[{patientKey:key}],provenance:{source:'synthetic'}};
  const before=structuredClone(ledger);
  const expired=R.expire(R.remove(fixture(),patient.id,'2026-10-05'),'2027-01-05');
  const returned=R.add(expired,patient,'2027-01-06',()=> 'new-roster-id');
  assert.equal(B.patientKey(returned.patients[0]),key);assert.deepEqual(ledger,before);
  assert.equal(B.normalizeRoster(expired).patients.length,0);
});

function appHarness(){
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,style:{},classList:{add(){},remove(){}},textContent:'',innerHTML:''});return elements.get(id);};
  const alerts=[];
  const ctx=vm.createContext({TrimRoster:R,structuredClone,Date,console,crypto:require('node:crypto').webcrypto,setTimeout,alert:x=>alerts.push(x),localStorage:{removeItem(){}},document:{addEventListener(){},getElementById:element,body:{classList:{add(){},remove(){}}},querySelectorAll:()=>[],title:''}});
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/init\(\);\s*$/,'');
  vm.runInContext(script,ctx);
  const run=code=>vm.runInContext(code,ctx);
  ctx.fixture=fixture();run("applyRoster(fixture);state.googleConnected=true;state.googleToken='synthetic';driveEtag='revision1';maybeSaveDailySnapshot=async()=>{};");
  return {ctx,run,alerts,element};
}
test('app serializes saves, uses conditional roster-only writes and preserves unknown fields',async()=>{
  const h=appHarness();let disk=fixture(),rev=1;const writes=[];
  h.ctx.fetch=async(url,opts)=>{
    assert.ok(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'));assert.equal(url.includes('billing'),false);
    if(opts.method==='PUT'){assert.equal(opts.headers['If-Match'],'revision'+rev);disk=JSON.parse(opts.body);writes.push(disk);rev++;return {ok:true,json:async()=>({})};}
    return {ok:true,json:async()=>url.includes('alt=media')?structuredClone(disk):{etag:'revision'+rev}};
  };
  h.run("applyRoster(TrimRoster.remove(currentRoster(),'synthetic-1'));saveDrive();state.billingDates.push({id:'second'});saveDrive();");
  await h.run('saveQueue');assert.equal(writes.length,2);assert.deepEqual(disk.unrelated,fixture().unrelated);assert.equal(disk.removedPatients.length,1);assert.equal(disk.billingDates.length,2);
});
test('app stale revision locks writes, does not create a replacement, refuses historical saves',async()=>{
  const h=appHarness();let calls=0;
  h.ctx.fetch=async()=>{calls++;return {ok:false,status:412};};
  assert.equal(await h.run('saveDrive()'),false);assert.equal(h.run('writeBlocked'),true);assert.equal(calls,1);
  assert.equal(await h.run('saveDrive()'),false);assert.equal(calls,1);
  h.run('writeBlocked=false;inHistoryView=true;');assert.equal(await h.run('saveDrive()'),false);assert.equal(calls,1);
});
test('app load expires retained records with verified save; active counts and prints exclude retained',async()=>{
  const h=appHarness();let disk=R.remove(fixture(),patient.id,'2020-01-31'),rev=1,writes=0;
  h.ctx.fetch=async(url,opts)=>{
    if(opts.method==='PUT'){writes++;disk=JSON.parse(opts.body);rev++;return {ok:true,json:async()=>({})};}
    return {ok:true,json:async()=>url.includes('alt=media')?structuredClone(disk):{etag:'r'+rev}};
  };
  assert.equal(await h.run('loadDrive()'),true);assert.equal(disk.removedPatients.length,0);assert.equal(writes,1);
  h.ctx.retained=R.remove(fixture(),patient.id,R.today());h.run('applyRoster(retained);renderStats();buildTrimList();buildTrimBilling();renderRemoved();');
  assert.equal(h.element('print-trim').innerHTML.includes(patient.name),false);
  assert.equal(h.element('print-billing').innerHTML.includes(patient.name),false);
  assert.equal(h.element('removed-list').innerHTML.includes(patient.name),true);
  assert.match(h.element('stats').innerHTML,/>0</);
});
