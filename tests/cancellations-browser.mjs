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

 await connect();await page.locator('.patient').first().click();await page.locator('[data-code="00114"]').click();await page.locator('[data-reason-preset="1"]').click();
 await page.locator('[data-code="13121"]').click();await page.locator('[data-code="14077"]').click();
 const card=code=>page.locator('.code-details').filter({has:page.locator('[data-remove-code="'+code+'"]')});
 assert.equal(await card('13121').locator('[data-field=diagnosis]').inputValue(),'038.9');
 assert.equal(await card('14077').locator('[data-field=diagnosis]').inputValue(),'038.9');
 assert.equal(await page.locator('.inline-time-picker:visible').count(),4);
 assert.equal(await card('00114').locator('h3').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(45, 90, 61)');
 assert.equal(await card('00114').locator('h3').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
 assert.equal(await card('13334').locator('h3').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(230, 231, 229)');
 assert.equal(await card('00114').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(248, 248, 246)');
 assert.equal(await card('13121').locator('[data-field=start]').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 assert.equal(await page.locator('#item-details').evaluate(e=>getComputedStyle(e).gap),'24px');
 assert.equal(await page.locator('.bonus-banner').isVisible(),false);
 await page.locator('#editor').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'work/defined-cards-desktop.png'});
 assert.match(await card('14077').locator('[data-field=start]').inputValue(),/^\d{2}:[0-5]0$/);
 await card('13121').locator('[data-field=diagnosis]').fill('485');await page.locator('[data-reason-preset="2"]').click();
 assert.equal(await card('13121').locator('[data-field=diagnosis]').inputValue(),'485');
 assert.equal(await card('14077').locator('[data-field=diagnosis]').inputValue(),'786.2');
 const wheel=card('14077').locator('.inline-time').filter({has:page.locator('[data-field=start]')});
 await wheel.locator('[data-wheel=hour]').selectOption('18');await wheel.locator('[data-wheel=minute]').selectOption('30');
 assert.equal(await card('14077').locator('[data-field=end]').inputValue(),'18:40');
 assert.equal(await card('14077').locator('.inline-time').filter({has:page.locator('[data-field=end]')}).locator('[data-wheel=minute]').inputValue(),'40');
 await draft();assert.equal(writes,0);
 await page.locator('#local-changes').click();assert.equal(await page.locator('#changes-list [data-cancel-code]').count(),4);
 await page.locator('#changes-list [data-cancel-code="13121"]').click();assert.equal(await page.locator('#changes-list [data-cancel-code]').count(),3);
 await page.locator('#changes-list [data-undo-cancel]').click();assert.equal(await page.locator('#changes-list [data-cancel-code]').count(),4);
 await page.screenshot({path:'work/cancel-code-review.png'});
 await page.locator('#changes-dialog').getByRole('button',{name:'Close',exact:true}).click();await save();
 assert.equal(cloud.entries[0].items.length,4);assert.equal(cloud.entries[0].items.find(i=>i.code==='13121').diagnosis,'485');
 // Saved, not handed-over history supports per-code removal and explicit save.
 await page.locator('[data-tab=history]').click();
 assert.equal(await page.locator('[data-history-code]').count(),4);
 assert.equal(await page.locator('.history-code').filter({has:page.locator('[data-history-code="14077"]')}).locator('.history-code-time').innerText(),'Start 18:30 · End 18:40');
 const family=cloud.entries[0].items.find(i=>i.code==='13121');
 assert.equal(await page.locator('.history-code').filter({has:page.locator('[data-history-code="13121"]')}).locator('.history-code-time').innerText(),`Start ${family.start} · End ${family.end}`);
 assert.equal(await page.locator('.history-code').filter({has:page.locator('[data-history-code="00114"]')}).locator('.history-code-time').count(),0);
 await page.locator('[data-history-code="13121"]').click();assert.equal(await page.locator('[data-history-code]').count(),3);assert.equal(cloud.entries[0].items.length,4);
 await page.locator('[data-history-undo]').click();assert.equal(await page.locator('[data-history-code]').count(),4);
 await page.locator('[data-history-remove]:not([data-history-code])').click();assert.equal(await page.locator('[data-history-code]').count(),0);
 await page.locator('[data-history-undo]').click();assert.equal(await page.locator('[data-history-code]').count(),4);
 await page.screenshot({path:'work/history-direct-removal.png'});
 await context.setOffline(true);assert.equal(await page.locator('[data-history-code]').first().isEnabled(),false);await context.setOffline(false);
 await page.locator('[data-history]').first().click();
 await card('14077').locator('[data-remove-code]').click();await draft();assert.equal(cloud.entries[0].items.length,4);
await page.locator('#local-changes').click();assert.equal(await page.locator('#changes-list [data-cancel-code]').count(),3);assert.match(await page.locator('#changes-list').innerText(),/Before local changes/);
 await page.locator('#changes-dialog').getByRole('button',{name:'Close',exact:true}).click();await save();assert.equal(cloud.entries[0].items.some(i=>i.code==='14077'),false);
 // Removing a qualifying visit also removes its now-orphaned bonus, not conference.
 await card('00114').locator('[data-remove-code]').click();assert.equal(await page.locator('.code-details').count(),1);assert.equal(await card('13121').count(),1);
 await page.locator('.undo-removal').click();assert.equal(await page.locator('.code-details').count(),3);
 // Independently cancelling a bonus must not cause it to be reinserted.
 await card('13334').locator('[data-remove-code]').click();await card('00114').locator('[data-field=reason]').fill('SYNTHETIC amended');assert.equal(await card('13334').count(),0);await save();
 assert.deepEqual(cloud.entries[0].items.map(i=>i.code),['00114','13121']);
 await page.screenshot({path:'work/cancel-code-editor.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1366,height:768});
 // Remove all, retain recoverable draft across reload, undo then save.
 await page.locator('#remove-entry').click();await draft();assert.equal(cloud.entries.length,1);
 await page.reload();await connect();await page.locator('#local-changes').click();assert.match(await page.locator('#changes-list').innerText(),/Will be removed from Drive/);
 await page.locator('#changes-list [data-undo-cancel]').click();assert.equal(await page.locator('#changes-list [data-undo-cancel]').count(),0);
 await page.locator('#changes-dialog').getByRole('button',{name:'Close',exact:true}).click();await save();assert.equal(cloud.entries.length,1);
 assert.deepEqual(errors,[]);console.log('PASS code cancellation: separate review rows, individual/all removal, orphan bonus cleanup, Undo/recovery, history editing, manual diagnosis preservation, primary inheritance, visible wheels, explicit saving, responsive layout.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
