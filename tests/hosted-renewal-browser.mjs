import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {APP_ORIGIN} from '../drive-renewal/service.mjs';
import {RENEWAL_ORIGIN} from '../public/hosted-billing-access.mjs';

const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const context=await browser.newContext(), page=await context.newPage();
 const start=APP_ORIGIN+'/trim-manager/public/';
 let prompts=0, renewals=0, exchanges=0, writes=0, alternateAccount=false, interrupt=false, signedOut=false, force401=false;
 const synthetic=(body,status=200,headers={})=>({status,contentType:'application/json',headers,body:JSON.stringify(body)});
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url()), request=route.request();
   if(url.origin===APP_ORIGIN && url.pathname.startsWith('/trim-manager/public/')){
     const file=url.pathname.split('/').pop()||'index.html';
     if(file==='index.html'){
       const published=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
       const csp=published.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
       return route.fulfill({contentType:'text/html',body:csp+'<button id="connect">Connect</button>'});
     }
     if(!/^[\w.-]+$/.test(file))return route.abort();
     return route.fulfill({contentType:file.endsWith('.html')?'text/html':'text/javascript',body:await readFile(new URL('../public/'+file,import.meta.url))});
   }
   if(url.origin==='https://accounts.google.com'){
     prompts++;
     assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
     const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');
     return route.fulfill({contentType:'text/html',body:'<meta http-equiv="refresh" content="0;url='+callback.href+'">'});
   }
   if(url.origin===RENEWAL_ORIGIN){
     const headers={'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'content-type,x-trim-binding','Access-Control-Allow-Methods':'POST'};
     if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
     if(url.pathname==='/exchange'){exchanges++;headers['Set-Cookie']='__Host-trim-billing=synthetic; Path=/; Secure; HttpOnly; SameSite=None; Partitioned';}
     if(url.pathname==='/renew'){
       const cookies=await request.headerValue('cookie');
       if(!cookies?.includes('__Host-trim-billing=synthetic')) return route.fulfill(synthetic({error:'missing cookie'},401,headers));
       if(interrupt)return route.fulfill(synthetic({error:'Temporary outage'},503,headers));
       renewals++;
     }
     if(url.pathname==='/logout')signedOut=true;
     return route.fulfill(synthetic({access_token:'access-'+renewals,expires_in:3600,email:alternateAccount?'other@example.test':'doctor@example.test'},200,headers));
   }
   if(url.origin==='https://www.googleapis.com'){
     if(request.method()==='PUT')writes++;
     const headers={'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,PUT'};
     if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
     if(force401){force401=false;return route.fulfill(synthetic({},401,headers));}
     return route.fulfill(synthetic({ok:true},200,headers));
   }
   return route.abort();
 });
 const setup=async()=>{await page.goto(start);await page.evaluate(async()=>{
   const {DriveAdapter}=await import('./adapters.mjs');
   window.a=new DriveAdapter('synthetic');document.querySelector('button').onclick=()=>{window.result=a.connect().then(()=>true,e=>e.message);};
 });};
 const connected=()=>page.evaluate(()=>Promise.race([window.result,new Promise(resolve=>setTimeout(()=>resolve('Test sign-in timed out.'),15000))]));
 await setup();await page.click('button');assert.equal(await connected(),true);
 assert.equal(exchanges,1);assert.equal(prompts,1);assert.equal(renewals,1);
 await page.evaluate(async()=>{a.expiresAt=1;await Promise.all([a.ensureConnected(),a.ensureConnected()]);await a.request('https://www.googleapis.com/example',{method:'PUT'});});
 assert.equal(renewals,2);assert.equal(prompts,1);assert.equal(writes,1);
 force401=true;await page.evaluate(()=>a.request('https://www.googleapis.com/example'));assert.equal(renewals,3);
 force401=true;assert.equal(await page.evaluate(()=>a.request('https://www.googleapis.com/example',{method:'PUT'}).catch(e=>e.status)),401);assert.equal(writes,2);
 interrupt=true;assert.equal(await page.evaluate(()=>a.ensureConnected().catch(e=>e.status)),503);assert.equal(prompts,1);
 interrupt=false;await setup();await page.click('button');assert.equal(await page.evaluate(()=>window.result),true);assert.equal(exchanges,1);
 alternateAccount=true;assert.match(await page.evaluate(async()=>{a.expiresAt=0;a.authExpired=true;return a.ensureConnected().catch(e=>e.message);}),/different billing account/);
 await page.evaluate(()=>a.hostedAccess.lock());assert.equal(signedOut,true);assert.equal(await page.evaluate(()=>a.hostedAccess.saved),false);assert.equal(prompts,1);
 console.log('PASS Chrome hosted consent, cookie persistence, popup-free renewal, safe writes, concurrent requests, temporary failure, reload, account guard and lock.');
} finally {await browser.close();}
