// Synthetic local records and intercepted reads only. No production data or Google calls.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'maid-loading-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),maidPath=path.join(dir,'maid.json');
const records={schemaVersion:1,patients:[{id:'one',name:'Synthetic One',phn:'0000000001',status:'active'},{id:'two',name:'Synthetic Two',phn:'0000000002',status:'history'}]};
const original=JSON.stringify(records);
await Promise.all([writeFile(rosterPath,JSON.stringify({patients:[],otherPatients:[],removedPatients:[],units:[],billingDates:[]})),writeFile(billingPath,JSON.stringify(blankLedger('maid-loading'))),writeFile(maidPath,original)]);
const server=createServer({rosterPath,billingPath,maidPath,lockPath:path.join(dir,'lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
let release,gate=new Promise(r=>release=r),reads=0,fail=false,empty=false;
await page.route('**/api/maid/roster',async route=>{assert.equal(route.request().method(),'GET');reads++;const waiting=gate,failed=fail,result=empty?{...records,patients:[]}:records;if(waiting)await waiting;await route.fulfill({status:failed?503:200,contentType:'application/json',body:JSON.stringify(failed?{error:'Synthetic connection interrupted'}:{roster:result,etag:'synthetic-v1'})});});
const m=page.locator('#maid-workspace');
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/?section=maid`);
 await m.getByRole('heading',{name:'Loading MAID patients…'}).waitFor();
 await m.getByRole('button',{name:'History',exact:true}).click();await m.getByRole('searchbox').fill('Synthetic');
 assert.equal(await m.getByRole('heading',{name:'Loading MAID patients…'}).isVisible(),true);
 assert.doesNotMatch(await m.innerText(),/Waiting for your patient list|0 of 0 patients/);
 await page.locator('[data-section="billing"]').click();await page.locator('[data-section="maid"]').click();assert.equal(reads,1);
 gate=null;release();await m.locator('tbody tr').waitFor();assert.match(await m.locator('tbody').innerText(),/Synthetic Two/);
 await m.getByRole('searchbox').fill('');await m.getByRole('button',{name:'Active',exact:true}).click();
 fail=true;await m.getByRole('button',{name:'Reload MAID'}).click();await m.locator('.clinic-load-status').filter({hasText:'Synthetic connection interrupted'}).waitFor();
 assert.equal(await m.locator('tbody tr').count(),1);assert.equal(await m.getByRole('button',{name:'Move to History',exact:true}).isDisabled(),true);
 await m.getByRole('button',{name:'History',exact:true}).click();await m.getByRole('searchbox').fill('no match');
 assert.equal(await m.getByRole('heading',{name:'MAID roster could not load'}).isVisible(),true);assert.match(await m.innerText(),/Synthetic connection interrupted/);assert.doesNotMatch(await m.innerText(),/Waiting for your patient list/);
 // Entering MAID retries, without requiring a manual reload or rewriting a record.
 fail=false;await m.getByRole('searchbox').fill('');await page.locator('[data-section="billing"]').click();await page.locator('[data-section="maid"]').click();
 await m.getByRole('button',{name:'Move to Active',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#maid-workspace .clinic-row-actions button')?.disabled===false);
 assert.equal(await m.locator('.clinic-load-status').isVisible(),false);
 // A stalled read times out; its late response must not replace a newer successful load.
 await page.evaluate(()=>{const original=setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===30000?100:ms,...args);});
 gate=new Promise(r=>release=r);await m.getByRole('button',{name:'Reload MAID'}).click();await m.locator('.clinic-load-status').filter({hasText:'too long'}).waitFor();
 assert.equal(await m.locator('tbody tr').count(),1);
 empty=true;gate=null;await m.getByRole('button',{name:'Reload MAID'}).click();await m.getByRole('heading',{name:'No MAID patients',exact:true}).waitFor();
 release();await page.waitForTimeout(150);assert.equal(await m.locator('tbody tr').count(),0);
 empty=false;await m.getByRole('button',{name:'Reload MAID'}).click();await m.locator('tbody tr').waitFor();
 assert.deepEqual(errors,[]);assert.equal(await readFile(maidPath,'utf8'),original);
 console.log('PASS MAID initial loading, persistent errors through filters/search, retained read-only rows, navigation retry, deduplicated loads, timeout, late-response rejection, genuine empty state and unchanged records.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
