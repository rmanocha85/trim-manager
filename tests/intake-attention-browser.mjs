import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Exercise the actual intake UI/CSS with synthetic read-only responses. No worker,
// patient document, Drive credential, or production data store is used.
const root=path.resolve(process.env.TRIM_ASSET_ROOT||'public');
let queue={jobs:[],requests:[],service:{}},offline=false;
const calls=[],errors=[];
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://test');calls.push([req.method,u.pathname]);res.setHeader('Cache-Control','no-store');
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(u.pathname==='/api/connect')return json(200,{csrf:'synthetic'});
 if(u.pathname==='/api/intake')return json(offline?503:200,offline?{error:'Synthetic connection unavailable'}:queue);
 if(u.pathname==='/api/patient-display')return json(404,{error:'Synthetic display not needed'});
 if(u.pathname.startsWith('/api/'))return json(405,{error:'Writes forbidden in visual test'});
 if(['/', '/public/'].includes(u.pathname)){
  res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./styles.css"><link rel="stylesheet" href="./shell.css"><link rel="stylesheet" href="./patient-identity.css"></head><body><main style="padding:24px"><h1>Synthetic intake status test</h1></main><div class="app-utility"></div></body></html>');
 }
 const file=u.pathname.replace(/^\/public\//,'').replace(/^\//,'');
 if(file.includes('..')||!/^[-a-z0-9.]+$/.test(file))return json(404,{});
 try{const body=process.env.TRIM_ASSET_BASE?await (async()=>{const r=await fetch(process.env.TRIM_ASSET_BASE+file+u.search);assert.ok(r.ok);return Buffer.from(await r.arrayBuffer());})():await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'});res.end(body);}catch{json(404,{});}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));await mkdir('work',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const job=(status,extra={})=>({id:'00000000-0000-4000-8000-000000000001',datasetId:'synthetic-intake',status,files:[{name:'synthetic-status.pdf'}],message:'Synthetic '+status+' status',...extra});
const request=(status,extra={})=>({id:'00000000-0000-4000-8000-000000000002',datasetId:'synthetic-intake',status,createdAt:'2026-11-11T12:00:00Z',issues:[],items:[],message:'Synthetic '+status+' request',...extra});
try{
 for(const mode of ['web','laptop']){
  queue={jobs:[],requests:[],service:{}};offline=false;
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+(mode==='web'?'/public/':'/'));
  await page.evaluate(async mode=>{
   globalThis.intakeTimers=new Map();let id=0;globalThis.setInterval=(fn,ms)=>{intakeTimers.set(++id,{fn,ms});return id;};globalThis.clearInterval=id=>intakeTimers.delete(id);
   const {DriveIntake}=await import('./intake-drive.mjs?v=20261111-incoming1');
   const read=async()=>{const r=await fetch('/api/intake');const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
   DriveIntake.prototype.list=async()=> (await read()).jobs;DriveIntake.prototype.incomingRequests=async()=> (await read()).requests;
   const {documentIntakeUI}=await import('./intake-ui.mjs?v=20261111-intake-alert1');
   globalThis.intake=documentIntakeUI({state:()=>({adapter:{mode:mode==='web'?'cloud':'local'},ledger:{datasetId:'synthetic-intake'},people:[]}),notes:{}});
  },mode);
  const indicator=page.locator('#document-intake-queue');
  const tick=()=>page.evaluate(async()=>{await [...intakeTimers.values()].find(t=>t.ms===15000).fn();});
  const attention=async expected=>assert.equal(await indicator.evaluate(el=>el.classList.contains('intake-attention')),expected);
  const red=async el=>{await el.filter({hasText:/\S/}).waitFor();assert.equal(await el.evaluate(el=>getComputedStyle(el).color),'rgb(161, 38, 34)');};
  await tick();await attention(false);assert.equal(await indicator.innerText(),'Document intake');
  for(const status of ['held','error','identity-review','waiting']){
   queue.jobs=[job(status,status==='waiting'?{attempts:1}:{})];await tick();await attention(true);await red(indicator);assert.match(await indicator.innerText(),/needs attention/);if(status==='held'){await page.screenshot({path:'work/intake-indicator-'+mode+'.png',fullPage:true});await indicator.hover();assert.equal(await indicator.evaluate(el=>getComputedStyle(el).color),'rgb(139, 30, 26)');await page.mouse.move(0,0);}
   await indicator.click();const card=page.locator('[data-intake-status="'+status+'"]');assert.equal(await card.getAttribute('data-intake-attention'),'true');assert.match(await card.innerText(),/Needs attention/);await red(card.locator('p').first());
   if(status==='held'){
    await page.screenshot({path:'work/intake-attention-'+mode+'.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'work/intake-attention-'+mode+'-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
   }
   queue.jobs=[job('accepted')];await page.locator('[data-refresh-incoming]').click();await page.locator('[data-intake-status=accepted]').waitFor();assert.equal(await page.locator('[data-intake-status=accepted]').getAttribute('data-intake-attention'),'false');await attention(false);await page.locator('[data-intake-close]').click();
  }
  queue.jobs=[job('held',{datasetId:'another-synthetic-workspace'})];await tick();await attention(false);
  queue.jobs=[];
  for(const item of [request('attention'),request('processing',{issues:['Synthetic unsupported source']}),request('processing',{items:[{status:'attention',name:'Synthetic source',message:'Synthetic problem'}]})]){
   queue.requests=[item];await tick();await attention(true);await indicator.click();const card=page.locator('[data-incoming-status]');await red(card);assert.match(await card.innerText(),/Needs attention/);
   queue.requests=[request('completed')];await page.locator('[data-refresh-incoming]').click();await page.locator('[data-incoming-status=completed]').waitFor();await attention(false);await page.locator('[data-intake-close]').click();
  }
  queue={jobs:[job('waiting')],requests:[request('queued')],service:{}};await tick();await attention(false);assert.match(await indicator.innerText(),/processing/);
  if(mode==='laptop'){
   queue.service.error='Synthetic service issue';await tick();await attention(true);await indicator.click();await red(page.locator('[data-intake-message]'));queue.service={};await page.locator('[data-refresh-incoming]').click();await page.waitForFunction(()=>!document.querySelector('[data-intake-message]').classList.contains('error'));await attention(false);await page.locator('[data-intake-close]').click();
  }
  offline=true;await tick();await attention(true);assert.match(await indicator.innerText(),/connection needed/);await indicator.click();await red(page.locator('[data-intake-message]'));offline=false;queue={jobs:[],requests:[],service:{}};await page.locator('[data-refresh-incoming]').click();await page.waitForFunction(()=>!document.querySelector('[data-intake-message]').classList.contains('error'));await attention(false);assert.equal(await indicator.getAttribute('title'),'');await page.locator('[data-intake-close]').click();
  await page.evaluate(()=>intake.open({name:'Synthetic, Visual',phn:'0000000001'}));
  await page.locator('[data-intake-input]').setInputFiles({name:'synthetic.exe',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic')});await red(page.locator('[data-intake-message]'));assert.match(await page.locator('[data-intake-message]').innerText(),/Choose PDF/);
  await page.locator('[data-intake-input]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic visual only')});assert.equal(await page.locator('[data-intake-message]').getAttribute('class'),'');
  assert.equal(await page.locator('[data-intake-files] li').count(),1);await page.locator('[data-remove-file]').click();await page.locator('[data-intake-close]').click();await tick();await page.screenshot({path:'work/intake-recovered-'+mode+'.png',fullPage:true});await page.close();
  console.log('PASS '+mode+': actual indicator/dialog warnings, held/error/identity/retrying, request problems, ordinary waiting, dataset isolation, connection/service recovery, validation recovery, desktop/mobile.');
 }
 assert.deepEqual(errors,[]);assert.equal(calls.some(([method,url])=>method!=='GET'&&url!=='/api/connect'),false);
 console.log('PASS synthetic visual tests: no intake, note, billing or Drive writes.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
