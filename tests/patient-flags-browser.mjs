import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays,normalizeRoster,rosterView,upsertEntry} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-flags-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const person=n=>({id:'sample-'+n,name:['','Example, Alex','Sample, Jordan','Coverage, Casey','Coverage, Taylor'][n],phn:String(n).padStart(10,'0'),ava:String(123456+n),unit:n===2?'cherry':'cedar',room:String(1500+n),codes:'401',pFlag:n===1,extra:{keep:true}});
const roster={patients:[person(1),person(2)],otherPatients:[{...person(3),doctor:'Dr. Adam Siemens'},{...person(4),doctor:'Dr. Tarun Soni'}],removedPatients:[],units:[{id:'cedar',name:'CEDAR'},{id:'cherry',name:'CHERRY'}],billingDates:[]};
let ledger=blankLedger('flags-synthetic');for(const p of roster.patients)ledger.baselines['phn:'+p.phn]={date:addDays(today(),-30)};
ledger=upsertEntry(ledger,rosterView(normalizeRoster(roster),ledger)[0],addDays(today(),-30),[{code:'00114',units:1,diagnosis:'401',reason:'Synthetic history'}]);
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));await mkdir('work',{recursive:true});
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],dialogs=[];
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{if(d.type()==='beforeunload')return d.accept();dialogs.push(d.message());await d.dismiss();});
await page.route('https://**/*',r=>r.abort());
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')&&(u.pathname==='/'||/\.(mjs|css|html)$/.test(u.pathname))){const r=await fetch(process.env.TRIM_ASSET_BASE+(u.pathname==='/'?'index.html':u.pathname.slice(1))+u.search);assert.ok(r.ok);await route.fulfill({status:200,contentType:r.headers.get('content-type'),body:await r.text()});}else await route.fallback();});
const p=s=>page.locator('#patients-workspace').locator(s),ready=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled),saved=()=>page.locator('#local-changes').filter({hasText:/Saved to (Drive|folder)/}).waitFor();
const tab=async n=>{await page.locator('[data-section=patients]').click();await p(`[data-click="showTab('${n}',this)"]`).click();};
const toggle=async(id,flag)=>{await p(`[data-roster-patient="${id}"] .patient-actions-toggle`).click();await p(`#patient-actions-${id} [data-flag="${flag}"]`).click();await page.waitForFunction(()=>!document.querySelector('#patients-workspace').shadowRoot.querySelector('[data-patient-flag-action]').disabled);};
const save=async()=>{await ready();await page.locator('#sync').click();await saved();};
const readRoster=async()=>JSON.parse(await readFile(rosterPath,'utf8'));
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor();await saved();const originalBilling=JSON.parse(await readFile(billingPath,'utf8'));
 await tab('patients');assert.equal(await p('#ulist .flag-psych').count(),1);assert.equal(await p('#ulist .flag-palliative').count(),0);
 await toggle('sample-1','palliativeFlag');assert.deepEqual(await readRoster(),roster);assert.equal(await p('#ulist .palliative-section [data-roster-patient="sample-1"]').count(),1);assert.equal(await p('#ulist [data-roster-patient="sample-1"]').count(),1);assert.match(await p('#ulist .pinned-unit').innerText(),/CEDAR/);
 await toggle('sample-1','palliativeFlag');await ready();assert.equal(await p('#ulist .palliative-section').count(),0);await toggle('sample-1','palliativeFlag');
 await page.reload();await page.locator('.patient').first().waitFor();await ready();await tab('patients');assert.equal(await p('#ulist .palliative-section [data-roster-patient="sample-1"]').count(),1);
 await p('#roster-search').fill('Jordan');assert.equal(await p('#ulist .palliative-section').count(),0);await p('#roster-search').fill('');
 // Existing Psychiatric flag remains; both can be set independently.
 await toggle('sample-1','pFlag');assert.equal(await p('#ulist .flag-psych').count(),0);assert.equal(await p('#ulist [data-roster-patient="sample-1"] .flag-palliative').count(),1);await toggle('sample-1','pFlag');
 await page.screenshot({path:'work/patient-flags-roster.png',fullPage:true});
 await page.locator('[data-section=billing]').click();await page.locator('#search').fill(roster.patients[0].phn);await page.locator('.patient').click();assert.equal(await page.locator('#editor .flag-psych').count(),1);assert.equal(await page.locator('#editor .flag-palliative').count(),1);await page.screenshot({path:'work/patient-flags-billing.png',fullPage:true});
 await page.locator('[data-section=notes]').click();await page.locator('#notes-all').check();await page.locator('#rounds [data-notes-search]').fill(roster.patients[0].phn);await page.locator('[data-notes-patient]').click();assert.equal(await page.locator('.rounds-detail .flag-psych').count(),1);assert.equal(await page.locator('.rounds-detail .flag-palliative').count(),1);await page.screenshot({path:'work/patient-flags-notes.png',fullPage:true});
 await tab('other-patients');await toggle('sample-3','palliativeFlag');await toggle('sample-3','pFlag');assert.equal(await p('#other-list .palliative-section [data-roster-patient="sample-3"]').count(),1);assert.equal(await p('#other-list [data-roster-patient="sample-3"]').count(),1);await p('#other-doctor-filter').selectOption('Dr. Tarun Soni');assert.equal(await p('#other-list .palliative-section').count(),0);await p('#other-doctor-filter').selectOption('');
 await page.locator('[data-section=billing]').click();await page.locator('#search').fill(roster.otherPatients[0].phn);await page.locator('.patient').click();assert.equal(await page.locator('#editor .flag-psych').count(),1);assert.equal(await page.locator('#editor .flag-palliative').count(),1);await tab('other-patients');
 await save();const expected=structuredClone(roster);expected.patients[0].palliativeFlag=true;expected.otherPatients[0].palliativeFlag=true;expected.otherPatients[0].pFlag=true;assert.deepEqual(await readRoster(),expected);assert.deepEqual(JSON.parse(await readFile(billingPath,'utf8')),originalBilling);
 await page.reload();await page.locator('.patient').first().waitFor();await saved();await tab('other-patients');assert.equal(await p('#other-list .palliative-section [data-roster-patient="sample-3"]').count(),1);
 // Manual edits cannot race an unfinished Add form.
 await p('#add-patient > summary').click();await p('#in-name').fill('Unfinished');await p('#patient-actions-sample-3').evaluate(e=>e.showPopover());assert.equal(await p('#patient-actions-sample-3 [data-flag="palliativeFlag"]').isDisabled(),true);await p('#patient-actions-sample-3').evaluate(e=>e.hidePopover());await p('#in-name').fill('');await p('#add-patient > summary').click();await saved();
 await toggle('sample-3','palliativeFlag');await save();assert.equal(await p('#other-list .palliative-section').count(),0);assert.equal(await p('#other-list [data-roster-patient="sample-3"] .flag-psych').count(),1);
 // Independent edits on another computer merge with flags.
 await tab('patients');await toggle('sample-1','palliativeFlag');const remote=await readRoster();remote.patients[0].room='1510';await writeFile(rosterPath,JSON.stringify(remote));await save();const combined=await readRoster();assert.equal(combined.patients[0].room,'1510');assert.equal(combined.patients[0].palliativeFlag,false);assert.equal(combined.patients[0].pFlag,true);
 for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 assert.deepEqual(JSON.parse(await readFile(billingPath,'utf8')),originalBilling);assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);console.log('PASS independent flags on both rosters, unique palliative priority groups, search/doctor filters, Notes and Billing badges, local recovery, explicit save, removal of flag, edit guard, remote merge, billing preservation and responsive containment.');
}catch(e){console.error(errors);await page.screenshot({path:'work/patient-flags-failure.png',fullPage:true});throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
