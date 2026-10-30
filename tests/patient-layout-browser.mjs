// Synthetic records only: compact roster, aligned header, and editable 127 defaults.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays,rosterView,normalizeRoster,upsertEntry} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-patient-layout-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const patients=Array.from({length:4},(_,i)=>({id:'sample-'+i,name:['Example, Alex','Sample, Jordan','Demo, Casey','Existing, Diagnosis'][i],phn:String(i+1).padStart(10,'0'),ava:String(123456+i),unit:'cedar',room:String(1401+i),codes:'401',pFlag:i===0,notesDataUploaded:i===1,notesDataUploadedAt:i===1?'2026-10-01T12:00:00Z':null}));
patients[0].hospitalStays=[{id:'synthetic-stay',admittedDate:addDays(today(),-2),returnedDate:null,updatedAt:new Date().toISOString()}];
const roster={patients,otherPatients:[{...patients[0],id:'coverage',name:'Coverage, Example',phn:'0000000005',ava:'123460',notesDataUploaded:false}],removedPatients:[],units:[{id:'cedar',name:'CEDAR'}],billingDates:[]};
const date=today();let ledger=blankLedger('patient-layout-synthetic');
for(const p of patients)ledger.baselines['phn:'+p.phn]={date:addDays(date,-30)};
const existing=rosterView(normalizeRoster(roster),ledger).find(p=>p.phn===patients[3].phn);
ledger=upsertEntry(ledger,existing,date,[{code:'00127',units:1,diagnosis:'250'}]);
ledger=upsertEntry(ledger,existing,addDays(date,-1),[{code:'00127',units:1}]);
const originalEntries=structuredClone(ledger.entries);
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept());await context.route('https://**/*',r=>r.abort());await mkdir('work',{recursive:true});
const p=s=>page.locator('#patients-workspace').locator(s),section=s=>page.locator(`[data-section="${s}"]`).click();
const saved=()=>page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
const ready=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled);
const save=async()=>{await ready();await page.locator('#sync').click();await saved();};
const readBilling=async()=>JSON.parse(await readFile(billingPath,'utf8'));
const select=async phn=>{await page.locator('#search').fill(phn);await page.locator('.patient').click();};
const diagnosis=()=>page.locator('.code-details').filter({has:page.locator('[data-remove-code="00127"]')}).locator('[data-field=diagnosis]');
const row=p('#ulist tbody tr').first();
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.patient').first().waitFor();await saved();
 assert.deepEqual(await page.locator('.app-sections button').allTextContents(),['Roster','Billing','Notes']);
 for(const name of ['patients','billing','notes']){
   await section(name);const footer=await page.locator('.app-utility').boundingBox();assert.equal(footer.y+footer.height,1000);
   await section('settings');assert.equal(await page.locator('#settings').isVisible(),true);assert.equal(await page.locator('#calendar').isVisible(),false);assert.equal(await page.locator('.app-sections [aria-pressed=true]').count(),0);
 }
 await section('patients');
 assert.equal(await p('[data-notes-upload],.notes-upload-help').count(),0);
 assert.equal(await p('.stats-row').first().innerText().then(t=>t.includes('DATE SLOTS')),false);assert.equal(await p('.tabs-bar').innerText().then(t=>t.includes('Print dates')),false);
 const name=row.locator('.pnm'),flag=row.locator('.pflag');
 const copy=row.locator('.phn-copy');assert.equal(await copy.count(),1);await copy.click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patients[0].phn);
 assert.equal(await row.locator('.pnm .hospital-dates').count(),1);
 const nameBox=await name.boundingBox(),hospitalBox=await row.locator('.hospital-dates').boundingBox();assert.ok(Math.abs((nameBox.y+nameBox.height/2)-(hospitalBox.y+hospitalBox.height/2))<3);assert.ok(hospitalBox.x>nameBox.x);
 assert.ok((await row.boundingBox()).height<=38);
 // Stage a reversible row edit to verify save locking and upload metadata preservation.
 await row.getByRole('button',{name:'Edit',exact:true}).click();await p('#ec-sample-0').fill('401 250');await row.getByRole('button',{name:'Save',exact:true}).click();await ready();
 let release,started;const entered=new Promise(r=>started=r),held=new Promise(r=>release=r);
 await page.route('**/api/roster/document',async route=>{if(route.request().method()==='PUT'){started();await held;}await route.continue();});
 await page.locator('#sync').click();await entered;assert.equal(await page.locator('.app-utility').evaluate(e=>e.inert),true);release();await saved();await page.unroute('**/api/roster/document');
 const savedRoster=JSON.parse(await readFile(rosterPath,'utf8'));assert.equal(savedRoster.patients[1].notesDataUploaded,true);assert.equal(savedRoster.patients[1].notesDataUploadedAt,roster.patients[1].notesDataUploadedAt);
 await p('[data-click="showTab(\'other-patients\',this)"]').click();assert.equal(await p('[data-notes-upload]').count(),0);assert.equal(await p('#other-list tbody tr').first().locator('.phn-copy').count(),1);
 await p('[data-click="showTab(\'patients\',this)"]').click();
 for(const width of [1440,1280,1024,768,390,360]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`horizontal overflow at ${width}`);
   const buttons=page.locator('#workspace>header .header-actions button:visible');const boxes=await buttons.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};}));
   assert.ok(boxes.every(b=>b.h===40&&b.x>=0&&b.right<=width),JSON.stringify({width,boxes}));
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a.right<=b.x+.5||b.right<=a.x+.5||a.bottom<=b.y+.5||b.bottom<=a.y+.5,JSON.stringify({width,a,b}));}
   const header=await page.locator('#workspace>header').boundingBox();assert.ok(boxes.every(b=>b.bottom<=header.y+header.height),JSON.stringify({width,header,boxes}));
   assert.equal(await page.locator('#workspace>header .brand').count(),0);
   await page.screenshot({path:`work/patient-layout-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});await section('billing');await select(patients[0].phn);
 await page.locator('#roster .billing-phn-copy').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patients[0].phn);
 assert.equal(await page.locator('.editor-date').isVisible(),true);assert.match(await page.locator('.editor-date').innerText(),/Billing for/i);
 await page.locator('[data-day="'+addDays(date,-1)+'"]').click();await page.locator('#load-latest').click();await page.waitForFunction(()=>!document.querySelector('#load-latest').disabled);assert.equal(await page.locator('#service-date').inputValue(),date);
 await page.locator('[data-code="00127"]').click();assert.equal(await diagnosis().inputValue(),'V66.7');assert.equal(await diagnosis().isEditable(),true);
 await diagnosis().fill('V66.8');await ready();await section('settings');await section('billing');await select(patients[0].phn);assert.equal(await diagnosis().inputValue(),'V66.8');
 await page.reload();await page.locator('.patient').first().waitFor();await ready();await select(patients[0].phn);assert.equal(await diagnosis().inputValue(),'V66.8');await save();
 assert.equal((await readBilling()).entries.find(e=>e.patientKey==='phn:'+patients[0].phn).items.find(i=>i.code==='00127').diagnosis,'V66.8');
 await page.locator('[data-tab=routine]').click();await select(patients[1].phn);await page.locator('[data-code="00127"]').click();assert.equal(await diagnosis().inputValue(),'V66.7');await save();
 // Custom full-code entry uses the same default. Clearing the field stays cleared.
 await section('billing');await page.locator('[data-tab=billing]').click();await select(patients[2].phn);await page.locator('.other-codes summary').click();await page.locator('#custom-code').fill('00127');await page.locator('#add-code').click();assert.equal(await diagnosis().inputValue(),'V66.7');
 await diagnosis().fill('');await ready();await save();await select(patients[3].phn);assert.equal(await diagnosis().inputValue(),'250');
 await page.locator('#entry-comment').fill('Synthetic additional comment');await save();assert.equal(await diagnosis().inputValue(),'250');
 const final=await readBilling();assert.deepEqual(final.entries.find(e=>e.id===originalEntries[1].id),originalEntries[1]);assert.equal(final.entries.find(e=>e.patientKey==='phn:'+patients[2].phn).items.find(i=>i.code==='00127').diagnosis,'');
 assert.deepEqual(errors,[]);console.log('PASS bottom Settings across sections and save lock; compact inline hospital status, upload indicators removed with metadata preserved, PHN copy, header alignment at six widths; new 127 defaults in Concern/Routine/custom entry, editable values preserved and historical billing untouched.');
}catch(e){await page.screenshot({path:'work/patient-layout-failure.png',fullPage:true});throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
