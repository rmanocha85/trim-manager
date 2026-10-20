// Synthetic records only: design, manual upload sign-off, and editable 127 defaults.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays,rosterView,normalizeRoster,upsertEntry} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-patient-layout-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const patients=Array.from({length:4},(_,i)=>({id:'sample-'+i,name:['Example, Alex','Sample, Jordan','Demo, Casey','Existing, Diagnosis'][i],phn:String(i+1).padStart(10,'0'),ava:String(123456+i),unit:'cedar',room:String(1401+i),codes:'401',pFlag:i===0,notesDataUploaded:i===1,notesDataUploadedAt:i===1?'2026-10-01T12:00:00Z':null}));
const roster={patients,otherPatients:[{...patients[0],id:'coverage',name:'Coverage, Example',phn:'0000000005',ava:'123460',notesDataUploaded:false}],removedPatients:[],units:[{id:'cedar',name:'CEDAR'}],billingDates:[]};
const date=today();let ledger=blankLedger('patient-layout-synthetic');
for(const p of patients)ledger.baselines['phn:'+p.phn]={date:addDays(date,-30)};
const existing=rosterView(normalizeRoster(roster),ledger).find(p=>p.phn===patients[3].phn);
ledger=upsertEntry(ledger,existing,date,[{code:'00127',units:1,diagnosis:'250'}]);
ledger=upsertEntry(ledger,existing,addDays(date,-1),[{code:'00127',units:1}]);
const originalEntries=structuredClone(ledger.entries);
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept());await context.route('https://**/*',r=>r.abort());await mkdir('work',{recursive:true});
const p=s=>page.locator('#patients-workspace').locator(s),section=s=>page.locator(`[data-section="${s}"]`).click();
const saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const ready=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled);
const save=async()=>{await ready();await page.locator('#sync').click();await saved();};
const readBilling=async()=>JSON.parse(await readFile(billingPath,'utf8'));
const select=async phn=>{await page.locator('#search').fill(phn);await page.locator('.patient').click();};
const diagnosis=()=>page.locator('.code-details').filter({has:page.locator('[data-remove-code="00127"]')}).locator('[data-field=diagnosis]');
const upload=p('[data-notes-upload="sample-0"]');
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.patient').first().waitFor();await saved();
 assert.deepEqual(await page.locator('.app-sections button').allTextContents(),['Patient','Billing','Notes']);
 for(const name of ['patients','billing','notes']){
   await section(name);const footer=await page.locator('.app-utility').boundingBox();assert.equal(footer.y+footer.height,1000);
   await section('settings');assert.equal(await page.locator('#settings').isVisible(),true);assert.equal(await page.locator('#calendar').isVisible(),false);assert.equal(await page.locator('.app-sections [aria-pressed=true]').count(),0);
 }
 await section('patients');
 assert.equal(await upload.getAttribute('aria-pressed'),'false');assert.equal(await upload.locator('.notes-upload-text').innerText(),'Notes pending');
 const row=upload.locator('xpath=ancestor::tr'),name=row.locator('.pnm'),flag=row.locator('.pflag');
 const before=await name.boundingBox(),flagBefore=await flag.boundingBox(),statusBefore=await upload.boundingBox();
 const copy=row.locator('.patient-meta .phn-copy');await copy.click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patients[0].phn);
 await upload.focus();await page.keyboard.press('Space');await ready();
 assert.equal(await upload.getAttribute('aria-pressed'),'true');assert.equal(await upload.getAttribute('data-dirty'),'true');assert.equal(await upload.locator('.notes-upload-dot').isVisible(),true);
 assert.deepEqual(await name.boundingBox(),before);assert.deepEqual(await flag.boundingBox(),flagBefore);assert.equal((await upload.boundingBox()).width,statusBefore.width);
 assert.equal(JSON.parse(await readFile(rosterPath,'utf8')).patients[0].notesDataUploaded,false);
 // In-progress saves lock the new footer just like the main navigation.
 let release,started;const entered=new Promise(r=>started=r),held=new Promise(r=>release=r);
 await page.route('**/api/roster/document',async route=>{if(route.request().method()==='PUT'){started();await held;}await route.continue();});
 await page.locator('#sync').click();await entered;assert.equal(await page.locator('.app-utility').evaluate(e=>e.inert),true);release();await saved();await page.unroute('**/api/roster/document');
 assert.equal(await upload.getAttribute('data-dirty'),'false');assert.equal(await upload.locator('.notes-upload-dot').isVisible(),false);
 assert.equal(JSON.parse(await readFile(rosterPath,'utf8')).patients[0].notesDataUploaded,true);
 await upload.click();await ready();await page.reload();await page.locator('.patient').first().waitFor();await ready();await section('patients');
 assert.equal(await upload.getAttribute('aria-pressed'),'false');assert.equal(await upload.getAttribute('data-dirty'),'true');await save();
 assert.equal(JSON.parse(await readFile(rosterPath,'utf8')).patients[0].notesDataUploadedAt,null);
 await p('[data-click="showTab(\'other-patients\',this)"]').click();const coverage=p('[data-notes-upload="coverage"]');
 assert.equal(await coverage.locator('xpath=..').locator('.phn-copy').count(),1);await coverage.click();await save();assert.equal(JSON.parse(await readFile(rosterPath,'utf8')).otherPatients[0].notesDataUploaded,true);
 await p('[data-click="showTab(\'patients\',this)"]').click();
 for(const width of [1440,1024,390]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`horizontal overflow at ${width}`);
   await upload.scrollIntoViewIfNeeded();const footer=await page.locator('.app-utility').boundingBox(),box=await upload.boundingBox();assert.ok(box.y+box.height<=footer.y);
   await page.screenshot({path:`work/patient-layout-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});await section('billing');await select(patients[0].phn);
 await page.locator('[data-code="00127"]').click();assert.equal(await diagnosis().inputValue(),'V66.7');assert.equal(await diagnosis().isEditable(),true);
 await diagnosis().fill('V66.8');await ready();await section('settings');await section('billing');await select(patients[0].phn);assert.equal(await diagnosis().inputValue(),'V66.8');
 await page.reload();await page.locator('.patient').first().waitFor();await ready();await select(patients[0].phn);assert.equal(await diagnosis().inputValue(),'V66.8');await save();
 assert.equal((await readBilling()).entries.find(e=>e.patientKey==='phn:'+patients[0].phn).items.find(i=>i.code==='00127').diagnosis,'V66.8');
 await page.locator('[data-tab=routine]').click();await select(patients[1].phn);await page.locator('[data-code="00127"]').click();assert.equal(await diagnosis().inputValue(),'V66.7');await save();
 // Custom full-code entry uses the same default. Clearing the field stays cleared.
 await section('billing');await page.locator('[data-tab=billing]').click();await select(patients[2].phn);await page.locator('.other-codes summary').click();await page.locator('#custom-code').fill('00127');await page.locator('#add-code').click();assert.equal(await diagnosis().inputValue(),'V66.7');
 await diagnosis().fill('');await ready();await save();await select(patients[3].phn);assert.equal(await diagnosis().inputValue(),'250');
 await page.locator('#entry-comment').fill('Synthetic additional comment');await save();assert.equal(await diagnosis().inputValue(),'250');
 const final=await readBilling();assert.deepEqual(final.entries.find(e=>e.id===originalEntries[1].id),originalEntries[1]);assert.equal(final.entries.find(e=>e.patientKey==='phn:'+patients[2].phn).items.find(i=>i.code==='00127').diagnosis,'');
 assert.deepEqual(errors,[]);console.log('PASS bottom Settings across sections and save lock; stable Notes status layout, PHN copy, keyboard toggle, saved/unsaved recovery, coverage, responsive layout; new 127 defaults in Concern/Routine/custom entry, editable values preserved and historical billing untouched.');
}catch(e){await page.screenshot({path:'work/patient-layout-failure.png',fullPage:true});throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
