// Synthetic read-only History rendering. Never connects to real Google data.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const patients=[1,2,3].map(n=>({id:`synthetic-${n}`,key:`phn:${String(n).padStart(10,'0')}`,phn:String(n).padStart(10,'0'),name:`SYNTHETIC, ${n}`,unit:'test',room:String(n),codes:'401',panel:true}));
let ledger=blankLedger('history-order-synthetic');
for(const [i,p] of patients.entries()){
 ledger=upsertEntry(ledger,p,i===2?'2026-09-22':'2026-10-08',[{code:'00114',units:1}]);
 ledger.entries.at(-1).createdAt=`2026-10-08T${10+i}:00:00Z`;
}
ledger.entries[0].updatedAt='2026-10-08T23:00:00Z';
const original=structuredClone(ledger),errors=[];let writes=0;
const server=createServer({chatgpt:{status:async()=>({connected:false,planEnabled:false})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
try{
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"synthetic"})})}}};'}));
 await page.route('https://www.googleapis.com/**',async route=>{
  const req=route.request(),url=req.url();if(req.method()!=='GET'){if(url.includes('/files/synthetic-ledger'))writes++;await route.abort();return;}
  const data=url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&url.includes('fields=id,etag')?{etag:'roster1'}:url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')?{patients,units:[]} :url.includes('/files?q=')?{items:[{id:'synthetic-ledger'}]} :url.includes('alt=media')?ledger:{id:'synthetic-ledger',etag:'"v1"'};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/?connection=manual`);await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('.patient').first().waitFor();
 await page.locator('[data-section="billing"]').click();await page.locator('[data-tab=history]').click();const rows=page.locator('.history-table').first().locator('tbody tr');
 assert.deepEqual(await rows.locator('td:nth-child(2)').allTextContents(),['SYNTHETIC, 2','SYNTHETIC, 1','SYNTHETIC, 3']);
 assert.equal(await rows.first().locator('td').first().textContent(),'Thu, Oct 8, 2026');
 assert.equal(await rows.last().locator('td').first().textContent(),'Tue, Sep 22, 2026');
 assert.match(await page.locator('#history-content').innerText(),/Newest billing date first/);
 await page.locator('.history-table [data-history-patient]').filter({hasText:'SYNTHETIC, 3'}).first().click();
 assert.equal(await page.locator('.history-table tbody tr').first().locator('td').first().textContent(),'Tue, Sep 22, 2026');
 assert.equal(writes,0);assert.deepEqual(ledger,original);assert.deepEqual(errors,[]);
 console.log('PASS History newest-billing-date ordering, same-day and backdated entries, actual date preserved, no billing writes.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
