import test from 'node:test';
import assert from 'node:assert/strict';
import {roundedPacificTime,timeDefaults,editBillingTime,blankLedger,upsertEntry,entryIssues} from '../public/core.mjs';
test('new time defaults round Pacific current time, not host timezone',()=>{
  for(const [utc,time] of [['2026-10-06T01:34:59Z','18:30'],['2026-10-06T01:35:00Z','18:40'],['2026-01-06T02:36:00Z','18:40'],['2026-10-06T06:58:00Z','00:00']])assert.equal(roundedPacificTime(new Date(utc)),time);
  const now=new Date('2026-10-06T01:36:00Z');
  for(const code of ['14077','13121'])assert.deepEqual(timeDefaults(code,now),{start:'18:40',end:'18:50',endAuto:true});
  assert.deepEqual(timeDefaults('00115',now),{start:'18:40'});
  assert.deepEqual(timeDefaults('00114',now),{});
});
test('typing exact times follows auto end until explicitly edited and preserves imported ends',()=>{
  const initial={code:'13121',start:'18:30',end:'18:40',endAuto:true};
  const moved=editBillingTime(initial,'start','1837');assert.equal(moved.start,'18:37');assert.equal(moved.end,'18:47');assert.equal(initial.end,'18:40');
  const manual=editBillingTime(moved,'end','1850');assert.equal(editBillingTime(manual,'start','1840').end,'18:50');
  const old={code:'14077',start:'10:00',end:'10:23',reason:'original'};assert.equal(editBillingTime(old,'start','1005').end,'10:23');
  assert.equal(editBillingTime(initial,'start','2460').start,'2460');
  assert.equal(editBillingTime(initial,'start','2355').end,'');
  assert.equal(editBillingTime({code:'12345',customTimed:true},'start','0800').end,'08:10');
});
test('13121 unknown historical units no longer block, while times and recorded cap still do',()=>{
  const p={key:'synthetic',name:'SYNTHETIC',panel:true};
  let l=upsertEntry(blankLedger(),p,'2026-09-27',[{code:'13121',units:1,start:'18:30',end:'18:40'}]);
  l.historicalBillings=[{patientKey:p.key,date:'2026-09-01',codes:['13121']}];
  const before=structuredClone(l.historicalBillings);
  assert.deepEqual(entryIssues(l.entries[0],l,p),[]);assert.deepEqual(l.historicalBillings,before);
  l.entries[0].items[0].end='';assert.ok(entryIssues(l.entries[0],l,p).some(x=>x.includes('start/end')));
  l.entries[0].items[0].end='18:40';l.entries[0].items[0].units=101;assert.ok(entryIssues(l.entries[0],l,p).some(x=>x.includes('annual total')));
});
