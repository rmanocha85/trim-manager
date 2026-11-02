// Synthetic records only. Search must deselect without discarding billing.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-search-'));
const patients=[1,2].map(n=>({id:'sample-'+n,name:'Example, '+n,phn:String(n).padStart(10,'0'),ava:String(123456+n),unit:'test',room:String(n),codes:'401'}));
const roster={patients,units:[{id:'test',name:'SYNTHETIC'}]},ledger=blankLedger('search-synthetic');
for(const p of patients)ledger.baselines['phn:'+p.phn]={date:addDays(today(),-30)};
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.route('https://**/*',r=>r.abort());
const select=async n=>{await page.locator('#search').fill(patients[n].phn);await page.locator('.patient').click();};
const empty=async()=>{assert.equal(await page.locator('#editor .empty-editor').count(),1);assert.match(await page.locator('#editor').innerText(),/Select a patient from the results to enter billing/);assert.equal(await page.locator('#editor [data-code],#editor [data-field],.patient.selected').count(),0);};
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor();
 await select(0);await page.locator('[data-code="14077"]').click();await page.getByLabel('Note (optional)',{exact:true}).fill('Keep this unfinished billing note.');
 await page.locator('#search').fill(patients[1].phn);await empty();assert.equal(await page.locator('.patient').count(),1);
 await page.waitForFunction(()=>!document.querySelector('#sync').disabled);assert.equal(JSON.parse(await readFile(billingPath,'utf8')).entries.length,0);
 await page.reload();await page.locator('.patient').first().waitFor();await select(0);assert.equal(await page.getByLabel('Note (optional)',{exact:true}).inputValue(),'Keep this unfinished billing note.');
 await page.locator('#search').fill('Example');await empty();await page.locator('#search').fill('no such patient');await empty();await page.locator('#search').fill('');await empty();
 await page.waitForFunction(()=>!document.querySelector('#sync').disabled);await page.locator('#sync').click();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
 const saved=JSON.parse(await readFile(billingPath,'utf8'));assert.equal(saved.entries.length,1);assert.equal(saved.entries[0].patientKey,'phn:'+patients[0].phn);assert.equal(saved.entries[0].items[0].reason,'Keep this unfinished billing note.');
 // Clear a history-opened editing ID, then select a different patient.
 await page.locator('[data-tab=history]').click();await page.locator('[data-history]').first().click();await page.locator('#search').fill(patients[1].phn);await empty();await page.locator('.patient').press('Enter');assert.match(await page.locator('#editor h2').innerText(),/Example, 2/);assert.equal(await page.locator('#editor .code-chip.on').count(),0);
 await page.locator('[data-tab=routine]').click();await select(1);await page.locator('#search').press('End');await page.locator('#search').press('Backspace');await empty();
 await page.locator('[data-tab=billing]').click();await select(0);await page.locator('#search').fill(patients[1].phn);await empty();
 await mkdir('work',{recursive:true});await page.screenshot({path:'work/billing-search-cleared.png'});
 assert.deepEqual(JSON.parse(await readFile(billingPath,'utf8')),saved);assert.deepEqual(errors,[]);
 console.log('PASS search clears selection and historical editing ID in Concern/Routine; single, multiple, zero and cleared results require selection; pending billing survives reload and save unchanged.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
