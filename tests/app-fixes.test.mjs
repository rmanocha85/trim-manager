import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveAdapter,preferredDriveAccount} from '../public/adapters.mjs';
import {avaChartUrl} from '../public/patient-links.mjs';
import {rosterPrintPages} from '../public/roster-print.mjs';
import {blankLedger,upsertEntry,entryIssues,calendarDays,validateLedger} from '../public/core.mjs';
import {reportLines} from '../public/reports.mjs';

test('Drive remembers only a successfully opened account and preserves renewal identity',async()=>{
  const originals=Object.fromEntries(['google','fetch','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const storage=new Map(),requests=[];let email='synthetic@example.test',oauthError='',popupError=false,metadataError=false;
  globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  globalThis.google={accounts:{oauth2:{initTokenClient:config=>{
    requests.push(config);
    return {requestAccessToken:()=>popupError?config.error_callback():config.callback(oauthError?{error:oauthError}:{access_token:'synthetic-token'})};
  }}}};
  globalThis.fetch=async(url,options)=>{
    assert.match(url,/\/about\?fields=user\(emailAddress\)$/);
    assert.equal(options.headers.Authorization,'Bearer synthetic-token');
    return {ok:!metadataError,status:metadataError?503:200,json:async()=>({user:{emailAddress:email}})};
  };
  try{
    const first=new DriveAdapter();await first.connect();
    assert.equal(requests.at(-1).prompt,'select_account');assert.equal(requests.at(-1).login_hint,undefined);
    assert.equal(preferredDriveAccount(),''); // Access alone does not certify workspace success.
    first.rememberAccount();assert.equal(preferredDriveAccount(),email);
    assert.deepEqual([...storage.values()],[email]);
    const repeat=new DriveAdapter();await repeat.connect();
    assert.equal(requests.at(-1).login_hint,email);assert.equal(requests.at(-1).prompt,'');
    email='alternate@example.test';
    const alternate=new DriveAdapter();await alternate.connect({selectAccount:true});
    assert.equal(requests.at(-1).prompt,'select_account');assert.equal(requests.at(-1).login_hint,undefined);
    assert.equal(preferredDriveAccount(),'synthetic@example.test');
    alternate.rememberAccount();assert.equal(preferredDriveAccount(),email);
    await assert.rejects(repeat.connect(),/different account/);assert.equal(repeat.token,null);
    email='synthetic@example.test';await repeat.connect();assert.equal(repeat.accountEmail,email);
    metadataError=true;await assert.rejects(repeat.connect(),/Could not verify/);assert.equal(repeat.token,null);
    const noMetadata=new DriveAdapter();await noMetadata.connect();assert.equal(noMetadata.accountEmail,'');
    noMetadata.rememberAccount();assert.equal(preferredDriveAccount(),'');
    metadataError=false;popupError=true;await assert.rejects(new DriveAdapter().connect(),/cancelled or blocked/);
    popupError=false;oauthError='access_denied';await assert.rejects(new DriveAdapter().connect(),/access_denied/);
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Storage disabled');}});
    assert.equal(preferredDriveAccount(),'');first.rememberAccount();
  }finally{
    for(const [k,descriptor] of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];
  }
});

test('Ava links use a validated chart ID only',()=>{
  assert.equal(avaChartUrl({ava:'123456'}),'https://www.avaemr.ca/patients/123456');
  for(const ava of ['',null,'123','12345678901','123456/other','javascript:alert(1)','"><script>'])assert.equal(avaChartUrl({ava}),'');
  assert.equal(avaChartUrl({name:'Synthetic',phn:'0000000001'}),'');
});

test('14077 note is optional for panel and coverage, retained in saved data and escaped in reports',()=>{
  for(const panel of [true,false]){
    const p={id:'synthetic',key:'phn:0000000001',name:'SYNTHETIC',phn:'0000000001',unit:'cedar',codes:'401',panel};
    for(const reason of ['','Synthetic first line\nSecond line <check>']){
      const l=upsertEntry(blankLedger('synthetic-note'),p,'2026-10-19',[{code:'14077',units:1,start:'09:00',end:'09:15',reason,diagnosis:'401'}]);
      assert.deepEqual(entryIssues(l.entries[0],l,p),[]);
      const restored=validateLedger(JSON.parse(JSON.stringify(l)));
      assert.equal(restored.entries[0].items[0].reason,reason);
      if(reason){assert.match(reportLines(restored.entries[0]),/Synthetic first line/);assert.match(reportLines(restored.entries[0]),/&lt;check&gt;/);}
    }
  }
});

test('calendar Sunday columns hold across month and leap-year boundaries',()=>{
  for(const month of ['2026-02','2026-08','2026-10','2024-02','2026-12','2027-01']){
    const days=calendarDays(month);
    for(const [i,date] of days.entries())if(date)assert.equal(new Date(date+'T12:00:00Z').getUTCDay(),i%7,date);
  }
});

test('large rosters print each patient once, splitting oversized units and including custom units',()=>{
  const patients=Array.from({length:173},(_,i)=>({id:String(i),name:`SYNTHETIC ${i}`,unit:i<151?'cedar':i<172?'custom':'unlisted',room:String(173-i)}));
  for(const max of [38,55]){
    const pages=rosterPrintPages([{id:'cedar',name:'CEDAR'},{id:'custom',name:'CUSTOM'}],patients,max);
    const printed=pages.flatMap(p=>p.flatMap(g=>g.patients)).map(p=>p.id);
    assert.equal(printed.length,patients.length);assert.equal(new Set(printed).size,patients.length);
    assert.deepEqual([...printed].sort(),patients.map(p=>p.id).sort());
    assert.ok(pages.some(p=>p.some(g=>g.continued)));
    for(const page of pages)assert.ok(page.reduce((n,g)=>n+1+g.patients.length,0)<=max);
    assert.equal(pages[0][0].patients[0].room,'23');
  }
  assert.deepEqual(rosterPrintPages([],[],38),[]);
});
