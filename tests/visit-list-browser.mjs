import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-visit-list-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const issue={status:'active',history:[],resolvedAt:null,description:'Follow up symptoms',openedAt:'2026-11-13T17:00:00Z',updatedAt:'2026-11-13T17:00:00Z'};
const p=(id,n,unit,active)=>({id,name:'Example '+id,phn:'000000000'+n,unit,room:'101',codes:'401',...(active?{activeIssue:issue}:{})});
const roster={patients:[p('Active',1,'cedar',true),p('ADP',2,'day',false),p('Neither',3,'cedar',false)],otherPatients:[p('Both',4,'day',true)],removedPatients:[],units:[{id:'cedar',name:'Cedar'},{id:'day',name:'ADP'}],billingDates:[]};
const original=JSON.stringify(roster);await writeFile(rosterPath,original);await writeFile(billingPath,JSON.stringify(blankLedger('visits-synthetic')));await mkdir('work',{recursive:true});
const server=createServer({rosterPath,billingPath,lockPath:path.join(dir,'lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());page.setDefaultTimeout(10000);
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor({state:'attached'});await page.locator('[data-section=patients]').click();
 const root=page.locator('#patients-workspace'),dialog=root.locator('#visit-list-dialog');
 await root.locator('#roster-search').fill('Neither');
 await root.getByRole('button',{name:'Copy visit list',exact:true}).click();await dialog.waitFor();
 assert.equal((await dialog.locator('textarea').inputValue()).match(/• /g).length,3);assert.doesNotMatch(await dialog.locator('textarea').inputValue(),/Neither|0000000001/);
 await dialog.getByRole('button',{name:'Copy text',exact:true}).click();assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),await dialog.locator('textarea').inputValue());
 await dialog.locator('select').selectOption('patients');assert.equal((await dialog.locator('textarea').inputValue()).match(/• /g).length,2);
 await dialog.locator('select').selectOption('otherPatients');assert.match(await dialog.locator('textarea').inputValue(),/Example Both/);assert.doesNotMatch(await dialog.locator('textarea').inputValue(),/Example Active/);
 for(const width of [1360,390]){await page.setViewportSize({width,height:900});assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.screenshot({path:'work/visit-list-'+width+'.png',fullPage:true});}
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 assert.equal(await readFile(rosterPath,'utf8'),original);assert.deepEqual(errors,[]);console.log('PASS visit list preview, scope choices, search independence, copy, responsive layout and no roster writes.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
