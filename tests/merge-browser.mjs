// Isolated synthetic Drive + two independent browser profiles; no live data.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const patients=[1,2,3].map(n=>({id:`synthetic-${n}`,phn:String(n).padStart(10,'0'),name:`SYNTHETIC, ${n}`,unit:'test',room:String(n),codes:'401'}));
let cloud=blankLedger('merge-synthetic'),revision=1,writes=0,failedLoad=false,failedSave=false,race=false;
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const pages=await Promise.all(contexts.map(c=>c.newPage())),errors=[];
const [a,b]=pages;
try{
 for(const page of pages){
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"synthetic"})})}}};'}));
  await page.route('https://www.googleapis.com/**',async route=>{const req=route.request(),url=req.url();let data={},status=200;
   if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&url.includes('fields=id,etag'))data={etag:'roster1'};else if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'))data={patients,units:[{id:'test',name:'SYNTHETIC'}]};
   else if(url.includes('/files?q='))data={items:[{id:'synthetic-ledger'}]};
   else if(url.includes('uploadType=media')){if(race){race=false;cloud.settings.portalYears=['2026'];revision++;}if(failedSave)status=503;else if(req.headers()['if-match']!==`"v${revision}"`)status=412;else{cloud=JSON.parse(req.postData());revision++;writes++;}}
   else if(url.includes('alt=media')){if(failedLoad)status=503;else data=cloud;}else data={id:'synthetic-ledger',etag:`"v${revision}"`};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?connection=manual`);
 }
 const connect=async p=>{await p.locator('#connect').click();await p.locator('#cloud-connect').click();await p.locator('.patient').first().waitFor();};
 const edit=async(p,n,reason)=>{await p.locator(`.patient[data-patient="phn:${String(n).padStart(10,'0')}"]`).click();if(!await p.locator('[data-field=reason]').count())await p.locator('[data-code="00114"]').click();await p.locator('[data-field=reason]').fill(reason);await p.locator('#local-changes').filter({hasText:'pending'}).waitFor();};
 const save=async p=>{await p.locator('#sync').click();await p.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();};
 await connect(a);await connect(b);await edit(a,1,'Laptop');await edit(b,2,'Desktop');await save(a);assert.equal(writes,1);
 await b.reload();await connect(b);await b.locator('#conflict-actions:not([hidden])').waitFor();await b.locator('#conflict-save').click();await b.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(writes,2);assert.equal(cloud.entries.length,2);assert.equal(cloud.entries.flatMap(e=>e.items).filter(i=>i.code==='13334').length,1);
 // Both computers edit the same charge. Only one choice, not a duplicate.
 await a.locator('#drive-connection').click();await a.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();await edit(a,1,'Laptop newer');await edit(b,1,'Desktop newer');await save(a);await b.locator('#sync').click();await b.locator('#merge-dialog[open]').waitFor();assert.equal(writes,3);assert.equal(await b.locator('#merge-list article').count(),1);
 await b.screenshot({path:'work/merge-choice-desktop.png'});
 await b.setViewportSize({width:390,height:844});assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await b.locator('#merge-dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);await b.setViewportSize({width:1280,height:720});
 await b.locator('#merge-list input[value=local]').check();await b.locator('#merge-save').click();await b.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(writes,4);assert.equal(cloud.entries.length,2);assert.equal(cloud.entries.find(e=>e.patientKey.endsWith('1')).items[0].reason,'Desktop newer');
 // Failed save retains the merged session; retry makes one successful upload.
 await edit(b,3,'Retain on failure');failedSave=true;await b.locator('#sync').click();await b.locator('#session-status').filter({hasText:'Remaining changes'}).waitFor();assert.equal(writes,4);failedSave=false;await save(b);assert.equal(writes,5);assert.equal(cloud.entries.length,3);
 // Conditional save still protects a change between read and upload.
 await edit(b,3,'Racing save');race=true;await b.locator('#sync').click();await b.locator('#session-status').filter({hasText:'Remaining changes'}).waitFor();assert.equal(writes,5);await save(b);assert.equal(writes,6);assert.deepEqual(cloud.settings.portalYears,['2026']);
 // Discard fetch failure leaves draft intact; success writes nothing to Drive.
 await edit(b,3,'Discard me');await b.locator('#local-changes').click();failedLoad=true;await b.locator('#changes-discard').click();await b.waitForFunction(()=>!document.getElementById('changes-discard').disabled);assert.equal(writes,6);
 const recovery=await b.evaluate(async()=>await(await import('/recovery.mjs')).loadRecovery('merge-synthetic'));assert.equal(recovery.dirty,true);assert.equal(recovery.ledger.entries.find(e=>e.patientKey.endsWith('3')).items[0].reason,'Discard me');
 failedLoad=false;await b.locator('#changes-discard').click();await b.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(writes,6);await b.reload();await connect(b);assert.equal(await b.locator('#billing-lock').isVisible(),false);assert.equal(await b.locator('#local-changes').innerText(),'✓ No local changes');
 assert.deepEqual(errors,[]);console.log('PASS two-computer merge: recovered additions, bonus deduplication, explicit same-charge choice, failed save retry, racing ETag, safe discard, zero discard uploads.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
