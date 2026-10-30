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
files.get('ledger').parents=['trim-ai'];
for(const [id,name,parent]of [['trim-ai','TRIM AI',null],['working','Working records','trim-ai'],['notes-root','Routine notes','working'],['incoming','Incoming','notes-root']])files.set(id,{id,name,parents:parent?[parent]:[],mimeType:'application/vnd.google-apps.folder',permissions:[{role:'owner',type:'user'}],version:0});
let n=0,failNextBilling=false,failUpload=true;const writes=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>{globalThis.oauthRequest={prompt:config.prompt,login_hint:config.login_hint};config.callback({access_token:"synthetic"});}})}}};'}));
await context.route('https://www.googleapis.com/**',async route=>{
 const req=route.request(),u=new URL(req.url()),method=req.method(),id=u.pathname.split('/').at(-1);let data={},status=200;
 if(u.pathname==='/drive/v3/about')data={user:{emailAddress:'synthetic@example.test'}};
 else if(u.pathname.includes('/upload/drive/v2/files/')){const file=files.get(id);if(id==='ledger'&&failNextBilling){failNextBilling=false;status=503;}else if(req.headers()['if-match']!==`"v${file.version}"`)status=412;else{file.data=JSON.parse(req.postData());file.version++;writes.push(id);data={id};}}
 else if(u.pathname==='/drive/v3/files/generateIds')data={ids:['reserved'+(++n)]};
 else if(u.pathname.includes('/upload/drive/v3/files')){const chunks=req.postData().split('\r\n\r\n'),meta=JSON.parse(chunks[1].split('\r\n--')[0]),body=chunks[2].split('\r\n--')[0];data={...meta,version:0,raw:body,data:meta.mimeType==='application/json'?JSON.parse(body):null};files.set(data.id,data);writes.push(data.id);if(failUpload){failUpload=false;status=503;}}
 else if(u.searchParams.get('alt')==='media'&&files.get(id)?.raw!==undefined)return route.fulfill({contentType:files.get(id).mimeType,body:files.get(id).raw});
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
 await connect(page,cloudURL);await saved(page);await page.waitForTimeout(200);writes.length=0;failUpload=true;await page.locator('.patient').first().click();await page.locator('#editor [data-upload-patient]').click();
 await page.locator('[data-intake-input]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nsynthetic document\n%%EOF')});await page.locator('[data-intake-upload]').click();await page.locator('[data-intake-message]').filter({hasText:'503'}).waitFor();assert.equal([...files.values()].filter(f=>f.mimeType==='application/pdf').length,1);
 await page.locator('[data-intake-upload]').click();await page.locator('.intake-job').filter({hasText:'Uploaded to Drive'}).waitFor();assert.equal([...files.values()].filter(f=>f.mimeType==='application/pdf').length,1);assert.equal([...files.values()].filter(f=>f.name?.startsWith('intake-')).length,1);assert.equal(writes.length,2);assert.deepEqual(files.get('ledger').data,ledger);assert.deepEqual(files.get('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3').data,roster);assert.equal(await page.locator('[data-accept-intake]').count(),0);assert.deepEqual(errors,[]);console.log('PASS cloud document upload to private existing folder, binary read-back, interrupted response retry without duplication, queued local analysis and unchanged patient/billing data.');
}catch(e){console.log(await page.locator("#document-intake").innerText(),errors,writes);throw e;}finally{await browser.close();local.closeAllConnections();cloud.closeAllConnections();await Promise.all([new Promise(r=>local.close(r)),new Promise(r=>cloud.close(r))]);await rm(dir,{recursive:true,force:true});}
