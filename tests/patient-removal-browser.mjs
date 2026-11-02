// Synthetic records only; never connects to production patient data.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays,normalizeRoster,rosterView,upsertEntry} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-removal-'));
const patients=[1,2].map(n=>({id:'sample-'+n,name:'Example, '+n,phn:String(n).padStart(10,'0'),ava:String(123456+n),unit:'test',room:String(n),codes:'401'}));
const other={...patients[1],doctor:'Dr. Adam Siemens',custom:{keep:true}};
const roster={patients:[patients[0]],otherPatients:[other],units:[{id:'test',name:'SYNTHETIC'}],removedPatients:[]};
let ledger=blankLedger('removal-synthetic');
for(const p of rosterView(normalizeRoster(roster),ledger))ledger=upsertEntry(ledger,p,addDays(today(),-1),[{code:'00127',units:1,diagnosis:'250'}]);
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
await page.route('https://**/*',r=>r.abort());
// Optional hosted asset verification still uses the isolated local API and storage.
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/')&&(url.pathname==='/'||/\.(mjs|css|html)$/.test(url.pathname))){
  const remote=await fetch(process.env.TRIM_ASSET_BASE+(url.pathname==='/'?'index.html':url.pathname.slice(1))+url.search);
  assert.ok(remote.ok);await route.fulfill({status:200,contentType:remote.headers.get('content-type')||'text/plain',body:await remote.text()});
 }else await route.fallback();
});
const p=s=>page.locator('#patients-workspace').locator(s);
const saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const ready=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled);
const readRoster=async()=>JSON.parse(await readFile(rosterPath,'utf8'));
const readBilling=async()=>JSON.parse(await readFile(billingPath,'utf8'));
const tab=async name=>{await page.locator('[data-section=patients]').click();await p(`[data-click="showTab('${name}',this)"]`).click();};
const openRemoval=async id=>{await p(`[data-click="showPatientActions('${id}',this)"]`).click();await p(`#patient-actions-${id}`).getByRole('button',{name:'Remove from roster',exact:true}).click();};
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor();await saved();
 // Keep an unfinished charge while cancelling and then removing a coverage patient.
 await page.locator('[data-section=billing]').click();await page.locator('#search').fill(other.phn);await page.locator('.patient').click();
 await page.locator('[data-code="14077"]').click();await page.getByLabel('Note (optional)',{exact:true}).fill('Synthetic pending charge to preserve.');await ready();
 await tab('other-patients');await openRemoval(other.id);
 assert.match(await p('#delmsg').innerText(),/Example, 2.*Other Patients/);
 await p('#delmv').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await p('#other-list tbody tr').count(),1);assert.deepEqual(await readRoster(),roster);
 await openRemoval(other.id);await p('#delmv').getByRole('button',{name:'Remove',exact:true}).click();await ready();
 assert.equal(await p('#other-list tbody tr').count(),0);assert.match(await p('#roster-count').innerText(),/0 other patients/);
 assert.deepEqual(await readRoster(),roster);assert.deepEqual(await readBilling(),ledger);
 await page.reload();await page.locator('.patient').first().waitFor();await ready();
 await tab('other-patients');assert.equal(await p('#other-list tbody tr').count(),0);
 await tab('removed');assert.match(await p('#removed-list').innerText(),/Example, 2/);
 await page.locator('#sync').click();await saved();
 const removed=await readRoster(),billed=await readBilling();
 assert.deepEqual(removed.patients,roster.patients);assert.deepEqual(removed.otherPatients,[]);
 assert.deepEqual(removed.removedPatients,[{...other,removedDate:today()}]);
 for(const entry of ledger.entries)assert.deepEqual(billed.entries.find(e=>e.id===entry.id),entry);
 assert.ok(billed.entries.some(e=>e.patientKey==='phn:'+other.phn&&e.items.some(i=>i.reason==='Synthetic pending charge to preserve.')));
 // My Patients retains the same confirmed removal behavior.
 await tab('patients');await openRemoval(patients[0].id);assert.match(await p('#delmsg').innerText(),/Example, 1.*My Patients/);
 await p('#delmv').getByRole('button',{name:'Remove',exact:true}).click();await ready();await page.locator('#sync').click();await saved();
 const final=await readRoster();assert.equal(final.patients.length,0);assert.equal(final.otherPatients.length,0);assert.equal(final.removedPatients.length,2);
 assert.deepEqual(await readBilling(),billed);
 await page.reload();await saved();await tab('removed');assert.equal(await p('#removed-list tbody tr').count(),2);
 assert.deepEqual(errors,[]);
 console.log('PASS both roster removals, named confirmation, cancellation, local recovery, persistence, retained doctor/details, and saved/pending billing preservation.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
