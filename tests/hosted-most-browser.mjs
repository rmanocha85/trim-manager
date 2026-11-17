import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage();
 const origin='https://rmanocha85.github.io/trim-manager/public/';
 await page.route('**/*',async route=>{
   const url=route.request().url();
   if(!url.startsWith(origin))return route.abort();
   const name=new URL(url).pathname.split('/').pop();
   if(!name)return route.fulfill({contentType:'text/html',body:'<div class="app-utility"></div>'});
   return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../public/'+name,import.meta.url))});
 });
 await page.goto(origin);
 const result=await page.evaluate(async()=>{
   const {documentIntakeUI,PROFILE_FILE_ID}=await import('./intake-ui.mjs');
   const {withProfile}=await import('./profile-display.mjs?v=20261113-history1');
   const patient={phn:'0000000001',mostStatus:'CPR C2'};
   let mode='valid',release,started,status;
   const adapter={mode:'cloud',hostedAccess:{},request:async url=>{
     if(!url.includes('/files/'+PROFILE_FILE_ID+'?'))throw Error('Unexpected file');
     if(mode==='denied')throw Object.assign(Error('Link required'),{status:403});
     if(url.includes('fields='))return {name:'patient-display.json',permissions:[{role:'owner',type:'user'}]};
     if(mode==='slow'){started();await new Promise(resolve=>release=resolve);}
     return {app:'trim-patient-display',schema:1,mostSchema:1,datasetId:mode==='wrong'?'other':'synthetic',patients:{[patient.phn]:{structuredMost:true,mostStatus:'DNACPR M3'}}};
   }};
   const ui=documentIntakeUI({state:()=>({adapter,ledger:{datasetId:'synthetic'}}),notes:{},onProfileStatus:(message,action)=>{status=[message,action]}});
   const results=[];
   await ui.profiles();results.push(withProfile(patient).mostStatus);
   mode='slow';const waiting=new Promise(resolve=>started=resolve);const old=ui.profiles();await waiting;
   mode='denied';await ui.profiles();release();await old;results.push(status[1],withProfile({phn:patient.phn}).mostStatus);
   mode='wrong';await ui.profiles();results.push(status[1],withProfile({phn:patient.phn}).mostStatus);
   mode='valid';await ui.profiles();results.push(status[0],withProfile(patient).mostStatus);
   return results;
 });
 assert.deepEqual(result,['DNACPR M3','link','','retry','','','DNACPR M3']);
 console.log('PASS hosted MOST read, saved value precedence, file link, wrong workspace, stale response and retry.');
}finally{await browser.close();}
