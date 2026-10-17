import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry,today} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),dir=await mkdtemp(path.join(os.tmpdir(),'trim-print-')),date=today();
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),p={id:'p',name:'SYNTHETIC, Print',phn:'0000000001',ava:'123456',unit:'cedar',room:'1',codes:'401',panel:true,key:'phn:0000000001'};
let ledger=upsertEntry(blankLedger('print-synthetic'),p,date,[{code:'00114',units:1,reason:'Synthetic concern',diagnosis:'401'}]);ledger.settings.parallel=false;await writeFile(rosterPath,JSON.stringify({patients:[p],units:[{id:'cedar',name:'CEDAR'}]}));await writeFile(billingPath,JSON.stringify(ledger));
const server=createServer({rosterPath,billingPath,lockPath:path.join(dir,'lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(10000);
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.patient').waitFor();await page.locator('[data-tab="reports"]').click();
 for(const id of ['batch-from','batch-to'])await page.locator('#'+id).evaluate((e,d)=>{e.value=d;e.dispatchEvent(new Event('change'));},date);
 await page.locator('#rules-reviewed').check();await page.locator('#generate').click();await page.frameLocator('#report-frame').locator('body').filter({hasText:'SYNTHETIC, Print'}).waitFor();
 await page.screenshot({path:'work/unified-print-batch-synthetic.png',fullPage:true});
 await page.locator('#report-frame').evaluate(frame=>{frame.contentWindow.print=()=>{};});await page.locator('#print-report').click();await page.locator('[data-close="report-dialog"]').click();
 await page.locator('#finalize').click();await page.locator('#local-changes').filter({hasText:'Billing pending'}).waitFor();assert.equal(JSON.parse(await readFile(billingPath,'utf8')).batches.length,0);
 await page.locator('#sync').click();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();const saved=JSON.parse(await readFile(billingPath,'utf8'));assert.equal(saved.batches.length,1);assert.ok(saved.entries[0].batchId);
 await page.locator('[data-tab="history"]').click();assert.equal(await page.locator('[data-history-remove]').count(),0);
 await page.reload();await page.locator('.patient').waitFor();await page.locator('.patient').click();assert.equal(await page.locator('[data-code="00114"]').isDisabled(),true);assert.deepEqual(errors,[]);
 console.log('PASS printable batch, report verification, explicit local finalization then Save to Drive, immutable handed-over records after reload.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
