// Opt-in acceptance check. Served only by the verification launcher or staged preview.
import {DriveAdapter} from './adapters.mjs';
import {RosterRepository} from './roster-repository.mjs';
import {blankLedger} from './core.mjs';
import {saveRecovery,loadRecovery} from './recovery.mjs';
import {Session} from './session.mjs';
const $=id=>document.getElementById(id),q=new URLSearchParams(location.search),local=['127.0.0.1','localhost'].includes(location.hostname);
let run=q.has('run')?JSON.parse(atob(q.get('run'))):null,adapter;
const status=text=>{$('verify-status').textContent=text;};
function assert(value,message){if(!value)throw new Error(message);}
function allowedRun(value){return value&&/^trim-verification-[a-f0-9-]+$/.test(value.datasetId)&&[value.folder,value.roster,value.billing].every(s=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s));}
function isolate(a){const request=a.request.bind(a);a.request=(url,options)=>{assert(!url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&!url.includes('1BfI4KcduKRm8uvw-xmlWtRLYTqloZyhR'),'Live record target refused.');return request(url,options);};return a;}
async function upload(name,data,folder){const boundary='check_'+crypto.randomUUID(),metadata={name,mimeType:'application/json',parents:[folder]};return adapter.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`});}
$('verify-connect').onclick=async()=>{try{adapter=isolate(new DriveAdapter(run?.billing,{rosterId:run?.roster||'verification-unset'}));await adapter.connect();status('Connected. Ready to verify synthetic records.');$('verify-run').disabled=false;}catch(e){status('Connection needs attention: '+e.message);}};
$('verify-run').onclick=async()=>{ $('verify-run').disabled=true;try{
 if(!run){
   const datasetId='trim-verification-'+crypto.randomUUID();
   const folder=await adapter.request('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'TRIM verification - synthetic only - '+datasetId,mimeType:'application/vnd.google-apps.folder',appProperties:{trimVerification:datasetId}})});
   const roster={patients:[{id:'synthetic',name:'SYNTHETIC, Verification',phn:'0000000001',ava:'123456',unit:'test',room:'before',codes:'401',unknownField:'preserved'}],otherPatients:[],removedPatients:[],units:[{id:'test',name:'TEST'}],billingDates:[],verification:datasetId};
   const a=await upload('synthetic-roster.json',roster,folder.id),b=await upload('synthetic-billing.json',blankLedger(datasetId),folder.id);run={datasetId,folder:folder.id,roster:a.id,billing:b.id};adapter.fileId=b.id;adapter.rosterId=a.id;
 }
 assert(allowedRun(run),'Invalid test run.');
 const meta=await adapter.request(`https://www.googleapis.com/drive/v3/files/${run.folder}?fields=id,name,appProperties`);assert(meta.appProperties?.trimVerification===run.datasetId,'Test folder marker did not match.');
 const repo=new RosterRepository(adapter);repo.folder=run.folder;
 const beforeRoster=await repo.load(),beforeBilling=await adapter.load();
 assert(beforeRoster.roster.verification===run.datasetId&&beforeBilling.ledger.datasetId===run.datasetId,'Synthetic identity mismatch.');
 const step=q.get('step')||'first';
 if(step==='return'){assert(beforeRoster.roster.patients[0].room==='laptop-pass'&&beforeBilling.ledger.settings.parallel===true,'Laptop save has not arrived.');status('PASS: cloud → laptop → cloud saves and read-back verified.');$('verify-cleanup').hidden=false;}
 else {
   if(step==='laptop')assert(beforeRoster.roster.patients[0].room==='cloud-pass'&&beforeBilling.ledger.settings.parallel===false,'Cloud save has not arrived.');
   const roster=structuredClone(beforeRoster.roster),ledger=structuredClone(beforeBilling.ledger);roster.patients[0].room=local?'laptop-pass':'cloud-pass';ledger.settings.parallel=local;
   const key='verification:'+run.datasetId;await saveRecovery(key,{roster,ledger,dirty:true});assert((await loadRecovery(key)).roster.patients[0].room===roster.patients[0].room,'Local recovery did not match.');
   let rosterDirty=true,billingDirty=true;
   const session=new Session([{name:'Patients',state:()=>({dirty:rosterDirty,mode:'cloud'}),save:async()=>{await repo.save(roster,beforeRoster.etag);rosterDirty=false;}},{name:'Billing',state:()=>({dirty:billingDirty,mode:'cloud'}),save:async()=>{await adapter.save(ledger,beforeBilling.etag);billingDirty=false;}}]);await session.save();
   const afterRoster=await repo.load(),afterBilling=await adapter.load();assert(afterRoster.roster.patients[0].room===roster.patients[0].room&&afterRoster.roster.patients[0].unknownField==='preserved'&&afterBilling.ledger.settings.parallel===local,'Saved read-back mismatch.');
   let rejected=false;try{await adapter.save(beforeBilling.ledger,beforeBilling.etag);}catch(e){rejected=e.status===409;}assert(rejected,'A stale billing revision was not rejected.');
   await saveRecovery(key,{dirty:false});status('PASS: '+(local?'laptop':'cloud')+' local draft, Save to Drive, read-back and stale-write protection.');
   const next=$('verify-next');next.hidden=false;next.textContent=local?'Verify laptop save in cloud':'Verify cloud save on laptop';next.href=(local?'https://rmanocha85.github.io/trim-manager/preview/drive-live-check.html':'http://127.0.0.1:4317/drive-live-check.html')+'?step='+(local?'return':'laptop')+'&run='+encodeURIComponent(btoa(JSON.stringify(run)));
 }
 $('verify-result').textContent=JSON.stringify({run,origin:location.origin,step,passed:true},null,2);
}catch(e){status('FAILED: '+e.message);$('verify-result').textContent=run?JSON.stringify({run},null,2):'';$('verify-run').disabled=false;}};
$('verify-cleanup').onclick=async()=>{try{assert(allowedRun(run),'Invalid run.');const f=await adapter.request(`https://www.googleapis.com/drive/v3/files/${run.folder}?fields=appProperties`);assert(f.appProperties?.trimVerification===run.datasetId,'Wrong test folder.');await adapter.request(`https://www.googleapis.com/drive/v3/files/${run.folder}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"trashed":true}'});status('Verified synthetic test folder moved to Trash.');$('verify-cleanup').disabled=true;}catch(e){status(e.message);}};
