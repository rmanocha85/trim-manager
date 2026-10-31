// Synthetic files and an isolated Chrome profile; never loads a live patient chart.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-app-fixes-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const patients=Array.from({length:150},(_,i)=>({id:`synthetic-${i}`,name:`SYNTHETIC ${String(i).padStart(3,'0')}, Example`,phn:String(i+1).padStart(10,'0'),ava:i===1?'':i===2?'invalid':String(123456+i),unit:i<145?'cedar':'custom',room:String(100+i),codes:'401'}));
const roster={patients,otherPatients:[],removedPatients:[],units:[{id:'cedar',name:'CEDAR'},{id:'custom',name:'CUSTOM'}],billingDates:[]};
const ledger=blankLedger('app-fixes-synthetic');
for(const p of patients)ledger.baselines['phn:'+p.phn]={date:addDays(today(),-30)};
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],dialogs=[];
await mkdir('work',{recursive:true});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{if(d.type()!=='beforeunload')dialogs.push(d.message());void d.accept();});
await context.route('https://**/*',r=>r.fulfill({contentType:'text/html',body:'Synthetic chart destination'}));
const p=s=>page.locator('#patients-workspace').locator(s),saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const ready=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled);
const save=async()=>{await ready();await page.locator('#sync').click();await saved();};
const readBilling=async()=>JSON.parse(await readFile(billingPath,'utf8'));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.patient').first().waitFor();await saved();
  assert.deepEqual(await page.locator('.app-sections button').allTextContents(),['Roster','Billing','Notes']);
  assert.deepEqual(await page.locator('#calendar .calendar-weekdays span').allTextContents(),['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
  for(const mode of ['billing','routine']){
    await page.locator(`[data-tab="${mode}"]`).click();
    await page.locator('#search').fill(patients[0].phn);assert.equal(await page.locator('.patient').count(),1);
    const selected=await page.locator('#editor h2').innerText();
    const link=page.locator('#roster .ava-chart-link');assert.equal(await link.getAttribute('href'),'https://www.avaemr.ca/patients/123456');
    assert.match(await link.getAttribute('rel'),/noopener/);assert.equal(await link.locator('xpath=ancestor::button').count(),0);
    const popup=context.waitForEvent('page');await link.click();const chart=await popup;await chart.waitForLoadState();assert.equal(chart.url(),'https://www.avaemr.ca/patients/123456');await chart.close();
    assert.equal(await page.locator('#editor h2').innerText(),selected);assert.equal((await readBilling()).entries.length,0);
    await page.locator('.patient').click();assert.equal(await page.locator('#editor .ava-chart-link').count(),1);
    for(const i of [1,2]){await page.locator('#search').fill(patients[i].phn);assert.equal(await page.locator('#roster .ava-chart-link').count(),0);}
  }
  await page.locator('[data-tab=billing]').click();await page.locator('#search').fill(patients[0].phn);await page.locator('.patient').click();await page.locator('[data-code="14077"]').click();
  const note=page.getByLabel('Note (optional)',{exact:true});assert.equal(await note.inputValue(),'');assert.equal(await note.getAttribute('required'),null);
  await save();assert.doesNotMatch(await page.locator('#editor-issues').innerText(),/reason required/i);
  const text='Synthetic first line\nSecond line <check>';
  await note.fill(text);await ready();
  // Device recovery preserves an unsynced note across reload.
  await page.reload();await page.locator('.patient').first().waitFor();await ready();
  await page.locator('#search').fill(patients[0].phn);await page.locator('.patient').click();assert.equal(await note.inputValue(),text);await save();
  assert.equal((await readBilling()).entries[0].items[0].reason,text);
  await page.locator('[data-tab=history]').click();await page.locator('.history-reason').filter({hasText:'Synthetic first line'}).waitFor();
  await page.locator('[data-tab=billing]').click();
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:width===390?844:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const link=await page.locator('#roster .ava-chart-link').boundingBox(),name=await page.locator('#roster .identity-name').boundingBox();
    assert.deepEqual(name,link);
    await page.screenshot({path:`work/app-fixes-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-section=patients]').click();
  assert.doesNotMatch(await p('#stats').innerText(),/Capacity|Used|110/);assert.equal(await p('#lbanner').innerText(),'');
  await p('#add-patient > summary').click();for(const [id,value] of Object.entries({'in-name':'SYNTHETIC EXTRA, Added','in-phn':'0000009999','in-room':'999','in-codes':'401','in-ava':'999999'}))await p('#'+id).fill(value);
  await p('#in-unit').selectOption('custom');await p('[data-click="addPatient()"]').click();await save();
  assert.equal(JSON.parse(await readFile(rosterPath,'utf8')).patients.length,151);
  await page.reload();await page.locator('.patient').first().waitFor();await saved();await page.locator('#search').fill('SYNTHETIC EXTRA');assert.equal(await page.locator('.patient').count(),1);
  await page.locator('[data-section=patients]').click();assert.match(await p('#roster-count').innerText(),/151/);
  for(const [action,rows,pages] of [['printTrim','.t-row','.tpage'],['printBilling','.bpn','.bpage']]){
    if(!await p('#roster-more').evaluate(e=>e.open))await p('#roster-more > summary').click();await p(`[data-click="${action}()"]`).click();const frame=page.frameLocator('#patients-print-frame');
    await frame.locator(rows).first().waitFor();assert.equal(await frame.locator(rows).count(),151);assert.ok(await frame.locator(pages).count()>=4);
    assert.match(await frame.locator('body').innerText(),/CUSTOM/);
    await page.emulateMedia({media:'print'});
    const heights=await frame.locator(pages).evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.ok(heights.every(h=>h<1002),JSON.stringify({action,heights}));
    await page.emulateMedia({media:'screen'});await page.screenshot({path:`work/app-fixes-${action}.png`});await page.locator('#patients-print-close').click();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS six-fix UI checks: exact navigation, Sunday-first headers, independent Ava links in both billing modes, optional 14077 note and recovery/save/history, responsive layout, 151 patients saved/reloaded/searched/printed without omissions.');
}catch(e){console.error(errors,dialogs);await page.screenshot({path:'work/app-fixes-failure.png',fullPage:true});throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
