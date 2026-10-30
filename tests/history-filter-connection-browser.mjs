// Synthetic fixtures, fake AI connection, and isolated browser only.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {blankLedger,upsertEntry,today} from '../public/core.mjs';
import {createServer} from './server-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-history-filter-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const patients=[1,2,3,4,5].map(n=>({id:'synthetic-'+n,key:'phn:'+String(n).padStart(10,'0'),phn:String(n).padStart(10,'0'),name:'SYNTHETIC, Patient '+n,unit:'test',room:String(n),codes:'401',panel:true}));
let ledger=blankLedger('history-filter-synthetic');for(const date of ['2026-09-10','2026-10-10'])ledger=upsertEntry(ledger,patients[0],date,[{code:'00114',units:1}]);
ledger.patients[patients[1].key]=patients[1];ledger.historicalBillings=['2026-09-10','2026-10-10'].map((date,n)=>({id:'synthetic-import-'+n,patientKey:patients[1].key,date,status:'already_billed',codes:['00114'],sources:[]}));ledger.baselines[patients[2].key]={date:'2026-09-01'};
await writeFile(rosterPath,JSON.stringify({patients,units:[{id:'test',name:'SYNTHETIC UNIT'}]}));const original=JSON.stringify(ledger);await writeFile(billingPath,original);
let connected=true,modelError=false,checks=0;
const chatgpt={status:async()=>{checks++;return {connected,planEnabled:connected,email:'synthetic@example.invalid'};},models:async()=>{if(modelError)throw new Error('Synthetic renewal failed');return [{id:'synthetic',name:'Synthetic model'}];},logout:async()=>{connected=false;return {message:'Disconnected'};}};
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock'),chatgpt});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(10000);
try{
  await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
  const url=`http://127.0.0.1:${server.address().port}/?connection=manual`;
  const connect=async()=>{await page.locator('#connect').click();await page.locator('#local-connect').click();await page.locator('.patient').first().waitFor();};
  await page.goto(url);await page.locator('#notes-setup-open').filter({hasText:'ChatGPT connected'}).waitFor();await page.reload();await page.locator('#notes-setup-open').filter({hasText:'ChatGPT connected'}).waitFor();assert.ok(checks>=2);await connect();
  await page.locator('[data-section="settings"]').click();await page.locator('#notes-ai-connect').filter({hasText:'ChatGPT connected'}).waitFor();assert.equal(await page.locator('#notes-ai-connect').isDisabled(),true);assert.equal(await page.locator('#baseline-patient option').count(),2);assert.match(await page.locator('#baseline-needed-count').innerText(),/2 need history/);
  await page.locator('[data-section="billing"]').click();await page.locator('[data-tab="history"]').click();assert.equal(await page.locator('#history-content tbody tr').count(),4);const serviceDate=await page.locator('#service-date').inputValue();
  assert.equal(await page.locator('#history-calendar').isVisible(),true);assert.equal(await page.locator('.history-date-filter select,.history-date-filter input').count(),0);assert.equal(await page.locator('#calendar').isVisible(),false);
  const selectMonth=async target=>{for(let i=0;i<120;i++){const label=await page.locator('#history-calendar-month').innerText();const current=new Date(label+' 1').toISOString().slice(0,7);if(current===target)return;await page.locator(current<target?'#history-month-next':'#history-month-prev').click();}throw Error('History month navigation failed');};
  await selectMonth('2026-10');assert.equal(await page.locator('[data-history-day="2026-10-10"]').evaluate(e=>e.classList.contains('has-billing')),true);await page.locator('[data-history-day="2026-10-10"]').click();
  assert.equal(await page.locator('#history-content tbody tr').count(),2);assert.equal(await page.locator('#service-date').inputValue(),serviceDate);assert.match(await page.locator('#history-date-status').innerText(),/Oct 10, 2026/);
  await page.screenshot({path:'work/history-date-filter-synthetic.png',fullPage:true});
  await page.locator('#history-month-prev').click();await page.locator('[data-history-day="2026-09-10"]').click();assert.equal(await page.locator('#history-content tbody tr').count(),2);assert.match(await page.locator('#history-date-status').innerText(),/Sep 10, 2026/);
  await page.locator('#history-month-next').click();await page.locator('[data-history-day="2026-10-10"]').click();
  await page.locator('[data-history-day="2026-10-11"]').click();assert.equal(await page.locator('#history-content tbody tr').count(),0);await page.locator('[data-history-day="2026-10-10"]').click();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'work/history-calendar-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.locator('#history-by-patient').click();await page.locator('#history-search').fill('Patient 1');await page.locator('#history-patient-results [data-history-patient]').click();assert.equal(await page.locator('#history-content tbody tr').count(),1);await page.locator('#history-date-clear').click();assert.equal(await page.locator('#history-content tbody tr').count(),2);await page.locator('#history-by-date').click();assert.equal(await page.locator('#history-content tbody tr').count(),4);
  await page.locator('#history-date-calendar').click();assert.equal(await page.locator('[data-history-day="'+today()+'"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#service-date').inputValue(),serviceDate);await page.locator('#history-date-clear').click();assert.equal(await readFile(billingPath,'utf8'),original);
  await page.locator('[data-section="settings"]').click();await page.locator('#starting-dates>summary').click();for(let n=4;n<=5;n++){await page.locator('#baseline-patient').selectOption(patients[n-1].key);await page.locator('#baseline-date').evaluate(el=>{el.value='2026-09-25';el.dispatchEvent(new Event('change'));});await page.locator('#baseline-save').click();}
  assert.equal(await page.locator('#starting-dates').evaluate(el=>el.open),true);await page.locator('#starting-dates>summary').click();assert.match(await page.locator('#baseline-needed-count').innerText(),/Setup complete/);assert.equal(await page.locator('#baseline-save').isDisabled(),true);assert.equal(await readFile(billingPath,'utf8'),original);
  await page.locator('#starting-dates>summary').click();await page.locator('#baseline-show-all').check();assert.equal(await page.locator('#baseline-patient option').count(),5);assert.equal(await page.locator('#baseline-save').isEnabled(),true);
  modelError=true;await page.locator('#notes-ai-refresh').click();await page.locator('#notes-ai-status').filter({hasText:'Synthetic renewal failed'}).waitFor();assert.equal(await page.locator('#notes-ai-connect').isDisabled(),false);assert.match(await page.locator('#notes-ai-connect').innerText(),/Reconnect/);modelError=false;await page.locator('#notes-ai-refresh').click();await page.locator('#notes-ai-connect').filter({hasText:'ChatGPT connected'}).waitFor();
  await page.locator('#notes-ai-disconnect').click();await page.locator('#notes-ai-connect').filter({hasText:'Continue with ChatGPT'}).waitFor();assert.equal(await page.locator('#notes-ai-connect').isEnabled(),true);assert.deepEqual(errors,[]);
  console.log('PASS persistent connection indication and failed renewal, exact date filtering for current/imported/patient history without mutations, missing-only starting dates and automatic completion collapse.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
