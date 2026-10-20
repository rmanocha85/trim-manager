import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-cloud-switch-'));
const person={id:'own',name:'SYNTHETIC, Switching',phn:'0000000001',ava:'123456',unit:'cedar',room:'101',codes:'401',extra:{keep:true}};
const roster={patients:[person],otherPatients:[],removedPatients:[],units:[{id:'cedar',name:'CEDAR'}],billingDates:[],extra:{preserved:true}};
const ledger=blankLedger('cloud-switch-synthetic');ledger.baselines['phn:'+person.phn]={date:addDays(today(),-30)};
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));
const local=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});
const publicRoot=path.resolve('public');
const staticRequests=[];
const cloud=http.createServer(async(req,res)=>{staticRequests.push(req.url);try{let file=new URL(req.url,'http://test').pathname.replace(/^\/trim-manager\/public\//,'');if(file===''||file==='/')file='index.html';if(file.includes('..')||file.startsWith('/')||file.startsWith('api/')){res.writeHead(404);return res.end();}const body=await readFile(path.join(publicRoot,file));res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end();}});
await Promise.all([new Promise(r=>local.listen(0,'127.0.0.1',r)),new Promise(r=>cloud.listen(0,'127.0.0.1',r))]);
const cloudURL=`http://127.0.0.1:${cloud.address().port}/trim-manager/public/`,localURL=`http://127.0.0.1:${local.address().port}/?connection=cloud`;
const files=new Map([['1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3',{id:'1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3',name:'trim-patients-data.json',data:structuredClone(roster),version:0}],['ledger',{id:'ledger',name:'trim-billing-data-v1.json',data:structuredClone(ledger),version:0}]]);
let n=0,failNextBilling=false;const writes=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>{globalThis.oauthRequest={prompt:config.prompt,login_hint:config.login_hint};config.callback({access_token:"synthetic"});}})}}};'}));
await context.route('https://www.googleapis.com/**',async route=>{
 const req=route.request(),u=new URL(req.url()),method=req.method(),id=u.pathname.split('/').at(-1);let data={},status=200;
 if(u.pathname==='/drive/v3/about')data={user:{emailAddress:'synthetic@example.test'}};
 else if(u.pathname.includes('/upload/drive/v2/files/')){const file=files.get(id);if(id==='ledger'&&failNextBilling){failNextBilling=false;status=503;}else if(req.headers()['if-match']!==`"v${file.version}"`)status=412;else{file.data=JSON.parse(req.postData());file.version++;writes.push(id);data={id};}}
 else if(u.pathname.includes('/upload/drive/v3/files')){const chunks=req.postData().split('\r\n\r\n'),meta=JSON.parse(chunks[1].split('\r\n--')[0]),body=chunks[2].split('\r\n--')[0];data={id:'generated'+(++n),...meta,version:0,data:JSON.parse(body)};files.set(data.id,data);}
 else if(u.pathname==='/drive/v2/files')data={items:[{id:'ledger'}]};
 else if(u.pathname==='/drive/v3/files'&&method==='POST'){data={id:'folder'+(++n),...JSON.parse(req.postData()),permissions:[{role:'owner',type:'user'}]};files.set(data.id,data);}
 else if(u.pathname==='/drive/v3/files'){const q=u.searchParams.get('q')||'',values=[...files.values()].filter(f=>!f.trashed);let found;if(q.includes('appProperties has'))found=values.filter(f=>f.appProperties?.source==='ledger'&&f.mimeType==='application/vnd.google-apps.folder');else if(q.includes("name = 'TRIM Snapshots'"))found=values.filter(f=>f.name==='TRIM Snapshots');else {const parent=q.match(/^'([^']+)'/)?.[1],name=q.match(/name = '([^']+)'/)?.[1];found=values.filter(f=>f.parents?.includes(parent)&&(!name||f.name===name));}data={files:found};}
 else {const file=files.get(id);if(!file)status=404;else if(method==='PATCH'){Object.assign(file,JSON.parse(req.postData()));data=file;}else if(u.searchParams.get('alt')==='media')data=file.data;else data={...file,etag:`"v${file.version}"`};}
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
});
const page=await context.newPage(),laptop=await context.newPage();for(const p of [page,laptop]){p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());}
const connect=async(p,url)=>{await p.goto(url);await p.locator('#connect').click();await p.locator('#cloud-connect').click();await p.locator('#workspace').waitFor({state:'visible'});};
const saved=p=>p.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const patients=p=>p.locator('#patients-workspace');
const editRoom=async(p,value)=>{await p.locator('[data-section=patients]').click();await patients(p).locator('[data-click="startEdit(\'own\')"]').click();await patients(p).locator('#er-own').fill(value);await patients(p).locator('[data-click="saveEdit(\'own\')"]').click();await p.waitForFunction(()=>!document.querySelector('#sync').disabled);};
try{
 await connect(page,cloudURL);await saved(page);
 assert.deepEqual(await page.evaluate(()=>globalThis.oauthRequest),{prompt:'select_account',login_hint:undefined});
 assert.equal(await page.evaluate(()=>localStorage.getItem('trim:drive-account')),'synthetic@example.test');
 await page.reload();await page.locator('#connect').click();assert.match(await page.locator('#cloud-account').innerText(),/synthetic@example.test/);await page.locator('#cloud-connect').click();await saved(page);
 assert.deepEqual(await page.evaluate(()=>globalThis.oauthRequest),{prompt:'',login_hint:'synthetic@example.test'});
 await page.reload();await page.locator('#connect').click();await page.locator('#cloud-switch-account').click();await saved(page);
 assert.deepEqual(await page.evaluate(()=>globalThis.oauthRequest),{prompt:'select_account',login_hint:undefined});assert.equal(writes.length,0);assert.equal(await page.locator('#local-option').isVisible(),false);
 await page.locator('[data-section=notes]').click();await page.getByRole('heading',{name:'TRIM Notes runs on your laptop'}).waitFor();assert.equal(await page.locator('#notes-input').count(),0);assert.equal(staticRequests.some(s=>/notes-ui|notes-storage|\/api\//.test(s)),false);
 await editRoom(page,'102');assert.equal(files.get('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3').data.patients[0].room,'101');
 await page.locator('[data-section=notes]').click();await page.locator('#open-laptop-notes').click();await page.locator('#switch-version-dialog').waitFor();assert.equal(await page.locator('#switch-version-link').isVisible(),false);await page.locator('#switch-version-close').click();
 await page.locator('[data-section=billing]').click();await page.locator('.patient').first().click();await page.locator('[data-code="00114"]').click();await page.locator('[data-reason-preset="0"]').click();await page.waitForFunction(()=>!document.querySelector('#sync').disabled);
 await page.reload();await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('#workspace').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#sync').disabled);assert.match(await page.locator('#local-changes').innerText(),/Patients, Billing pending/);
 failNextBilling=true;await page.locator('#sync').click();await page.locator('#session-status').filter({hasText:'Patients saved.'}).waitFor();assert.equal(files.get('ledger').data.entries.length,0);assert.match(await page.locator('#session-status').innerText(),/Remaining changes/);await page.locator('#sync').click();await saved(page);assert.equal(files.get('ledger').data.entries.length,1);
 assert.deepEqual(files.get('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3').data.extra,roster.extra);
 // The laptop uses the same real adapter contract, not its potentially stale sync folder.
 await connect(laptop,localURL+'&section=notes');await laptop.locator('#notes-input').waitFor();await saved(laptop);assert.equal(JSON.parse(await readFile(rosterPath,'utf8')).patients[0].room,'101');
 await laptop.locator('[data-section=patients]').click();assert.match(await patients(laptop).locator('#ulist').innerText(),/102/);
 await editRoom(laptop,'103');await laptop.locator('#sync').click();await saved(laptop);
 await laptop.locator('[data-section=settings]').click();await laptop.locator('#parallel').uncheck();await laptop.waitForFunction(()=>!document.querySelector('#sync').disabled);await laptop.locator('#sync').click();await saved(laptop);
 await laptop.locator('[data-section=notes]').click();await laptop.locator('#notes-input').fill('Synthetic note stays on laptop.');await laptop.locator('#notes-confirm').click();await laptop.waitForFunction(()=>!document.querySelector('#sync').disabled);await laptop.locator('#sync').click();await saved(laptop);assert.ok(await readFile(path.join(dir,'notes','patient-context.json'),'utf8'));assert.equal([...files.values()].some(f=>f.name==='patient-context.json'),false);
 await page.reload();await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('#workspace').waitFor({state:'visible'});await saved(page);await page.locator('[data-section=patients]').click();assert.match(await patients(page).locator('#ulist').innerText(),/103/);await page.locator('[data-section=settings]').click();assert.equal(await page.locator('#parallel').isChecked(),false);assert.equal(files.get('ledger').data.entries.length,1);
 // Competing roster edits cannot silently replace the newer version.
 await editRoom(page,'CLOUD');await editRoom(laptop,'LAPTOP');await laptop.locator('#sync').click();await saved(laptop);await page.locator('#sync').click();await page.locator('#session-status').filter({hasText:'changed elsewhere'}).waitFor();assert.equal(files.get('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3').data.patients[0].room,'LAPTOP');
 await patients(page).locator('#btn-connect').click();await saved(page);await page.locator('[data-section=notes]').click();await page.screenshot({path:'work/cloud-notes-synthetic.png',fullPage:true});
 await laptop.close();const folderPage=await context.newPage();folderPage.on('dialog',d=>d.accept());await folderPage.goto('http://127.0.0.1:'+local.address().port+'/');await folderPage.locator('.patient').first().waitFor();await saved(folderPage);await folderPage.locator('#switch-version').click();assert.match(await folderPage.locator('#switch-version-message').innerText(),/Connect through Google/);assert.equal(await folderPage.locator('#switch-version-link').isVisible(),false);
 await folderPage.locator('#switch-version-connect').click();await folderPage.locator('#cloud-connect').click();await folderPage.locator('#connection-error').filter({hasText:'do not match yet'}).waitFor();assert.match(await folderPage.locator('#drive-connection').innerText(),/folder|laptop/i);await folderPage.close();
 assert.equal(staticRequests.some(s=>/notes-ui|notes-storage|\/api\//.test(s)),false);assert.deepEqual(errors,[]);
 console.log('PASS cloud static hosting, Notes laptop-only, encrypted draft recovery, explicit saves, partial failure/retry, cloud→laptop→cloud shared revisions, stale-folder guard, roster conflicts, and local-only Notes writes. Synthetic records and mocked Google API.');
}catch(e){await page.screenshot({path:'work/cloud-switch-failure.png',fullPage:true});console.error(errors);throw e;}finally{await browser.close();for(const s of [cloud,local]){s.closeAllConnections();await new Promise(r=>s.close(r));}assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
