// Isolated synthetic roster, billing and browser. No live patient data.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,normalizeRoster,rosterView,upsertEntry} from '../public/core.mjs';
const date='2026-11-05',dir=await mkdtemp(path.join(os.tmpdir(),'trim-roster-return-'));
const people=[1,2].map(n=>({id:'sample-'+n,name:'Example, '+n,phn:String(n).padStart(10,'0'),ava:String(123456+n),unit:'cedar',room:String(1500+n),codes:'401',hospitalStays:[{id:'stay-'+n,admittedDate:'2026-10-19',returnedDate:null,updatedAt:'2026-10-19T12:00:00Z'}]}));
const roster={patients:[people[0]],otherPatients:[{...people[1],doctor:'Dr. Adam Siemens'}],units:[{id:'cedar',name:'CEDAR'}],removedPatients:[],billingDates:[]};
let ledger=blankLedger('roster-return-synthetic');
for(const p of rosterView(normalizeRoster(roster),ledger))ledger=upsertEntry(ledger,p,'2026-10-18',[{code:'00114',units:1,diagnosis:'401',reason:'Synthetic saved visit'}]);
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));await mkdir('work',{recursive:true});
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({timezoneId:'America/Vancouver',viewport:{width:1440,height:1000}}),errors=[],dialogs=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{if(d.type()==='beforeunload'){await d.accept();return;}dialogs.push(d.message());await d.dismiss();});
await page.clock.install({time:new Date('2026-11-06T07:30:00Z')}); // Nov 5 in Vancouver; Nov 6 UTC.
await page.route('https://**/*',r=>r.abort());
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/')&&(url.pathname==='/'||/\.(mjs|css|html)$/.test(url.pathname))){
  const remote=await fetch(process.env.TRIM_ASSET_BASE+(url.pathname==='/'?'index.html':url.pathname.slice(1))+url.search);assert.ok(remote.ok);
  await route.fulfill({status:200,contentType:remote.headers.get('content-type')||'text/plain',body:await remote.text()});
 }else await route.fallback();
});
const p=s=>page.locator('#patients-workspace').locator(s),ready=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled);
const saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const save=async()=>{await ready();await page.locator('#sync').click();await saved();};
const readRoster=async()=>JSON.parse(await readFile(rosterPath,'utf8')),readBilling=async()=>JSON.parse(await readFile(billingPath,'utf8'));
const tab=async name=>{await page.locator('[data-section=patients]').click();await p(`[data-click="showTab('${name}',this)"]`).click();};
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor();await saved();
 await page.locator('[data-day="2026-11-04"]').click();
 await tab('patients');assert.equal(await p('.roster-return:visible').count(),1);
 await page.screenshot({path:'work/roster-return-before.png',fullPage:true});
 // Quick return follows today in Vancouver, not the selected billing date or UTC date.
 await p('.roster-return:visible').click();await ready();assert.equal(await p('.roster-return-undo:visible').count(),1);assert.equal(await p('#ulist .hospital-flag').count(),0);assert.match(await p('#ulist .hospital-dates').innerText(),/Returned today.*Nov 5/s);
 assert.deepEqual(dialogs,[]);assert.deepEqual(await readRoster(),roster);assert.deepEqual(await readBilling(),ledger);
 await page.reload();await page.locator('.patient').first().waitFor();await ready();await tab('patients');assert.equal(await p('.roster-return-undo:visible').count(),1);
 await p('.roster-return-undo:visible').click();await saved();assert.equal(await p('.roster-return:visible').count(),1);assert.deepEqual(await readRoster(),roster);
 // Unfinished demographic input prevents hospital edits without losing the form.
 await p('#add-patient > summary').click();await p('#in-name').fill('Unfinished');assert.equal(await p('.roster-return:visible').isDisabled(),true);await p('#in-name').fill('');await p('#add-patient > summary').click();await saved();assert.equal(await p('.roster-return:visible').isEnabled(),true);
 // Keep a pending charge while returning a patient, then save both.
 await page.locator('[data-section=billing]').click();await page.locator('[data-day="2026-11-05"]').click();await page.locator('#search').fill(people[0].phn);await page.locator('.patient').click();
 await page.locator('[data-code="14077"]').click();await page.locator('[data-field=start]').fill('10:00');await page.locator('[data-field=start]').blur();await page.locator('[data-field=end]').fill('10:10');await page.locator('[data-field=end]').blur();await ready();
 await tab('patients');await p('.roster-return:visible').click();await ready();await page.screenshot({path:'work/roster-return-pending.png',fullPage:true});await save();
 const returned=await readRoster(),billed=await readBilling();assert.equal(returned.patients[0].hospitalStays[0].returnedDate,date);assert.deepEqual(returned.otherPatients,roster.otherPatients);assert.equal(await p('.roster-return-undo:visible').count(),0);
 for(const entry of ledger.entries)assert.deepEqual(billed.entries.find(e=>e.id===entry.id),entry);
 assert.ok(billed.entries.some(e=>e.date===date&&e.items.some(i=>i.code==='14077')),JSON.stringify(billed.entries));
 await page.locator('[data-section=billing]').click();await page.locator('#search').fill(people[0].phn);await page.locator('.patient').click();assert.equal(await page.locator('#editor .hospital-flag').count(),0);assert.equal(await page.locator('[data-code="00114"]').isEnabled(),true);
 // Other Patients supports the same quick return and exact undo.
 await tab('other-patients');await p('.roster-return:visible').click();await ready();await p('.roster-return-undo:visible').click();await saved();assert.deepEqual(await readRoster(),returned);await p('.roster-return:visible').click();await save();assert.equal((await readRoster()).otherPatients[0].hospitalStays[0].returnedDate,date);assert.deepEqual(await readBilling(),billed);
 // Correct dates from the roster menu; this is the same hospital editor as Billing.
 await tab('patients');await p('.patient-actions-toggle:visible').click();await p('[data-click="editHospitalDates(\'sample-1\')"]').click();
 assert.equal(await p('#roster-hospital-dialog').isVisible(),true);await p('#hospital-returned').fill('2026-11-04');await p('#hospital-form [type=submit]').click();await save();assert.equal((await readRoster()).patients[0].hospitalStays[0].returnedDate,'2026-11-04');
 await page.reload();await page.locator('.patient').first().waitFor();await saved();await tab('patients');assert.equal(await p('.roster-return-undo:visible,.roster-return:visible').count(),0);assert.match(await p('#ulist .hospital-dates').innerText(),/Nov 4/);
 for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 // A competing hospital-date correction must require review, never be overwritten.
 await page.setViewportSize({width:1440,height:1000});
 const reopened=await readRoster();reopened.patients[0].hospitalStays[0].returnedDate=null;await writeFile(rosterPath,JSON.stringify(reopened));
 await page.locator('#load-latest').click();await p('.roster-return:visible').waitFor();await saved();await p('.roster-return:visible').click();await ready();
 const competing=structuredClone(reopened);competing.patients[0].hospitalStays[0].returnedDate='2026-11-03';competing.patients[0].hospitalStays[0].updatedAt='2026-11-05T12:00:00Z';await writeFile(rosterPath,JSON.stringify(competing));
 await page.locator('#sync').click();await p('#roster-conflict-dialog').waitFor();assert.deepEqual(await readRoster(),competing);assert.deepEqual(await readBilling(),billed);
 assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
 console.log('PASS roster quick return, Pacific today independent of billing date, no confirmation, recovery + exact undo, save boundary, both rosters, date corrections, concurrent conflict protection, billing preservation and responsive containment.');
}catch(e){console.error('Browser errors:',errors);await page.screenshot({path:'work/roster-return-failure.png',fullPage:true});throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
