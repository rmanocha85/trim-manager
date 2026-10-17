// Isolated synthetic Chrome only; no real account or patient information.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry,heldKey,heldImports} from '../public/core.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
const p={id:'synthetic',key:'phn:0000000001',phn:'0000000001',name:'SYNTHETIC, Example',unit:'cedar',room:'101',panel:true};
const source=upsertEntry(blankLedger('synthetic-import'),p,'2026-09-22',[{code:'00114',units:1}]);
source.historicalBillings=[{id:'history',patientKey:p.key,date:'2026-09-01',codes:['00114'],status:'already_billed',sources:[{file:'SYNTHETIC.pdf',page:2}]}];
source.baselines[p.key]={date:'2026-09-01'};
source.importReview={held:[{date:'2026-09-25',name:p.name,status:'held_not_imported',reason:'<script>invalid()</script>',source:{file:'SYNTHETIC.pdf',page:3}}]};
const file={name:'SYNTHETIC-import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))};
let ledger=null,revision=1,uploads=0,saves=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"synthetic-token"})})}}};'}));
 await page.route('https://www.googleapis.com/**',async route=>{
  const req=route.request(),url=req.url();let data={},status=200;
  if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&url.includes('fields=id,etag'))data={etag:'roster1'};else if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'))data={patients:[p],units:[{id:'cedar',name:'CEDAR',floor:1}]};
  else if(url.includes('generateIds'))data={ids:['synthetic-billing']};
  else if(url.includes('uploadType=multipart')&&!req.postData().includes('trim-billing-data-v1.json')){status=403;}else if(url.includes('uploadType=multipart')){uploads++;ledger=JSON.parse(req.postData().split('Content-Type: application/json\r\n\r\n')[1].split('\r\n--')[0]);data={id:'synthetic-billing'};}
  else if(url.includes('uploadType=media')){if(req.headers()['if-match']!==`"v${revision}"`)status=412;else{ledger=JSON.parse(req.postData());revision++;saves++;}}
  else if(url.includes('/files?q='))data={items:ledger?[{id:'synthetic-billing'}]:[]};
  else if(url.includes('alt=media'))data=ledger;
  else data={id:'synthetic-billing',etag:`"v${revision}"`};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/?connection=manual`);
 await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('#setup-import').click();
 await page.locator('#import-file').setInputFiles(file);await page.getByText('1 already billed · 1 in the current batch · 1 starting dates · 1 held for clarification.',{exact:true}).waitFor();assert.equal(uploads,0);
 await page.locator('#import-apply').click();await page.getByText('Import prepared locally:',{exact:false}).waitFor();assert.equal(saves,0);await page.locator('#sync').click();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(uploads,1);assert.equal(saves,1);assert.equal(ledger.entries.length,1);assert.equal(ledger.historicalBillings.length,1);assert.equal(ledger.imports[0].review.held.length,1);
 assert.equal(await page.locator('#history-content script').count(),0);
 await page.locator('[data-section="settings"]').click();await page.locator('#open-import').click();await page.locator('#import-file').setInputFiles(file);await page.getByText('This package is already loaded.',{exact:false}).waitFor();assert.equal(await page.locator('#import-apply').isEnabled(),false);await page.locator('#import-close').click();
 await page.reload();await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('.patient').waitFor();assert.equal(uploads,1);assert.equal(ledger.entries.length,1);
 await page.locator('#service-date').evaluate((el,value)=>el.value=value,'2026-09-01');await page.locator('#service-date').dispatchEvent('change');await page.locator('.patient').click();await page.getByText('Already billed on this date. No new charge can be added.',{exact:true}).waitFor();assert.equal(await page.locator('[data-code="00114"]').isEnabled(),false);
 const correction=upsertEntry(blankLedger('synthetic-clarification'),p,'2026-09-25',[{code:'00114',units:1,reason:'Physician clarified'}]);correction.historicalBillings=[];correction.importReview={held:[],resolutions:[{key:heldKey(source.importReview.held[0]),disposition:'included',reason:'Confirmed by physician',entryId:correction.entries[0].id}]};
 await page.locator('[data-section="settings"]').click();await page.locator('#open-import').click();await page.locator('#import-file').setInputFiles({name:'SYNTHETIC-clarification.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(correction))});await page.getByText('1 prior held items resolved.',{exact:false}).waitFor();await page.locator('#import-apply').click();await page.locator('#import-dialog').waitFor({state:'hidden'});await page.getByRole('heading',{name:'Held for clarification · 0',exact:true}).waitFor();await page.locator('#sync').click();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(ledger.entries.length,2);assert.equal(heldImports(ledger).length,0);assert.equal(ledger.imports.length,2);assert.equal(ledger.historicalBillings.length,1);
 assert.deepEqual(errors,[]);console.log('PASS synthetic import: first setup, safe save, duplicate protection, immutable history and additive clarification resolution.');
}catch(e){console.log('IMPORT STATUS',await page.locator('#session-status').innerText(),await page.locator('#notice').innerText(),await page.locator('#connection-error').innerText(),errors);throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
