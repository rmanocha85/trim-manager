import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';import {createServer} from './server-fixture.mjs';
import {blankLedger,today,addDays,planNewPatients,normalizeRoster} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-workflow-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const person=(id,days)=>({id,name:'Example, '+id,phn:id==='new'?'0000000001':id==='old'?'0000000002':'0000000003',ava:id==='new'?'123456':id==='old'?'123457':'123458',unit:'cedar',room:id==='new'?'1501':'1502',codes:'401 250',panelAddedDate:addDays(today(),-days),newPanelPatient:true});
const roster={patients:[person('new',2),{...person('old',14),medReconciliationDate:addDays(today(),-13)}],otherPatients:[{...person('other',13),doctor:'Example doctor',palliativeFlag:true}],removedPatients:[],units:[{id:'cedar',name:'CEDAR'}],billingDates:[]};
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(planNewPatients(blankLedger('workflow-synthetic'),normalizeRoster(roster))));await mkdir('work',{recursive:true});
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'billing.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.route('https://**/*',r=>r.abort());
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')&&(u.pathname==='/'||/\.(mjs|css|html)$/.test(u.pathname))){const r=await fetch(process.env.TRIM_ASSET_BASE+(u.pathname==='/'?'index.html':u.pathname.slice(1))+u.search);assert.ok(r.ok);await route.fulfill({status:200,contentType:r.headers.get('content-type'),body:await r.text()});}else await route.fallback();});
const p=s=>page.locator('#patients-workspace').locator(s),ready=()=>page.waitForFunction(()=>!document.querySelector('#sync').disabled),saved=()=>page.locator('#local-changes').filter({hasText:'Saved to folder'}).waitFor(),save=async()=>{await ready();await page.locator('#sync').click();await saved();};
const tab=async n=>{await page.locator('[data-section=patients]').click();await p(`[data-click="showTab('${n}',this)"]`).click();};
const box=id=>p('[data-med-reconciliation="'+id+'"]');
const read=async()=>JSON.parse(await readFile(rosterPath,'utf8'));
const card=code=>page.locator('.code-details').filter({has:page.locator('[data-remove-code="'+code+'"]')});
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor();await saved();
 await tab('patients');assert.equal(await box('new').isChecked(),false);assert.equal(await box('old').count(),0);
 const before=await page.locator('#patients-workspace').boundingBox();
 await box('new').check();await ready();assert.equal((await read()).patients[0].medReconciliationDate,undefined);
 await page.reload();await page.locator('.patient').first().waitFor();await tab('patients');assert.equal(await box('new').isChecked(),true);
 await save();assert.equal((await read()).patients[0].medReconciliationDate,today());
 const after=await page.locator('#patients-workspace').boundingBox();assert.equal(after.y,before.y);assert.equal(await page.locator('#workspace > #session-status').count(),0);
 await page.screenshot({path:'work/nov7-med-reconciliation.png',fullPage:true});
 await tab('other-patients');assert.equal(await box('other').count(),1);await box('other').check();await save();assert.equal((await read()).otherPatients[0].doctor,'Example doctor');assert.equal((await read()).otherPatients[0].medReconciliationDate,today());
 await box('other').uncheck();await save();assert.equal((await read()).otherPatients[0].medReconciliationDate,'');
 assert.equal((await read()).patients[1].medReconciliationDate,roster.patients[1].medReconciliationDate);
 await page.locator('[data-section=billing]').click();await page.locator('#search').fill('0000000001');await page.locator('.patient').click();await page.locator('[data-code="00114"]').click();await card('00114').locator('[data-field=diagnosis]').fill('250 311 V66.7');await save();
 await page.reload();await page.locator('.patient').first().waitFor();await saved();await page.locator('#search').fill('0000000001');await page.locator('.patient').click();
 for(const code of ['13121','14077']){
  await page.locator('[data-code="'+code+'"]').click();const c=card(code),start=c.locator('[data-field=start]'),end=c.locator('[data-field=end]');
  assert.equal(await c.locator('[data-field=diagnosis]').inputValue(),'250 311 V66.7');assert.equal(await c.locator('[data-time-open],.inline-time-picker,.time-done').count(),0);
  await start.fill('1310');await start.press('Tab');assert.equal(await end.evaluate(e=>document.activeElement===e),true);assert.equal(await end.inputValue(),'13:20');assert.equal(await start.inputValue(),'13:10');
  await end.press('Shift+Tab');assert.equal(await start.evaluate(e=>document.activeElement===e),true);
  await end.fill('1337');await start.fill('1315');assert.equal(await end.inputValue(),'13:37');
 }
 await card('13121').locator('[data-field=diagnosis]').fill('401');await card('00114').locator('[data-field=diagnosis]').fill('250 311');
 assert.equal(await card('13121').locator('[data-field=diagnosis]').inputValue(),'401');assert.equal(await card('14077').locator('[data-field=diagnosis]').inputValue(),'250 311');
 await save();
 await page.screenshot({path:'work/nov7-billing-times.png',fullPage:true});
 // Failed save is visible in the fixed header, details are available without moving the workspace.
 await tab('patients');await box('new').uncheck();await ready();const top=await page.locator('#patients-workspace').boundingBox();let fail=true;
 await page.route('**/api/roster/document',route=>route.request().method()==='PUT'&&fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic unavailable'})}):route.continue());
 await page.locator('#sync').click();await page.locator('#local-changes').filter({hasText:'Save failed'}).waitFor();assert.equal((await page.locator('#patients-workspace').boundingBox()).y,top.y);assert.equal((await read()).patients[0].medReconciliationDate,today());
 await page.locator('#local-changes').click();await page.locator('#changes-dialog').waitFor();assert.match(await page.locator('#session-status').innerText(),/Remaining changes/);await page.locator('[data-close="changes-dialog"]').click();
 fail=false;await save();assert.equal((await read()).patients[0].medReconciliationDate,'');assert.equal((await page.locator('#patients-workspace').boundingBox()).y,top.y);
 for(const width of [1440,1024,390]){await page.setViewportSize({width,height:900});const y=(await page.locator('#patients-workspace').boundingBox()).y;await box('new').check();await save();assert.equal((await page.locator('#patients-workspace').boundingBox()).y,y);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'work/nov7-header-'+width+'.png',fullPage:true});await box('new').uncheck();await save();}
 assert.deepEqual(errors,[]);console.log('PASS reconciliation on both rosters, expiry, draft recovery, explicit save, retained completion, saved 114 diagnosis inheritance, manual overrides, time keyboard flow, persistent failures/retry and stable responsive header.');
}catch(e){await page.screenshot({path:'work/nov7-workflow-failure.png',fullPage:true});console.error(errors);throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
