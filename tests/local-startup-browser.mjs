// Isolated laptop service, synthetic records and fake AI only.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rename,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-local-startup-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),notesPath=path.join(dir,'notes');
const patient={id:'synthetic',name:'SYNTHETIC, Laptop',phn:'0000000001',unit:'test',room:'1',codes:'401'};
const roster={patients:[patient],units:[{id:'test',name:'SYNTHETIC UNIT'}]},ledger=blankLedger('local-startup-test');
ledger.baselines['phn:'+patient.phn]={date:addDays(today(),-21)};
const original=JSON.stringify(ledger);await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,original);
const chatgpt={status:async()=>({connected:false,planEnabled:false})};
const server=createServer({rosterPath,billingPath,notesPath,lockPath:path.join(dir,'billing.lock'),chatgpt});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
let externalRequests=0,writes=0,rosterReads=0;const errors=[];
await context.route('https://**/*',r=>{externalRequests++;return r.abort();});
context.on('request',r=>{if(r.url().includes('/api/roster'))rosterReads++;if(r.method()==='PUT')writes++;});
const newPage=async()=>{const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());return p;};
const opened=async p=>{await p.locator('.patient').first().waitFor();assert.equal(await p.locator('#gate').isVisible(),false);assert.equal(await p.locator('#connection-dialog').isVisible(),false);assert.match(await p.locator('#drive-connection').innerText(),/Local folder connected/);};
try{
 const page=await newPage();await page.goto(url);await opened(page);
 assert.equal(externalRequests,0);assert.equal(writes,0);assert.equal(await readFile(billingPath,'utf8'),original);
 await page.locator('.patient').click();await page.locator('[data-code="00114"]').click();await page.locator('[data-reason-preset="0"]').click();
 await page.locator('[data-section="notes"]').click();await page.locator('[data-tab="rounds"]').click();await page.locator('#notes-input').fill('Synthetic local note retained after reopening.');
 await page.locator('#rounds .notes-save-state').filter({hasText:'Saved on this device'}).waitFor();
 await page.reload();await opened(page);assert.match(await page.locator('#local-changes').innerText(),/pending/);
 await page.locator('.patient').click();assert.equal(await page.locator('[data-field="reason"]').inputValue(),'Fall and trauma');
 await page.locator('[data-section="notes"]').click();await page.locator('[data-tab="rounds"]').click();assert.equal(await page.locator('#notes-input').inputValue(),'Synthetic local note retained after reopening.');
 assert.equal(await readFile(billingPath,'utf8'),original);await assert.rejects(access(path.join(notesPath,'patient-context.json')));assert.equal(writes,0);
 await page.locator('#lock').click();await page.locator('#connect').filter({hasText:'Open local workspace'}).waitFor();assert.equal(await page.locator('#workspace').isVisible(),false);
 const lockedReads=rosterReads;await page.reload();await page.locator('#connect').filter({hasText:'Open local workspace'}).waitFor();assert.equal(rosterReads,lockedReads);
 await page.locator('#connect').click();await opened(page);await page.locator('[data-section="notes"]').click();await page.locator('[data-tab="rounds"]').click();await page.locator('#notes-input').waitFor();
 const second=await newPage();await second.goto(url);await second.locator('#local-startup-status').filter({hasText:'already open for editing'}).waitFor();assert.equal(await second.locator('#workspace').isVisible(),false);assert.equal(writes,0);
 await page.locator('#lock').click();await page.locator('#connect').filter({hasText:'Open local workspace'}).waitFor();await second.locator('#connect').click();await opened(second);
 // Existing recovery must still stop at a changed file revision, without uploads.
 const changed={...structuredClone(ledger),revision:ledger.revision+1,settings:{...ledger.settings,parallel:false}};
 await writeFile(billingPath,JSON.stringify(changed));await second.reload();await second.locator('#billing-lock').filter({hasText:'Changes saved on another computer'}).waitFor();
 assert.equal(await second.locator('#workspace').isVisible(),true);assert.equal(writes,0);assert.deepEqual(JSON.parse(await readFile(billingPath,'utf8')),changed);
 await page.close();await second.close();
 // Missing file shows a local retry, without Google login or a blank replacement.
 await rename(billingPath,path.join(dir,'saved-billing.json'));
 const missing=await newPage();await missing.goto(url);await missing.locator('#local-startup-status').filter({hasText:'billing file is not available'}).waitFor();assert.equal(await missing.locator('#workspace').isVisible(),false);await assert.rejects(access(billingPath));
 assert.equal(await missing.locator('#connection-dialog').isVisible(),false);assert.equal(writes,0);
 await rename(path.join(dir,'saved-billing.json'),billingPath);await missing.locator('#connect').click();await missing.locator('.patient').waitFor();assert.equal(await missing.locator('#gate').isVisible(),false);
 await missing.screenshot({path:'work/local-startup-synthetic.png',fullPage:true});
 assert.equal(externalRequests,0);assert.equal(writes,0);assert.deepEqual(errors,[]);
 console.log('PASS automatic local startup without Google, billing/notes recovery, explicit lock, competing-tab protection, missing-file retry and stale-revision protection; zero record uploads.');
}finally{
 await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
 assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('trim-local-startup-'));await rm(dir,{recursive:true,force:true});
}
