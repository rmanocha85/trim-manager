import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {blankLedger,normalizeRoster,planNewPatients,dueState,upsertEntry,validateLedger} from '../billing/core.mjs';
import {routineCandidates,sessionChanges,changedBillCount} from '../billing/workspace.mjs';
import {mergeSession} from '../billing/merge.mjs';
import {VisitCalendar,visitEventDate} from '../billing/adapters.mjs';
const sandbox={};vm.runInNewContext(readFileSync(new URL('../roster-core.js',import.meta.url),'utf8'),sandbox);const manager=sandbox.TrimRoster;
const fields={name:'EXAMPLE, New',phn:'0000000001',ava:'123456',unit:'a',room:'1',codes:'401'};
const raw={patients:[],removedPatients:[],units:[{id:'a',name:'Synthetic unit'}],billingDates:[]};
const added=manager.add(raw,fields,'2026-10-15',()=> 'new');
const roster=normalizeRoster(added),p=roster.patients[0];
const now=Date.parse('2026-10-15T20:00:00Z');
function base(){const l=blankLedger('synthetic');l.settings.trimVisitCalendar={from:'2026-10-01',through:'2027-01-01',dates:['2026-10-15','2026-10-22','2026-10-24'],checkedAt:new Date(now).toISOString()};return l;}
test('true new addition is dated for next real event, without admission or charge',()=>{
 const b=base(),l=planNewPatients(b,roster,'2026-10-15',now);
 assert.equal(p.panelAddedDate,'2026-10-15');assert.equal(p.newPanelPatient,true);
 assert.deepEqual(l.newPatientStarts[p.key],{addedDate:'2026-10-15',firstRoutineDate:'2026-10-22'});
 assert.equal(l.entries.length,0);assert.deepEqual(l.baselines,{});assert.equal(l.routineStarts,undefined);
 assert.equal(dueState(l,p,'2026-10-14').kind,'unknown');assert.equal(dueState(l,p,'2026-10-15').kind,'later');assert.equal(dueState(l,p,'2026-10-22').kind,'due');
 assert.equal(changedBillCount(sessionChanges(b,l)),0);assert.ok(sessionChanges(b,l).some(r=>r.kind==='First routine review'));
 assert.deepEqual(planNewPatients(l,roster,'2026-10-15',now),l);
});
test('legacy, coverage and restored patients are not treated as new',()=>{
 const legacy=normalizeRoster({...raw,patients:[{id:'old',...fields}]});assert.equal(planNewPatients(base(),legacy,'2026-10-15',now).newPatientStarts,undefined);
 const coverage=normalizeRoster({...raw,otherPatients:added.patients});assert.equal(planNewPatients(base(),coverage,'2026-10-15',now).newPatientStarts,undefined);
 const restored=manager.add(manager.remove(added,'new','2026-10-15'),fields,'2026-10-16');
 assert.equal(restored.patients[0].id,'new');assert.equal(restored.patients[0].newPanelPatient,false);
 assert.equal(planNewPatients(base(),normalizeRoster(restored),'2026-10-16',now).newPatientStarts,undefined);
});
test('actual 114 takes precedence and begins two-week countdown',()=>{
 let l=planNewPatients(base(),roster,'2026-10-15',now);
 l=upsertEntry(l,p,'2026-10-15',[{code:'00114',units:1}]);assert.equal(dueState(l,p,'2026-10-16').due,'2026-10-29');
 const existing=upsertEntry(base(),p,'2026-10-10',[{code:'00114',units:1}]);assert.equal(planNewPatients(existing,roster,'2026-10-15',now).newPatientStarts,undefined);
});
test('missing, stale, empty and out-of-range calendars do not guess a date',()=>{
 for(const c of [undefined,{...base().settings.trimVisitCalendar,dates:[]},{...base().settings.trimVisitCalendar,checkedAt:'2026-10-12T20:00:00Z'},{...base().settings.trimVisitCalendar,from:'2026-10-16',dates:['2026-10-22']}]){
  const b=base();b.settings.trimVisitCalendar=c;const l=planNewPatients(b,roster,'2026-10-15',now);
  assert.equal(l.newPatientStarts[p.key].firstRoutineDate,null);assert.equal(dueState(l,p,'2026-10-15').label,'Calendar date needed');assert.equal(routineCandidates(l,[p],'2026-10-15')[0].status,'review');
 }
});
test('refresh updates future plan, preserves already-due plan and never edits billing',()=>{
 const l=planNewPatients(base(),roster,'2026-10-15',now);l.settings.trimVisitCalendar.dates=['2026-10-24'];
 assert.equal(planNewPatients(l,roster,'2026-10-15',now).newPatientStarts[p.key].firstRoutineDate,'2026-10-24');
 assert.equal(planNewPatients(l,roster,'2026-10-23',now).newPatientStarts[p.key].firstRoutineDate,'2026-10-22');
});
test('device merge retains other patients planning and unrelated charges',()=>{
 const b=base(),local=planNewPatients(b,roster,'2026-10-15',now),other={...p,id:'other',key:'phn:0000000002',phn:'0000000002'};
 const remote=planNewPatients(b,{patients:[other]},'2026-10-15',now);
 const m=mergeSession(b,local,remote);assert.deepEqual(m.conflicts,[]);assert.equal(Object.keys(m.ledger.newPatientStarts).length,2);validateLedger(m.ledger);
});
test('calendar matches exact titles, skips cancellations, interprets Pacific dates',()=>{
 assert.equal(visitEventDate({summary:'TRIM VISIT DAY',start:{date:'2026-10-22'}}),'2026-10-22');
 assert.equal(visitEventDate({summary:'TRIM VISIT DAY',start:{dateTime:'2026-10-23T01:00:00Z'}}),'2026-10-22');
 for(const event of [{summary:'NOT TRIM VISIT DAY',start:{date:'2026-10-22'}},{summary:'TRIM VISIT DAY',status:'cancelled',start:{date:'2026-10-22'}}])assert.equal(visitEventDate(event),null);
});
test('calendar read expands recurrences, completes pages, makes no writes',async()=>{
 const previous=globalThis.fetch,requests=[];globalThis.fetch=async(url,options)=>{
  requests.push([new URL(url),options]);return {ok:true,json:async()=>requests.length===1?{items:[{summary:'TRIM VISIT DAY',start:{date:'2026-10-22'}}],nextPageToken:'two'}:{items:[{summary:'TRIM VISIT DAY',start:{date:'2026-10-24'}}]}};
 };
 try{const c=await new VisitCalendar().read('2026-10-15','2026-11-01');assert.deepEqual(c.dates,['2026-10-22','2026-10-24']);assert.equal(requests.length,2);assert.equal(requests[0][0].searchParams.get('singleEvents'),'true');assert.equal(requests[1][0].searchParams.get('pageToken'),'two');assert.ok(requests.every(([,o])=>!o.method));}finally{globalThis.fetch=previous;}
});
test('calendar errors reject rather than returning an empty successful calendar',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:403});
 try{await assert.rejects(()=>new VisitCalendar().read(),/Calendar access is unavailable/);}finally{globalThis.fetch=previous;}
});
