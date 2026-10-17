// All network requests intercepted; synthetic records only. No live user tabs.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const p={id:'synthetic',key:'phn:0000000001',name:'EXAMPLE, Backup',phn:'0000000001',unit:'a',room:'100',codes:'V66.7',panel:true};
let cloud=upsertEntry(blankLedger('synthetic-backup-only'),p,'2026-10-10',[{code:'00127',units:1,diagnosis:'V66.7'}]);cloud.updatedAt='2026-10-10T18:00:00.000Z';
const original=structuredClone(cloud),files=new Map(),errors=[];let n=0,writes=0,delayBackups=false;
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await context.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"synthetic"})})}}};'}));
await context.route('https://www.googleapis.com/**',async route=>{
 const req=route.request(),url=new URL(req.url());let data,status=200;
 if(url.pathname.includes('/upload/drive/v2/')){assert.equal(req.headers()['if-match'],'"v'+cloud.revision+'"');cloud=JSON.parse(req.postData());writes++;data={id:'ledger'};}
 else if(url.pathname.includes('/upload/drive/v3/')){
   if(delayBackups)await new Promise(r=>setTimeout(r,1800));
   const sections=req.postData().split('\r\n\r\n'),meta=JSON.parse(sections[1].split('\r\n--')[0]),text=sections[2].split('\r\n--')[0];data={id:'snapshot'+(++n),...meta};files.set(data.id,{...data,text});
 }else if(url.pathname.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&url.searchParams.has('fields'))data={etag:'roster1'};else if(url.pathname.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'))data={patients:[p],units:[{id:'a',name:'Example'}]};
 else if(url.pathname==='/drive/v2/files')data={items:[{id:'ledger'}]};
 else if(url.pathname==='/drive/v2/files/ledger')data=url.searchParams.get('alt')==='media'?cloud:{id:'ledger',etag:'"v'+cloud.revision+'"'};
 else if(url.pathname==='/drive/v3/files'&&req.method()==='POST'){data={id:'folder'+(++n),permissions:[{role:'owner',type:'user'}],...JSON.parse(req.postData())};files.set(data.id,data);}
 else if(url.pathname==='/drive/v3/files'){
   const q=url.searchParams.get('q');const values=[...files.values()].filter(f=>!f.trashed);
   data={files:q.includes('appProperties has')?values.filter(f=>f.mimeType==='application/vnd.google-apps.folder'&&f.appProperties?.source==='ledger'):values.filter(f=>f.parents?.includes(q.match(/^'([^']+)'/)?.[1]))};
 }else if(url.pathname==='/drive/v3/files/ledger')data={id:'ledger',name:'trim-billing-data-v1.json',parents:['inaccessible-parent']};
 else if(url.pathname==='/drive/v3/files/inaccessible-parent'){status=403;data={error:'scoped parent'};}
 else {const id=url.pathname.split('/').at(-1),f=files.get(id);if(!f){status=404;data={};}else if(req.method()==='PATCH'){Object.assign(f,JSON.parse(req.postData()));data=f;}else if(url.searchParams.get('alt')==='media')return route.fulfill({contentType:'application/json',body:f.text});else data=f;}
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
});
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/?connection=manual');await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('.patient').first().waitFor();
 await page.locator('[data-section="settings"]').click();await page.locator('aside nav button').filter({hasText:/^Backups/}).click();
 await page.waitForFunction(()=>document.querySelector('#backup-state').textContent.includes('Drive backup verified'));
 assert.equal([...files.values()].filter(f=>f.text).length,1);assert.equal(writes,0);assert.deepEqual(cloud,original);
 await page.locator('#backup-retry').click();await page.waitForFunction(()=>document.querySelector('#backup-state').textContent.includes('Drive backup verified'));assert.equal([...files.values()].filter(f=>f.text).length,1);
 await page.locator('[data-section="billing"]').click();await page.locator('[data-tab=history]').click();await page.locator('[data-history-remove]').first().click();
 delayBackups=true;await page.locator('#sync').click();await page.waitForFunction(()=>document.querySelector('#local-changes').textContent.includes('No local changes'));
 assert.equal(writes,1);assert.equal(cloud.entries.length,0);
 assert.match(await page.locator('#backup-state').textContent(),/Backing up in background/);
 // Editing/navigation remains available while the deliberately slow backup runs.
 await page.locator('[data-section="billing"]').click();await page.locator('[data-tab=billing]').click();assert.equal(await page.locator('#search').isEnabled(),true);
 assert.equal(await page.locator('.patient').first().isEnabled(),true);
 await page.locator('[data-section="settings"]').click();await page.locator('aside nav button').filter({hasText:/^Backups/}).click();await page.waitForFunction(()=>document.querySelector('#backup-state').textContent.includes('Drive backup verified'));
 delayBackups=false;
 await page.locator('#backup-settings summary').click();await page.locator('#backup-list').click();await page.waitForFunction(()=>document.querySelector('#backup-choice').options.length===3);
 await page.locator('#backup-choice').selectOption('1');await page.locator('#backup-preview').click();await page.waitForFunction(()=>!document.querySelector('#backup-restore').disabled);
 assert.match(await page.locator('#backup-preview-info').textContent(),/1 patient\/date entries/);
 await page.locator('#backup-restore').click();await page.waitForFunction(()=>document.querySelector('#backup-restore').disabled);assert.equal(cloud.entries.length,1);assert.equal(writes,2);
 assert.deepEqual(cloud.entries,original.entries);
 await page.waitForFunction(()=>document.querySelector('#backup-state').textContent.includes('Drive backup verified'));
 // Use a browser-owned synthetic directory to exercise real handle persistence,
 // local file writes and reload/catch-up without accessing the user's filesystem.
 await page.evaluate(async()=>{const directory=await (await navigator.storage.getDirectory()).getDirectoryHandle('synthetic-backups',{create:true});await (await import('./recovery.mjs?v=20261012-backup1')).setBackupDirectory(directory);});
 await page.reload();await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('.patient').first().waitFor();
 await page.locator('[data-section="settings"]').click();await page.locator('aside nav button').filter({hasText:/^Backups/}).click();
 await page.waitForFunction(()=>document.querySelector('#backup-state').textContent.includes('Drive + laptop backups verified'));
 const localCount=await page.evaluate(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('synthetic-backups');let n=0;for await(const name of d.keys())n++;return n;});assert.equal(localCount,3);
 await page.screenshot({path:'work/backups-settings-preview.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: cloud setup with restricted folder scope, verified snapshots, deduplication, no ledger write on connection, non-blocking slow backup, full-file preview/restore with safety copy.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
