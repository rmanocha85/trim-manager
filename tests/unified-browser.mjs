// End-to-end unified session checks. Every record, path and AI response is synthetic.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,access,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-unified-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),notesPath=path.join(dir,'notes');
const date=today(),person={id:'own',name:'SYNTHETIC, Panel',phn:'0000000001',ava:'123456',unit:'cedar',room:'101',codes:'401',extra:{keep:true}};
const roster={patients:[person],otherPatients:[{...person,id:'other',name:'SYNTHETIC, Coverage',phn:'0000000002',ava:'123457',doctor:'Dr. Adam Siemens',notesDataUploaded:false}],removedPatients:[{...person,id:'retained',name:'SYNTHETIC, Retained',phn:'0000000003',ava:'123458',removedDate:addDays(date,-1)}],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[{id:'old-date',label:'Synthetic date',sortKey:20261001,dow:'Thu',seen:'2'}],unrelated:{preserve:['all',1]}};
const ledger=blankLedger('unified-synthetic');ledger.baselines['phn:'+person.phn]={date:addDays(date,-30)};
const originalRoster=JSON.stringify(roster),originalBilling=JSON.stringify(ledger);await writeFile(rosterPath,originalRoster);await writeFile(billingPath,originalBilling);
const chatgpt={status:async()=>({connected:false,planEnabled:false})};
const server=createServer({rosterPath,billingPath,notesPath,chatgpt,lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],dialogs=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());void d.accept();});await context.route('https://**/*',r=>r.abort());
const p=selector=>page.locator('#patients-workspace').locator(selector);
const section=async name=>page.locator(`[data-section="${name}"]`).click();
const localReady=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled);
const saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const editRoom=async room=>{await p('[data-click="startEdit(\'own\')"]').click();await p('#er-own').fill(room);await p('[data-click="saveEdit(\'own\')"]').click();await localReady();};
const readRoster=async()=>JSON.parse(await readFile(rosterPath,'utf8'));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.patient').first().waitFor();await saved();
 assert.equal(await readFile(rosterPath,'utf8'),originalRoster);assert.equal(await readFile(billingPath,'utf8'),originalBilling);await assert.rejects(access(path.join(dir,'roster-snapshots')));
 await section('patients');assert.equal(await page.locator('.app-sections [aria-pressed=true]').count(),1);await p('#ulist a[href="https://www.avaemr.ca/patients/123456"]').first().waitFor();
 await p('[data-click="printTrim()"]').click();await page.frameLocator('#patients-print-frame').locator('body').filter({hasText:person.name}).waitFor();assert.equal(await page.frameLocator('#patients-print-frame').getByText('SYNTHETIC, Retained',{exact:true}).count(),0);await page.locator('#patients-print-close').click();
 await p('[data-click="printBilling()"]').click();await page.frameLocator('#patients-print-frame').locator('body').filter({hasText:person.name}).waitFor();await page.locator('#patients-print-close').click();
 await editRoom('102');
 await p('[data-click="showTab(\'other-patients\',this)"]').click();await p('[data-other-doctor="other"]').selectOption('Dr. Celine Laferriere');await localReady();
 assert.equal(await readFile(rosterPath,'utf8'),originalRoster);
 await section('notes');await page.locator('#notes-input').fill('Synthetic local note.');await page.locator('#notes-confirm').click();await page.locator('[data-tab="notes"]').click();await page.locator('[data-assessment]').fill('Synthetic physician-reviewed assessment.');await page.locator('[data-reviewed]').click();await page.locator('#notes-handoff').click();await page.locator('#notes-handoff-result').filter({hasText:'prepared locally'}).waitFor();
 await section('billing');await page.locator('.patient').filter({hasText:person.name}).click();await page.locator('[data-code="00114"]').click();await page.locator('[data-reason-preset="0"]').click();await localReady();
 await assert.rejects(access(path.join(notesPath,'patient-context.json')));assert.equal(await readFile(billingPath,'utf8'),originalBilling);
 // Patient selection is independent: opening Patients does not replace Billing's selection.
 await section('patients');await page.screenshot({path:'work/unified-patients-synthetic.png',fullPage:true});await section('billing');assert.match(await page.locator('#editor h2').innerText(),/Panel/);
 await page.reload();await page.locator('.patient').first().waitFor();await localReady();assert.match(await page.locator('#local-changes').innerText(),/Roster, Notes, Billing pending/);
 await section('patients');assert.match(await p('#ulist').innerText(),/102/);assert.equal(await p('[data-notes-upload]').count(),0);
 await p('[data-click="showTab(\'other-patients\',this)"]').click();assert.equal(await p('[data-other-doctor="other"]').inputValue(),'Dr. Celine Laferriere');
 // Roster succeeds, Notes fails, Billing remains local. The failure must say exactly that.
 let fail=true;await page.route('**/api/notes/document?*',async route=>{if(fail&&route.request().method()==='PUT')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic notes save unavailable'})});return route.continue();});
 await page.locator('#sync').click();await page.locator('#session-status').filter({hasText:'Roster saved.'}).waitFor();assert.match(await page.locator('#session-status').innerText(),/Remaining changes stay on this device/);
 const partial=await readRoster();assert.equal(partial.patients[0].room,'102');assert.deepEqual(partial.unrelated,roster.unrelated);assert.deepEqual(partial.patients[0].extra,person.extra);assert.equal(partial.otherPatients[0].doctor,'Dr. Celine Laferriere');assert.equal(partial.removedPatients.length,1);assert.deepEqual(partial.billingDates,roster.billingDates);assert.equal(await readFile(billingPath,'utf8'),originalBilling);
 const snapshot=(await readdir(path.join(dir,'roster-snapshots')))[0];assert.equal(JSON.parse(await readFile(path.join(dir,'roster-snapshots',snapshot),'utf8')).patients[0].room,'101');
 fail=false;await page.reload();await page.locator('.patient').first().waitFor();await localReady();await page.locator('#sync').click();await saved();
 assert.equal(JSON.parse(await readFile(billingPath,'utf8')).entries.length,1);assert.equal(JSON.parse(await readFile(path.join(notesPath,'handoffs',date+'.json'),'utf8')).patients[0].assessment,'Synthetic physician-reviewed assessment.');
 // Lost save acknowledgment is safe to retry without overwriting or duplicating.
 await section('patients');await editRoom('103');let lost=true;await page.route('**/api/roster/document',async route=>{if(lost&&route.request().method()==='PUT'){lost=false;await route.fetch();return route.abort();}return route.continue();});await page.locator('#sync').click();await page.locator('#session-status').filter({hasText:'Remaining changes'}).waitFor();assert.equal((await readRoster()).patients[0].room,'103');await page.locator('#sync').click();await saved();
 // Competing writes block replacement; reload requires an explicit discard confirmation.
 await editRoom('104');const competing=await readRoster();competing.patients[0].room='REMOTE';await writeFile(rosterPath,JSON.stringify(competing));await page.locator('#sync').click();await page.locator('#session-status').filter({hasText:'changed on both computers'}).waitFor();assert.equal((await readRoster()).patients[0].room,'REMOTE');assert.match(await p('#ulist').innerText(),/104/);await p('#roster-close').click();await p('#btn-connect').click();await saved();assert.match(await p('#ulist').innerText(),/REMOTE/);
 // Removal is local until save, retains the entire identity, and can reactivate that same ID.
 await p('[data-click="promptDel(\'own\')"]').click();await p('[data-click="confirmDel()"]').click();await localReady();assert.equal((await readRoster()).patients.length,1);await page.locator('#sync').click();await saved();assert.equal((await readRoster()).patients.length,0);
 await p('#add-patient > summary').click();for(const [id,value]of Object.entries({'in-name':person.name,'in-phn':person.phn,'in-room':'105','in-codes':person.codes,'in-ava':person.ava}))await p('#'+id).fill(value);await p('#in-unit').selectOption('cedar');await p('[data-click="addPatient()"]').click();await localReady();await page.locator('#sync').click();await saved();const restored=await readRoster();assert.equal(restored.patients[0].id,'own');assert.deepEqual(restored.patients[0].extra,person.extra);assert.equal(restored.patients[0].newPanelPatient,false);assert.equal(restored.removedPatients.length,1);
 await p('[data-click="showTab(\'history\',this)"]').click();await p('#snapshot-list button').first().click();await p('#history-banner').waitFor({state:'visible'});assert.equal(await p('#ulist .needs-connect').first().evaluate(e=>getComputedStyle(e).pointerEvents),'none');assert.match(await p('#ulist').innerText(),/101/);await p('[data-click="exitHistoryView()"]').click();assert.match(await p('#ulist').innerText(),/105/);
 await section('settings');assert.equal(await page.locator('#starting-dates').evaluate(e=>e.open),false);await page.screenshot({path:'work/unified-settings-synthetic.png',fullPage:true});
 // Laptop backups support preview and full restore with a safety copy.
 await page.locator('#backup-state').filter({hasText:'Drive-folder backup verified'}).waitFor();
 await page.locator('#backup-settings details>summary').click();await page.locator('#backup-list').click();
 await page.waitForFunction(()=>document.querySelector('#backup-choice').options.length>=3);
 const choices=await page.locator('#backup-choice option').count();await page.locator('#backup-choice').selectOption(String(choices-2));await page.locator('#backup-preview').click();
 await page.locator('#backup-preview-info').filter({hasText:'0 patient/date entries'}).waitFor();await page.locator('#backup-restore').click();await page.locator('#backup-preview-info').filter({hasText:''}).waitFor();
 await page.waitForFunction(()=>document.querySelector('#backup-restore').disabled);assert.equal(JSON.parse(await readFile(billingPath,'utf8')).entries.length,0);assert.equal((await readRoster()).patients[0].room,'105');
 // New intake creates its empty Notes file in the same shared save, without changing existing history.
 const existingContext=await readFile(path.join(notesPath,'patients',person.phn+'.json'),'utf8');
 await section('patients');
 for(const [id,value]of Object.entries({'in-name':'SYNTHETIC, New intake','in-phn':'0000000004','in-room':'106','in-codes':'290 V15','in-ava':'123459'}))await p('#'+id).fill(value);
 await p('#in-unit').selectOption('cedar');await p('[data-click="addPatient()"]').click();await localReady();
 await assert.rejects(access(path.join(notesPath,'patients','0000000004.json')));
 await page.locator('#sync').click();await saved();
 const initialized=JSON.parse(await readFile(path.join(notesPath,'patients','0000000004.json'),'utf8'));
 assert.equal(initialized.context.patient.name,'SYNTHETIC, New intake');assert.equal(initialized.context.summaryMarkdown,'');assert.equal(initialized.context.importStatus,undefined);
 assert.equal(await readFile(path.join(notesPath,'patients',person.phn+'.json'),'utf8'),existingContext);
 assert.equal(JSON.parse(await readFile(path.join(notesPath,'index.json'),'utf8')).patients['phn:0000000004'].path,'patients/0000000004.json');
 assert.deepEqual(errors,[]);assert.equal(dialogs.some(d=>d.includes('Invalid patient action')||d.includes('Unknown patient')),false);
 console.log('PASS unified navigation, independent selections, both print previews, complete roster preservation, local recovery across all three sections, single save, partial failure and retry, lost acknowledgment, conflict rejection, removal/reactivation, historical read-only view, collapsed historical dates; synthetic data only.');
}catch(e){console.log('Browser errors:',errors,'alerts:',dialogs);await page.screenshot({path:'work/unified-failure.png',fullPage:true});throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
