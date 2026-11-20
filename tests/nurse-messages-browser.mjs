import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-nurses-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const activeIssue={status:'active',resolvedAt:null,description:'Private symptom details',openedAt:'2026-11-19T12:00:00Z',updatedAt:'2026-11-19T12:00:00Z',history:[]};
const p=(id,n,unit,extra={})=>({id,name:'Example, '+id,phn:String(n).padStart(10,'0'),unit,room:'101',codes:'401',activeIssue,...extra});
const roster={patients:[p('Alex',1,'cedar',{palliativeFlag:true}),p('Morgan',2,'hatzic'),p('Taylor',3,'stave'),p('Unknown',4,'unknown'),p('Ordinary',5,'cedar',{activeIssue:undefined})],otherPatients:[p('Jordan',6,'fern')],units:[{id:'cedar',name:'CEDAR',floor:1},{id:'hatzic',name:'HATZIC',floor:1},{id:'stave',name:'STAVE',floor:3},{id:'fern',name:'FERN',floor:2}],removedPatients:[],billingDates:[]};
const original=JSON.stringify(roster),billing=JSON.stringify(blankLedger('nurses-synthetic'));await writeFile(rosterPath,original);await writeFile(billingPath,billing);await mkdir('work',{recursive:true});
const server=createServer({rosterPath,billingPath,lockPath:path.join(dir,'lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1600,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());page.setDefaultTimeout(15000);
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')&&(u.pathname==='/'||/\.(mjs|css|html)$/.test(u.pathname))){const response=await fetch(process.env.TRIM_ASSET_BASE+(u.pathname==='/'?'index.html':u.pathname.slice(1))+u.search);assert.ok(response.ok);await route.fulfill({status:200,contentType:response.headers.get('content-type'),body:await response.text()});}else await route.fallback();});
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor({state:'attached'});await page.locator('[data-section=patients]').click();
 const root=page.locator('#patients-workspace'),dialog=root.locator('#nurse-message-dialog'),row=root.locator('[data-roster-patient="Alex"]').first();
 assert.equal(await root.locator('.toolbar-icon').count(),4);
 for(const button of await root.locator('.toolbar-icon').all()){assert.equal((await button.textContent()).trim(),'');assert.ok(await button.getAttribute('aria-label'));assert.equal(await button.locator('svg').count(),1);}
 assert.equal((await root.locator('.roster-search').innerText()).trim(),'');
 assert.equal(await root.locator('.roster-search-symbol').count(),1);
 const messageButton=row.getByRole('button',{name:'Request patient update',exact:true});
 const m=await messageButton.boundingBox(),b=await row.getByRole('button',{name:'Open billing',exact:true}).boundingBox();assert.ok(m.x+m.width<=b.x);
 await messageButton.click();const individual=root.locator('#individual-nurse-dialog');
 assert.equal(await individual.locator('textarea').inputValue(),'Alex Example - Private symptom details - Could you provide a clinical update?');
 await individual.locator('textarea').fill('Edited individual clinical update request');await individual.getByRole('button',{name:'Copy message'}).click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Edited individual clinical update request');
 await individual.getByRole('button',{name:'Close',exact:true}).click();await messageButton.click();assert.equal(await individual.locator('textarea').inputValue(),'Edited individual clinical update request');await individual.getByRole('button',{name:'Close',exact:true}).click();
 const copy=await row.locator('.identity-copy').boundingBox(),name=await row.locator('.identity-name').boundingBox();assert.ok(copy.x+copy.width<=name.x);
 const cells=row.locator('td');assert.equal(await cells.nth(4).locator('.active-issue-badge').count(),1);assert.equal(await cells.nth(4).locator('.resolve-issue').count(),1);assert.equal(await cells.nth(3).locator('.pphn').count(),1);assert.equal(await cells.nth(5).getAttribute('class'),'roster-hospital');assert.equal(await row.locator('.roster-billing-actions .resolve-issue').count(),0);
 assert.ok((await root.locator('#roster-search').boundingBox()).width<=290);
 await page.screenshot({path:'work/nurse-roster-desktop.png',fullPage:true});
 await root.locator('#roster-search').fill('Ordinary');await root.getByRole('button',{name:'Request nurse updates',exact:true}).click();await dialog.waitFor();
 const one=dialog.locator('[data-nurse-group="floors-1-3"]'),two=dialog.locator('[data-nurse-group="floor-2"]');
 assert.match(await one.locator('h3').innerText(),/2 patients/);assert.match(await two.locator('h3').innerText(),/2 patients/);assert.match(await dialog.locator('.nurse-unassigned').innerText(),/Unknown Example/);
 assert.match(await two.locator('textarea').inputValue(),/Morgan Example \(HATZIC, Floor 2\)/);assert.doesNotMatch((await one.locator('textarea').inputValue())+(await two.locator('textarea').inputValue()),/000000000/);
 assert.match(await one.locator('textarea').inputValue(),/Private symptom details - Could you provide a clinical update\?/);
 const first=await one.locator('textarea').inputValue();assert.equal((first.match(/Alex Example/g)||[]).length,1);
 const edited=first.replace(/Taylor Example[^]*?update\?\n\n/,'').replace('could you update','please update');await one.locator('textarea').fill(edited);await one.getByRole('button',{name:'Copy message'}).click();assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),edited);
 assert.equal(await one.getByRole('link',{name:'Open Google Messages'}).getAttribute('href'),'https://messages.google.com/web/');
 page.once('dialog',d=>d.dismiss());await dialog.locator('select').selectOption('patients');assert.equal(await dialog.locator('select').inputValue(),'all');assert.equal(await one.locator('textarea').inputValue(),edited);
 await dialog.getByRole('button',{name:'Close nurse updates'}).click();await root.getByRole('button',{name:'Request nurse updates'}).click();assert.equal(await one.locator('textarea').inputValue(),edited);
 page.once('dialog',d=>d.accept());await dialog.locator('select').selectOption('patients');assert.match(await two.locator('h3').innerText(),/1 patient/);assert.doesNotMatch(await two.locator('textarea').inputValue(),/Jordan/);
 for(const width of [1600,390]){await page.setViewportSize({width,height:1000});assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.screenshot({path:'work/nurse-drafts-'+width+'.png',fullPage:true});}
 await dialog.getByRole('button',{name:'Close nurse updates'}).click();assert.equal(await readFile(rosterPath,'utf8'),original);assert.equal(await readFile(billingPath,'utf8'),billing);
 // Explicit unit correction stages locally, then uses the existing conditional Save pipeline.
 await page.setViewportSize({width:1600,height:1000});await root.getByRole('button',{name:'Units',exact:true}).click();await root.getByRole('combobox',{name:'Floor for HATZIC'}).selectOption('2');await root.locator('#ss').filter({hasText:/Saved locally/}).waitFor({state:'attached'});
 assert.equal(JSON.parse(await readFile(rosterPath,'utf8')).units[1].floor,1);
 await page.locator('#sync:not([disabled])').click();await page.locator('#local-changes').filter({hasText:'Saved to folder'}).waitFor();
 const saved=JSON.parse(await readFile(rosterPath,'utf8'));assert.equal(saved.units[1].floor,2);assert.deepEqual(saved.patients,JSON.parse(original).patients);assert.deepEqual(saved.otherPatients,roster.otherPatients);assert.deepEqual(saved.units.filter(u=>u.id!=='hatzic'),roster.units.filter(u=>u.id!=='hatzic'));assert.deepEqual(JSON.parse(await readFile(billingPath,'utf8')),JSON.parse(billing));
 await page.reload();await page.locator('.patient').first().waitFor({state:'attached'});await page.locator('[data-section=patients]').click();await root.getByRole('button',{name:'Units',exact:true}).click();assert.equal(await root.getByRole('combobox',{name:'Floor for HATZIC'}).inputValue(),'2');
 assert.deepEqual(errors,[]);console.log('PASS icon-only toolbar, compact search, aligned copy/flag/resolve, active-only nursing groups, deduplication, privacy, editable/copyable drafts, scope safeguards, mobile, no message writes, and conditional unit correction surviving reload.');
}catch(e){await page.screenshot({path:'work/nurse-failure.png',fullPage:true});throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
