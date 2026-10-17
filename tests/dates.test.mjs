import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDate,formatTimestamp,formatRequestTime,isCalendarDate} from '../public/dates.mjs';
import {blankLedger,upsertEntry} from '../public/core.mjs';
import {reportGroups,reportLines} from '../public/reports.mjs';
test('date display spells month and weekday without timezone or DST shifts',()=>{
  const original=process.env.TZ;
  try{for(const tz of ['America/Los_Angeles','Pacific/Honolulu','Asia/Tokyo']){
    process.env.TZ=tz;
    for(const [d,text] of [['2026-10-06','Tue, Oct 6, 2026'],['2026-10-07','Wed, Oct 7, 2026'],['2026-03-08','Sun, Mar 8, 2026'],['2026-11-01','Sun, Nov 1, 2026'],['2028-02-29','Tue, Feb 29, 2028'],['2026-01-01','Thu, Jan 1, 2026']])assert.equal(formatDate(d),text);
  }}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
  assert.equal(isCalendarDate('2026-02-29'),false);assert.equal(formatDate(''), '');assert.equal(formatDate('unclear'), 'unclear');
});
test('save timestamps use Pacific but request wall-time date remains unchanged',()=>{
  assert.equal(formatTimestamp('2026-10-07T02:35:00Z'),'Tue, Oct 6, 2026 · 7:35 PM');
  assert.equal(formatRequestTime('2026-10-07T00:10'),'Wed, Oct 7, 2026 · 00:10');
});
test('both report layouts spell service dates while preserving source data',()=>{
  const p={key:'synthetic',id:'synthetic',name:'SYNTHETIC',phn:'0000000001',unit:'cedar',room:'101',panel:true};
  const roster={patients:[p],units:[{id:'cedar',name:'CEDAR'}]};
  const ledger=upsertEntry(blankLedger(),p,'2026-09-24',[{code:'00114',units:1}]);const before=JSON.stringify(ledger);
  assert.equal(reportGroups(ledger,roster,ledger.entries,'date')[0].title,'TRIM List · Thu, Sep 24, 2026');
  assert.match(reportGroups(ledger,roster,ledger.entries,'patient')[0].rows[0].html,/Thu, Sep 24, 2026/);
  assert.match(reportLines({items:[{code:'00115',requestAt:'2026-09-24T18:30'}]}),/Thu, Sep 24, 2026 · 18:30/);
  assert.equal(JSON.stringify(ledger),before);
});
