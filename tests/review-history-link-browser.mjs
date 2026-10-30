// Isolated synthetic data only. No live Drive writes or user tabs.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const old={id:'synthetic',key:'roster:synthetic',name:'EXAMPLE, Alex',phn:'',ava:'synthetic-ava',unit:'a',room:'100',codes:'V66.7'};
const p={...old,key:'phn:0000000001',phn:'0000000001',panel:true};
let cloud=upsertEntry(blankLedger('synthetic-only'),p,'2026-10-10',[{code:'00127',units:1,diagnosis:'V66.7'}]);
cloud=upsertEntry(cloud,p,'2026-09-22',[{code:'14077',units:1,diagnosis:'V66.7'}]);
cloud.patients[old.key]=old;
cloud.baselines[p.key]={date:'2026-09-19',identityCorrection:{previousPatientKey:old.key,rosterId:old.id,previousPhn:'',correctedPhn:p.phn,confirmedInChat:true}};
cloud.historicalBillings=['2026-09-05','2026-09-19'].map((date,n)=>({id:'synthetic-old-'+n,patientKey:old.key,date,status:'already_billed',codes:['00114'],sources:[]}));
const before=structuredClone(cloud),errors=[];let writes=0;
const server=createServer({chatgpt:{status:async()=>({connected:false,planEnabled:false})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1366,height:900},timezoneId:'America/Los_Angeles'}),page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
await context.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"synthetic"})})}}};'}));
await context.route('https://www.googleapis.com/**',async route=>{
 const req=route.request(),url=req.url();let data={id:'synthetic-ledger',etag:'"v1"'};
 if(url.includes('uploadType=media')){writes++;throw new Error('Unexpected cloud write');}
 if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&url.includes('fields=id,etag'))data={etag:'roster1'};else if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'))data={patients:[p],units:[{id:'a',name:'Example North'}]};
 else if(url.includes('/files?q='))data={items:[{id:'synthetic-ledger'}]};
 else if(url.includes('alt=media'))data=cloud;
 await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
});
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/?connection=manual');
 await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('.patient').first().waitFor();
 assert.equal(await page.locator('#billing-review-badge').innerText(),'★ 1');
 assert.match(await page.locator('[data-tab=review]').getAttribute('aria-label'),/1 item needs attention/);
 await page.locator('[data-section="billing"]').click();await page.locator('[data-tab=history]').click();await page.locator('#history-by-patient').click();
 await page.locator('#history-search').fill('EXAMPLE');assert.equal(await page.locator('#history-patient-results [data-history-patient]').count(),1);
 await page.locator('#history-patient-results [data-history-patient]').click();assert.equal(await page.locator('#history-content tbody tr').count(),4);
 assert.match(await page.locator('#history-content').innerText(),/Sep 5, 2026/);assert.match(await page.locator('#history-content').innerText(),/Sep 19, 2026/);
 assert.match(await page.locator('#history-patient-summary').innerText(),/Oct 10, 2026/);
 await page.locator('#history-by-date').click();await page.locator('[data-history-patient="roster:synthetic"]').first().click();
 assert.equal(await page.locator('#history-content tbody tr').count(),4);assert.equal(await page.locator('#history-patient-results [data-history-patient]').count(),1);
 await page.locator('[data-section="billing"]').click();await page.locator('[data-tab=review]').click();
 assert.equal(await page.locator('#review-issues [data-review-entry]').count(),1);
 assert.match(await page.locator('#review-issues').innerText(),/Sep 22, 2026/);
 assert.doesNotMatch(await page.locator('#review-issues').innerText(),/portal|reason required/);
 await page.screenshot({path:'work/billing-review-preview.png',fullPage:true});
 await page.locator('[data-review-entry]').click();assert.match(await page.locator('#header-date-value').innerText(),/Sep 22, 2026/);
 await page.locator('[data-field=start]').fill('13:00');await page.locator('[data-field=end]').fill('13:10');
 await page.locator('#billing-review-badge').waitFor({state:'hidden'});
 assert.equal(await page.locator('[data-tab=review]').getAttribute('aria-label'),'Billing review');
 await page.locator('[data-field=end]').fill('');await page.locator('#billing-review-badge').waitFor({state:'visible'});
 assert.equal(await page.locator('#billing-review-badge').innerText(),'★ 1');
 await page.locator('[data-section="settings"]').click();assert.equal(await page.locator('#portal-confirm').count(),0);
 await page.locator('[data-section="billing"]').click();await page.locator('[data-tab=review]').click();await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(writes,0);assert.deepEqual(cloud,before);assert.deepEqual(errors,[]);
 console.log('PASS linked history, legacy-name navigation, immutable records, all-date review, direct review navigation, no portal control, optional 127 reason, mobile layout, zero Drive writes.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
