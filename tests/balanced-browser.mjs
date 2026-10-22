// Isolated synthetic account/API only; this never attaches to the real browser.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from './server-fixture.mjs';
import {blankLedger,upsertEntry} from '../public/core.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const patients=Array.from({length:40},(_,i)=>({id:`synthetic-${i}`,key:`phn:${String(i+1).padStart(10,'0')}`,name:`SYNTHETIC ${String(i+1).padStart(2,'0')}, Example`,phn:String(i+1).padStart(10,'0'),room:String(2101+i),unit:'dewdney',codes:'401',panel:true}));
let ledger=upsertEntry(blankLedger('synthetic-balanced'),patients[0],'2026-09-22',[{code:'00114',units:1,reason:'Previously saved reason'}]);
ledger.historicalBillings=[{id:'historical-1',patientKey:patients[0].key,date:'2026-09-01',status:'already_billed',codes:['00114']}];
const initial=structuredClone(ledger);let revision=1,failedSave=false,expired=false,writes=0;
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1366,height:768}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const syncClick=async()=>{await page.locator('#load-latest:not(:disabled)').waitFor();if(await page.locator('#sync').isEnabled())await page.locator('#sync').click();else{await page.locator('#drive-connection').click();await page.locator('#drive-connection:not(:disabled)').waitFor();if(await page.locator('#sync').isEnabled())await page.locator('#sync').click();}};
try{
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"synthetic-token"})})}}};'}));
 await page.route('https://www.googleapis.com/**',async route=>{const req=route.request(),url=req.url();let data={},status=200;if(expired)status=401;else if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3')&&url.includes('fields=id,etag'))data={etag:'roster1'};else if(url.includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'))data={patients,units:[{id:'dewdney',name:'DEWDNEY',floor:2}]};else if(url.includes('/files?q='))data={items:[{id:'synthetic-billing'}]};else if(url.includes('uploadType=media')){if(failedSave)status=503;else if(req.headers()['if-match']!==`"v${revision}"`)status=412;else{ledger=JSON.parse(req.postData());revision++;writes++;}}else if(url.includes('alt=media'))data=ledger;else data={id:'synthetic-billing',etag:`"v${revision}"`};await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/?connection=manual`);assert.equal(await page.locator('.patient').count(),0);await page.locator('#connect').click();await page.locator('#cloud-connect').click();await page.locator('.patient').first().waitFor();assert.deepEqual(ledger,initial);assert.equal(writes,0);
 const localToday=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});assert.equal(await page.locator('#service-date').inputValue(),localToday);assert.equal(await page.locator('#calendar-days button[aria-pressed=true]').getAttribute('data-day'),localToday);
 // Existing entries are read without automatic retroactive changes.
 await page.locator('#month-prev').click();await page.locator('[data-day="2026-09-22"]').click();await page.locator('.patient').first().click();assert.equal(await page.locator('.codes-grid [data-code]').count(),4);assert.equal(await page.locator('#other-code').isVisible(),false);assert.equal(await page.locator('.bonus-banner').count(),0);assert.deepEqual(ledger,initial);
 await page.locator('[data-day="2026-09-24"]').click();await page.locator('[data-code="00114"]').click();await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();let e=ledger.entries.find(x=>x.date==='2026-09-24');assert.deepEqual(e.items.map(x=>x.code),['00114','13334']);
 await page.locator('[data-field="reason"]').fill('SYNTHETIC cough');await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();await page.locator('#editor-issues').getByText('enter the ICD-9 for this billing reason.',{exact:false}).waitFor();await page.locator('[data-field="diagnosis"]').fill('786.2');await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
 e=ledger.entries.find(x=>x.date==='2026-09-24');assert.equal(e.items[0].diagnosis,'786.2');assert.equal(ledger.patients[e.patientKey].codes,'401');assert.deepEqual(ledger.historicalBillings,initial.historicalBillings);assert.deepEqual(ledger.entries.find(x=>x.date==='2026-09-22'),initial.entries[0]);
 // Common task controls remain above the fold on laptop and smaller screens.
 for(const width of [1366,1024,820]){await page.setViewportSize({width,height:768});const bounds=await page.locator('[data-field="diagnosis"]').boundingBox();assert.ok(bounds.y+bounds.height<740,JSON.stringify({width,bounds}));assert.ok((await page.locator('#search').boundingBox()).y<384);assert.ok((await page.locator('#editor').boundingBox()).y<384);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.setViewportSize({width:1366,height:768});await mkdir('work',{recursive:true});await page.screenshot({path:'work/balanced-laptop.png'});
 // Typing resumes in the same field after save without losing a character.
 await page.locator('[data-field="reason"]').fill('SYNTHETIC first');await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();await page.locator('[data-field="reason"]').click();await page.locator('[data-field="reason"]').press('End');await page.keyboard.type(' second');await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(ledger.entries.find(x=>x.date==='2026-09-24').items[0].reason,'SYNTHETIC first second');
 // A second patient on the same date must not receive a second bonus.
 await page.locator('.patient').nth(1).click();await page.locator('[data-code="00127"]').click();await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(ledger.entries.filter(x=>x.date==='2026-09-24').flatMap(x=>x.items).filter(i=>i.code==='13334').length,1);
 // Failed save retains the edit and disables further billing until retry succeeds.
 failedSave=true;await page.locator('[data-field="reason"]').fill('SYNTHETIC retained on failure');await syncClick();await page.locator('#session-status').filter({hasText:'Remaining changes'}).waitFor();assert.equal(await page.locator('[data-code="00114"]').isEnabled(),false);assert.equal(await page.locator('[data-field="reason"]').isEnabled(),false);failedSave=false;await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(ledger.entries.find(x=>x.patientKey===patients[1].key).items[0].reason,'SYNTHETIC retained on failure');assert.equal(await page.locator('[data-code="00114"]').isEnabled(),true);
 // Presets fill both fields in one save; custom details are not silently overwritten.
 await page.locator('.patient').first().click();const presetWrites=writes;
 page.once('dialog',d=>d.accept());await page.locator('[data-reason-preset="0"]').click();await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(writes,presetWrites+1);assert.equal(await page.locator('[data-field="reason"]').inputValue(),'Fall and trauma');assert.equal(await page.locator('[data-field="diagnosis"]').inputValue(),'959');
 for(const [n,diagnosis] of ['959','038.9','786.2','789','682','298','338','487','C19','250'].entries()){await page.locator(`[data-reason-preset="${n}"]`).click();await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();assert.equal(ledger.entries.find(x=>x.date==='2026-09-24'&&x.patientKey===patients[0].key).items[0].diagnosis,diagnosis);}
 await page.locator('[data-field="reason"]').fill('SYNTHETIC important custom detail');await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();const unchanged=structuredClone(ledger);page.once('dialog',d=>d.dismiss());await page.locator('[data-reason-preset="0"]').click();assert.deepEqual(ledger,unchanged);
 // Inline exact entry and ten-minute scrolling stay within each charge card.
 const enterTime=async(field,value,manual=false)=>{
  if(manual){await page.locator(`[data-time-text][data-field="${field}"]`).fill(value);await page.locator(`[data-time-text][data-field="${field}"]`).press('Tab');}
  else{const root=page.locator('.inline-time').filter({has:page.locator(`[data-field="${field}"]`)});if(!await root.locator('.inline-time-picker').isVisible())await root.locator('[data-time-open]').click();assert.deepEqual(await root.locator('[data-wheel=minute] option').evaluateAll(es=>es.map(e=>e.value)),['00','10','20','30','40','50']);assert.equal(await page.locator('dialog[open]').count(),0);await root.locator('[data-wheel=hour]').selectOption(value.slice(0,2));await root.locator('[data-wheel=minute]').selectOption(value.slice(3));await root.locator('.time-done').click();}
  await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
 };
 for(const [index,code,start,end] of [[2,'14077','14:30','14:40'],[3,'13121','15:00','15:10']]){
  await page.locator('.patient').nth(index).click();await page.locator(`[data-code="${code}"]`).click();
  assert.match(await page.locator('[data-field=start]').inputValue(),/^\d{2}:[0-5]0$/);
  assert.equal(await page.locator('[data-field=reason]').count(),code==='14077'?1:0);assert.equal(await page.locator('[data-field=participants]').count(),0);
  await enterTime('start',start);assert.equal(await page.locator('[data-field=end]').inputValue(),end);
  await enterTime('end',code==='14077'?'14:50':'15:20');
  await enterTime('start',code==='14077'?'1437':'1507',true);assert.equal(await page.locator('[data-field=end]').inputValue(),code==='14077'?'14:50':'15:20');
  assert.equal(await page.locator('[data-field=start]').inputValue(),code==='14077'?'14:37':'15:07');
  await page.locator('[data-field=start]').fill('2460');await page.locator('#editor-issues').getByText('valid start/end times required',{exact:false}).waitFor();
  await enterTime('start',start,true);
 }
 // Two charge cards have a real visual gap; expanding time remains in normal flow.
 await page.locator('[data-code="00114"]').click();await page.locator('[data-reason-preset="1"]').click();
 const cards=page.locator('.code-details');assert.equal(await cards.count(),2);const a=await cards.nth(0).boundingBox(),b=await cards.nth(1).boundingBox();assert.ok(b.y-(a.y+a.height)>=15);
 if(!await page.locator('[data-field=end]').locator('..').locator('..').locator('.inline-time-picker').isVisible())await page.locator('[data-time-open=end]').click();assert.equal(await page.locator('dialog[open]').count(),0);
 await page.screenshot({path:'work/inline-time-laptop.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('.inline-time-picker:not([hidden]) .time-done').first().click();
 await page.setViewportSize({width:1366,height:768});
 // Offline locks both text and wheels; edits remain local until explicit save.
 if(!await page.locator('[data-field=end]').locator('..').locator('..').locator('.inline-time-picker').isVisible())await page.locator('[data-time-open=end]').click();await context.setOffline(true);await page.locator('[data-field=end]:disabled').waitFor();
 assert.equal(await page.locator('[data-field=end]').isEnabled(),false);
 assert.equal(await page.locator('.inline-time-picker:not([hidden]) [data-wheel=hour]').first().isEnabled(),false);
 await context.setOffline(false);await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
 assert.deepEqual(ledger.entries.find(x=>x.date==='2026-09-22'),initial.entries[0]);assert.deepEqual(ledger.historicalBillings,initial.historicalBillings);
 // Proactive auth check locks the workspace without altering any saved entry.
 const before=structuredClone(ledger);expired=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.locator('#billing-lock').filter({hasText:'Billing locked'}).waitFor();assert.equal(await page.locator('[data-code="00114"]').isEnabled(),false);assert.deepEqual(ledger,before);expired=false;await syncClick();await page.locator('#local-changes').filter({hasText:'No local changes'}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log('PASS balanced layout: existing data untouched, calendar, four codes, per-charge ICD, bonus uniqueness, laptop fold, focus recovery, failed-save lock/retry, auth lock and responsive layout.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
