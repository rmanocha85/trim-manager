import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {RENEWAL_ORIGIN} from '../public/hosted-billing-access.mjs';

// Exercise real OAuth callback, renewal, adapter, profile loader and row renderer.
// All network traffic is intercepted; no live patient data or Google grants.
const origin='https://rmanocha85.github.io',base=origin+'/trim-manager/public/';
const fileId='1UEPiPwQyd9wMswfem8lL6LIKwMn_ST3r';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const context=await browser.newContext(),page=await context.newPage();
 let picked=false,grant=false,reportPicked=true,grantOnPick=true,mode='valid',prompts=0,renewals=0;
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'authorization,content-type,x-trim-binding','Access-Control-Allow-Methods':'GET,POST'};
 const json=(route,data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin){
   const name=url.pathname.split('/').pop();
   if(!name)return route.fulfill({contentType:'text/html',body:'<div class="app-utility"></div><button id="link">Link MOST</button><div id="row"></div><div id="status"></div>'});
   return route.fulfill({contentType:name.endsWith('.html')?'text/html':'text/javascript',body:await readFile(new URL('../public/'+name,import.meta.url))});
  }
  if(url.origin==='https://accounts.google.com'){
   prompts++;assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');
   picked=url.searchParams.get('file_ids')===fileId;
   if(picked)assert.equal(url.searchParams.get('trigger_onepick'),'true');
   const callback=new URL(url.searchParams.get('redirect_uri'));
   callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');
   if(picked&&reportPicked)callback.searchParams.set('picked_file_ids',fileId);
   return route.fulfill({contentType:'text/html',body:'<meta http-equiv="refresh" content="0;url='+callback.href+'">'});
  }
  if([RENEWAL_ORIGIN,'https://www.googleapis.com'].includes(url.origin)&&route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
  if(url.origin===RENEWAL_ORIGIN){
   if(url.pathname==='/exchange'&&picked&&grantOnPick)grant=true;
   if(url.pathname==='/renew')renewals++;
   return json(route,{access_token:'synthetic-access',expires_in:3600,email:'doctor@example.test'});
  }
  if(url.origin==='https://www.googleapis.com'){
   assert.equal(route.request().method(),'GET','The MOST workflow must be read-only.');
   assert.equal(url.pathname,'/drive/v3/files/'+fileId);
   if(!grant)return json(route,{error:'notFound'},404);
   if(mode==='offline')return json(route,{error:'unavailable'},503);
   if(url.searchParams.has('fields'))return json(route,{id:fileId,name:'patient-display.json',trashed:false,permissions:[{role:'owner',type:'user'}]});
   return json(route,{app:'trim-patient-display',schema:1,mostSchema:1,datasetId:mode==='wrong'?'other':'synthetic',patients:{'0000000001':{structuredMost:true,mostStatus:'DNACPR M3'}}});
  }
  return route.abort();
 });
 async function setup(){
  await page.goto(base);
  await page.evaluate(async()=>{
   const {DriveAdapter}=await import('./adapters.mjs');
   const {documentIntakeUI,PROFILE_FILE_ID}=await import('./intake-ui.mjs');
   const {demographicsHTML}=await import('./patient-identity.mjs?v=20261119-most-connection1');
   window.a=new DriveAdapter('synthetic-ledger');
   const patient={phn:'0000000001',mostStatus:'CPR C2'};
   window.ui=documentIntakeUI({state:()=>({adapter:a,ledger:{datasetId:'synthetic'}}),notes:{},
    onProfiles:()=>document.querySelector('#row').innerHTML=demographicsHTML(patient),
    onProfileStatus:(message)=>document.querySelector('#status').textContent=message});
   document.querySelector('#link').onclick=()=>{window.result=(async()=>{
    if(!a.hostedAccess)await a.connect();
    await a.hostedAccess.authorize({hint:a.accountEmail,pickFileId:PROFILE_FILE_ID});
    await a.connect({interactive:false});await ui.profiles({required:true});return true;
   })().catch(e=>e.message);};
  });
 }
 const link=async()=>{await page.click('#link');return page.evaluate(()=>window.result);};
 await setup();
 // Establish a normal billing session without a profile grant.
 await page.evaluate(async()=>{document.querySelector('#link').onclick=()=>{window.result=a.connect().then(()=>ui.profiles());};});
 assert.equal(await link(),false);
 assert.match(await page.locator('#row').innerText(),/MOST unavailable/);
 assert.doesNotMatch(await page.locator('#row').innerText(),/CPR C2/,'Do not resurrect an older roster value when clinical data fails.');
 await setup();await page.evaluate(async()=>{await a.connect({interactive:false});await ui.profiles();});
 const promptsBefore=prompts;
 reportPicked=false;assert.match(await link(),/required file was not selected/);assert.equal(grant,false);
 reportPicked=true;grantOnPick=false;assert.match(await link(),/still cannot read/);assert.equal(grant,false);
 grantOnPick=true;assert.equal(await link(),true);assert.match(await page.locator('#row').innerText(),/DNACPR M3/);
 assert.equal(prompts,promptsBefore+3);
 const linkedPrompts=prompts;
 // Destroy all in-memory objects. The regular renewed grant must still load MOST.
 await setup();await page.evaluate(async()=>{await a.connect({interactive:false});await ui.profiles();});
 assert.match(await page.locator('#row').innerText(),/DNACPR M3/);assert.equal(prompts,linkedPrompts);
 const beforeRenewal=renewals;
 await page.evaluate(async()=>{a.expiresAt=1;await ui.profiles();});
 assert.ok(renewals>beforeRenewal);assert.equal(prompts,linkedPrompts);
 mode='offline';assert.equal(await page.evaluate(()=>ui.profiles()),false);assert.match(await page.locator('#row').innerText(),/MOST unavailable/);
 mode='wrong';assert.match(await page.evaluate(()=>ui.profiles({required:true}).catch(e=>e.message)),/not synced/);
 mode='valid';assert.equal(await page.evaluate(()=>ui.profiles()),true);assert.match(await page.locator('#row').innerText(),/DNACPR M3/);
 console.log('PASS MOST missing grant, picker cancellation, ungranted selection, renewed file verification, fresh page, expiry, outage, workspace mismatch and recovery.');
}finally{await browser.close();}
