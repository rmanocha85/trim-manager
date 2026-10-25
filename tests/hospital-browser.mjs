// Synthetic data and an isolated browser only; never opens production records.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-hospital-'));
const date=today(),p={id:'synthetic-hospital',key:'phn:0000000001',phn:'0000000001',name:'SYNTHETIC, Hospital',unit:'a',room:'101',codes:'401',ava:'123456',panel:true};
const roster={patients:[p],units:[{id:'a',name:'Synthetic unit'}]},ledger=blankLedger('synthetic-hospital-ui');ledger.patients[p.key]=p;ledger.baselines[p.key]={date:addDays(date,-5)};
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));await mkdir('work',{recursive:true});
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
const saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const save=async()=>{await page.waitForFunction(()=>!document.querySelector('#sync').disabled);await page.locator('#sync').click();await saved();};
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('.patient').waitFor();await saved();await page.locator('.patient').click();
  assert.equal(await page.locator('#hospital-dialog').isVisible(),false);assert.equal(await page.locator('#editor .hospital-banner').count(),0);
  await page.locator('.hospital-menu summary').click();await page.locator('[data-hospital-new]').click();await page.locator('#hospital-admitted').fill(date);await page.locator('#hospital-form [type=submit]').click();
  await page.locator('#editor .hospital-flag').waitFor();assert.equal(await page.locator('[data-code="00114"]').isEnabled(),true);assert.match(await page.locator('.hospital-banner').innerText(),/Admission day: manual 114 available/);await save();
  await page.locator('.hospital-menu summary').click();await page.locator('[data-hospital-edit]').click();await page.locator('#hospital-admitted').fill(addDays(date,-2));await page.locator('#hospital-form [type=submit]').click();
  await page.locator('#editor .hospital-flag').waitFor();assert.equal(await page.locator('[data-code="00114"]').isDisabled(),true);assert.equal(await page.locator('[data-code="14077"]').isEnabled(),true);
  assert.equal(JSON.parse(await readFile(billingPath,'utf8')).entries.length,0);await save();
  let stored=JSON.parse(await readFile(rosterPath,'utf8'));assert.equal(stored.patients[0].hospitalStays[0].admittedDate,addDays(date,-2));assert.equal(stored.patients[0].hospitalStays[0].returnedDate,null);
  await page.locator('[data-code="14077"]').click();await page.locator('[data-field="start"]').fill('10:00');await page.locator('[data-field="start"]').blur();await page.locator('[data-field="end"]').fill('10:10');await page.locator('[data-field="end"]').blur();await save();
  assert.deepEqual(JSON.parse(await readFile(billingPath,'utf8')).entries[0].items.map(i=>i.code),['14077']);
  await page.locator('[data-section=patients]').click();await page.locator('#patients-workspace .hospital-flag').first().waitFor();
  await page.locator('[data-section=notes]').click();await page.locator('#notes-all').check();await page.locator('#rounds .hospital-flag').first().waitFor();
  await page.locator('[data-section=billing]').click();await page.locator('[data-tab=routine]').click();await page.locator('#routine-batch').click();await page.locator('[data-routine-unit=a]').check();assert.match(await page.locator('#routine-review').innerText(),/1 in hospital/);assert.equal(await page.locator('#routine-add').isDisabled(),true);
  await page.locator('[data-tab=billing]').click();await page.locator('[data-hospital-return]').click();await page.locator('#hospital-returned').fill(date);await page.locator('#hospital-form [type=submit]').click();await save();
  assert.equal(await page.locator('#roster .hospital-flag').count(),0);assert.equal(await page.locator('[data-code="00114"]').isEnabled(),true);
  await page.locator('[data-section=notes]').click();await page.locator('.post-hospital-title').filter({hasText:'Post hospital review'}).first().waitFor();assert.equal(await page.locator('#notes-no-concerns').isChecked(),false);
  await page.locator('#notes-input').fill('Synthetic discharge review draft only.');await save();
  assert.equal(JSON.parse(await readFile(billingPath,'utf8')).entries[0].items.length,1);
  await page.reload();await page.locator('.patient').waitFor();await saved();await page.locator('[data-section=notes]').click();await page.locator('.post-hospital-title').first().waitFor();assert.equal(await page.locator('#notes-input').inputValue(),'Synthetic discharge review draft only.');assert.equal(await page.locator('#notes-confirm').innerText(),'Confirm visit input');
  await page.locator('[data-section=billing]').click();await page.locator('[data-tab=routine]').click();await page.locator('.patient').click();await page.locator('[data-code="00114"]').click();assert.doesNotMatch(await page.locator('#editor-issues').innerText(),/within 14 days|in hospital/);await save();
  // External JSON correction must be picked up by Load latest changes.
  stored=JSON.parse(await readFile(rosterPath,'utf8'));stored.patients[0].hospitalStays[0].returnedDate=null;await writeFile(rosterPath,JSON.stringify(stored));await page.locator('#load-latest').click();await page.locator('#roster .hospital-flag').waitFor();await page.locator('[data-tab=review]').click();assert.match(await page.locator('#review').innerText(),/in hospital/);
  await page.locator('[data-tab=billing]').click();for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'work/hospital-'+width+'.png',fullPage:true});}
  assert.deepEqual(errors,[]);console.log('PASS hospital entry/save/reload, shared H flags, 114 blocking, 14077 entry, routine exclusion, return reset, Post hospital review draft, external JSON refresh and responsive layout.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
