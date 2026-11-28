import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';import {createServer} from './server-fixture.mjs';import {blankLedger,upsertEntry,today,addDays} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-history-scroll-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const p={id:'one',key:'phn:0000000001',name:'EXAMPLE, ALEX',phn:'0000000001',unit:'test',room:'1',codes:'401',panel:true};let ledger=blankLedger('history-scroll');
for(let i=0;i<70;i++)ledger=upsertEntry(ledger,p,addDays(today(),-i),[{code:'00114',units:1}]);
const original=JSON.stringify(ledger);await writeFile(billingPath,original);await writeFile(rosterPath,JSON.stringify({patients:[p],otherPatients:[],removedPatients:[],units:[{id:'test',name:'TEST'}],billingDates:[]}));
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'test.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);await page.route('https://**/*',r=>r.abort());
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')&&(u.pathname==='/'||/\.(mjs|css|html)$/.test(u.pathname))){const r=await fetch(process.env.TRIM_ASSET_BASE+(u.pathname==='/'?'index.html':u.pathname.slice(1))+u.search);assert.ok(r.ok);await route.fulfill({status:200,contentType:r.headers.get('content-type'),body:await r.text()});}else await route.fallback();});
const scroll=()=>page.evaluate(()=>({window:scrollY,workspace:document.querySelector('#workspace').scrollTop}));
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor();await page.locator('[data-tab=history]').click();await page.locator('#history-date-clear').click();await page.locator('.history-table tbody tr').first().waitFor();
 // App hosts may lock document scrolling. History must own a scroll container.
 await page.addStyleTag({content:'html,body{height:100%;overflow:hidden}'});
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#workspace').scrollTop=0;});await page.mouse.move(width-50,700);const before=await scroll();await page.mouse.wheel(0,700);
  await page.waitForFunction(before=>scrollY>before.window||document.querySelector('#workspace').scrollTop>before.workspace,before,{timeout:3000});
  const end=page.locator('.history-table tbody tr').last();await end.scrollIntoViewIfNeeded();const box=await end.boundingBox();assert.ok(box.y+box.height<=900-45,'Last billing reachable above footer');
 }
 assert.equal(await readFile(billingPath,'utf8'),original);assert.deepEqual(errors,[]);console.log('PASS long Billing History wheel scrolling and reachable last row on desktop, tablet and mobile; no billing writes.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),os.tmpdir());await rm(dir,{recursive:true,force:true});}
