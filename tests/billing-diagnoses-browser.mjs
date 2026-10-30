// Isolated synthetic files and browser profile; no production data or user tabs.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry,today,addDays} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-diagnoses-'));
const patients=[0,1].map(i=>({id:'synthetic-'+i,key:'phn:'+String(i+1).padStart(10,'0'),phn:String(i+1).padStart(10,'0'),name:'SYNTHETIC, Example '+i,unit:'a',room:String(101+i),codes:'401',ava:i?'':'123456',panel:true}));
const roster={patients,units:[{id:'a',name:'SYNTHETIC UNIT'}]},date=today();
let ledger=blankLedger('synthetic-diagnosis-ui');
ledger=upsertEntry(ledger,patients[0],date,[{code:'00114',units:1,reason:'Synthetic review',diagnosis:'250',diagnosisMode:'per-charge'},{code:'14077',units:1,start:'10:00',end:'10:10',diagnosis:'250',diagnosisSource:'primary114'}]);
ledger.historicalBillings=[{id:'old',patientKey:patients[0].key,date:addDays(date,-30),codes:['14077'],status:'already_billed'}];
for(const p of patients)ledger.baselines[p.key]={date:addDays(date,-30)};
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));await mkdir('work',{recursive:true});
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));await context.route('https://**/*',r=>r.abort());
const saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const diagnosis=()=>page.locator('[data-field=diagnosis]').first();
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('.patient').first().waitFor();await saved();
  const initial=await readFile(billingPath,'utf8');
  for(const mode of ['billing','routine']){
    await page.locator('[data-tab='+mode+']').click();await page.locator('#search').fill(patients[1].phn);
    const title=await page.locator('#editor h2').innerText();
    await page.locator('#roster .billing-phn-copy').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patients[1].phn);
    assert.equal(await page.locator('#editor h2').innerText(),title);assert.equal(await readFile(billingPath,'utf8'),initial);
  }
  await page.locator('[data-tab=billing]').click();await page.locator('#search').fill(patients[0].phn);await page.locator('.patient').click();assert.equal(await page.locator('#editor .billing-phn-copy,#billing-copy-phn').count(),1);
  await diagnosis().fill('250 311 V66.7');assert.doesNotMatch(await page.locator('#editor-issues').innerText(),/needs information/);
  assert.equal(await page.locator('[data-field=diagnosis]').nth(1).inputValue(),'250 311 V66.7');
  await diagnosis().fill('250 311 V66.7 401');assert.match(await page.locator('#editor-issues').innerText(),/up to 3/);
  await diagnosis().fill('250 311 V66.7');await page.waitForFunction(()=>!document.querySelector('#sync').disabled);await page.locator('#sync').click();await saved();
  await page.reload();await page.locator('.patient').first().waitFor();await saved();await page.locator('#search').fill(patients[0].phn);await page.locator('.patient').click();assert.equal(await diagnosis().inputValue(),'250 311 V66.7');
  const stored=JSON.parse(await readFile(billingPath,'utf8'));assert.equal(stored.entries[0].items[0].diagnosis,'250 311 V66.7');assert.deepEqual(stored.historicalBillings,ledger.historicalBillings);
  await page.locator('[data-tab=history]').click();assert.match(await page.locator('#history-content').innerText(),/250 311 V66.7/);
  await page.locator('[data-tab=review]').click();assert.equal(await page.locator('[data-review-entry]').count(),0);
  await page.locator('[data-section=settings]').click();assert.doesNotMatch(await page.locator('#annual-counts').innerText(),/14077/);assert.equal(await page.locator('#annual-counts .issue-box').count(),0);
  await page.locator('[data-section=billing]').click();await page.locator('[data-tab=billing]').click();
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const row=page.locator('#roster .patient-row'),copy=await row.locator('.billing-phn-copy').boundingBox(),name=await row.locator('.identity-name').boundingBox();assert.ok(name.y+name.height<=copy.y+1||name.x+name.width<=copy.x,JSON.stringify({width,name,copy}));
    await page.screenshot({path:'work/billing-diagnoses-'+width+'.png',fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('PASS row PHN copying in both modes without selection/writes, three-diagnosis save/reload/history/inheritance, fourth-code rejection, no 14077 annual warning/totals, preserved imported history and responsive layout.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
