// Isolated synthetic Google account and data. No live patient records.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const patients=[1,2].map(n=>({id:`synthetic-${n}`,phn:String(n).padStart(10,'0'),name:`SYNTHETIC, ${n}`,unit:'test',room:String(n),codes:'401'}));
let cloud=blankLedger('session-synthetic'),revision=1,writes=0,failed=false,lostAck=false;
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1366,height:768}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const syncClick=async()=>{if(!await page.locator('#sync').isEnabled()){await page.locator('#drive-connection').click();await page.locator('#drive-connection:not(:disabled)').waitFor();}if(await page.locator('#sync').isEnabled())await page.locator('#sync').click();};
try{
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"synthetic"})})}}};'}));
 await page.route('https://www.googleapis.com/**',async route=>{const req=route.request(),url=req.url();let data={},status=200;
 if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&url.includes('fields=id,etag'))data={etag:'roster1'};else if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'))data={patients,units:[{id:'test',name:'SYNTHETIC'}]};
 else if(url.includes('/files?q='))data={items:[{id:'synthetic-ledger'}]};
 else if(url.includes('uploadType=media')){if(failed)status=503;else if(req.headers()['if-match']!==`"v${revision}"`)status=412;else{cloud=JSON.parse(req.postData());revision++;writes++;if(lostAck){lostAck=false;await route.abort();return;}}}
 else if(url.includes('alt=media'))data=cloud;else data={id:'synthetic-ledger',etag:`"v${revision}"`};await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/?connection=manual`);
 const connect=async()=>{await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('.patient').first().waitFor();};
 const draft=()=>page.locator('#local-changes').filter({hasText:'pending'}).waitFor();
 const save=async()=>{await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();};
 await connect();await page.locator('.patient').first().click();await page.locator('[data-code="00114"]').click();await page.locator('[data-reason-preset="0"]').click();await page.locator('.patient').nth(1).click();await page.locator('[data-code="14077"]').click();
 const startWheel=page.locator('.inline-time').filter({has:page.locator('[data-field=start]')});await startWheel.locator('[data-wheel=hour]').selectOption('18');await startWheel.locator('[data-wheel=minute]').selectOption('30');await draft();
 assert.equal(await page.locator('[data-field="end"]').inputValue(),'18:40');assert.equal(writes,0);assert.equal(cloud.entries.length,0);
 // Navigation, tab backgrounding and recovery must not upload the session.
 await page.locator('[data-tab="history"]').click();assert.equal(await page.locator('.history-table').first().locator('tbody tr').count(),2);await page.locator('[data-tab="billing"]').click();
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await draft();assert.equal(writes,0);
 await page.reload();await connect();await draft();assert.equal(writes,0);await page.locator('[data-tab="history"]').click();assert.equal(await page.locator('.history-table').first().locator('tbody tr').count(),2);
 await save();assert.equal(writes,1);assert.equal(cloud.entries.length,2);assert.equal(cloud.entries[0].items[0].diagnosis,'959');assert.equal(cloud.entries[1].items[0].end,'18:40');
 // Failure locks editing, preserves draft, and explicit retry writes it once.
 await page.locator('[data-tab="billing"]').click();await page.locator('.patient').first().click();await page.locator('[data-field="reason"]').fill('SYNTHETIC retained detail');await draft();failed=true;await syncClick();await page.locator('#session-status').filter({hasText:'Remaining changes'}).waitFor();assert.equal(await page.locator('[data-code="00114"]').isEnabled(),false);assert.equal(writes,1);failed=false;await save();assert.equal(writes,2);assert.equal(cloud.entries[0].items[0].reason,'SYNTHETIC retained detail');
 // A server save with a lost response clears safely on retry, without duplicating upload.
 await page.locator('[data-field="reason"]').fill('SYNTHETIC acknowledged later');await draft();lostAck=true;await syncClick();await page.locator('#session-status').filter({hasText:'Remaining changes'}).waitFor();assert.equal(writes,3);await save();assert.equal(writes,3);
 // Actual concurrent changes cannot be overwritten by the session.
 await page.locator('.patient').first().click();await page.locator('[data-field="reason"]').fill('SYNTHETIC local conflict');await draft();cloud.entries[0].items[0].reason='SYNTHETIC remote change';revision++;await syncClick();await page.locator('#session-status').filter({hasText:'Remaining changes'}).waitFor();assert.equal(writes,3);assert.equal(cloud.entries[0].items[0].reason,'SYNTHETIC remote change');assert.equal(await page.locator('[data-code="00114"]').isEnabled(),false);assert.deepEqual(errors,[]);
 console.log('PASS session saving: multiple patients/codes/times, no click/background/recovery uploads, one explicit save, failed-save retry, lost acknowledgement recovery, genuine-conflict protection.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
