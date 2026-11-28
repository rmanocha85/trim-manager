// Synthetic records only, including hosted-asset validation.
import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-names-')),file=n=>path.join(dir,n);
const p={id:'one',name:'EXAMPLE, ALEX',phn:'0000000001',ava:'123456',unit:'test',room:'1',codes:'401'};
const fixtures={
 'roster.json':{patients:[p],otherPatients:[{...p,id:'two',name:'OTHER, CASEY',phn:'0000000002',ava:'123457'}],removedPatients:[],units:[{id:'test',name:'TEST'}],billingDates:[]},
 'billing.json':blankLedger('names-synthetic'),
 'maid-roster.json':{schemaVersion:1,patients:[{...p,firstName:'ÉLISE',lastName:'O’NEILL',status:'active'}]},
 'oat-fh-roster.json':{schemaVersion:1,clinic:'oat-fh',patients:[{...p,status:'active'}]},
 'oat-purple-roster.json':{schemaVersion:1,clinic:'oat-purple',patients:[{...p,status:'active'}]},
 'il-rosters.json':{schemaVersion:1,sites:Object.fromEntries(['carrington','cedarbrook','the-cedars'].map(s=>[s,{patients:[p]}]))},
 'pleasantview-patients-data.json':{schemaVersion:1,facility:'Pleasantview',emrSystem:'Ava',groups:{pleasantview_rc:{patients:[{...p,emrNumber:p.ava}]},pleasantview_al:{patients:[]}}}
};
for(const [n,v] of Object.entries(fixtures))await writeFile(file(n),JSON.stringify(v));
const server=createServer({rosterPath:file('roster.json'),billingPath:file('billing.json'),notesPath:file('notes'),lockPath:file('test.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')&&(u.pathname==='/'||/\.(mjs|css|html)$/.test(u.pathname))){const r=await fetch(process.env.TRIM_ASSET_BASE+(u.pathname==='/'?'index.html':u.pathname.slice(1))+u.search);assert.ok(r.ok);await route.fulfill({status:200,contentType:r.headers.get('content-type'),body:await r.text()});}else await route.fallback();});
const origin='http://127.0.0.1:'+server.address().port;
try{
 for(const [section,host,expected] of [['patients','#patients-workspace','Example, Alex'],['billing','#workspace','Example, Alex'],['notes','#workspace','Example, Alex'],['maid','#maid-workspace','O’Neill, Élise'],['oat-fh','#oat-fh-workspace','Example, Alex'],['oat-purple','#oat-purple-workspace','Example, Alex'],['carrington','#il-workspace','Example, Alex'],['cedarbrook','#il-workspace','Example, Alex'],['the-cedars','#il-workspace','Example, Alex'],['pleasantview','#il-workspace','Example, Alex']]){
  await page.goto(origin+'/?section='+section);
  console.log('Checking '+section);
  if(section==='patients'){await page.locator('.patient').first().waitFor();await page.locator('[data-section=patients]').click();}
  if(section==='billing'){await page.locator('#search').fill(p.phn);await page.locator('.patient').first().click();}
  if(section==='notes')await page.locator('#notes-all').check();
  if(section.startsWith('oat-'))await page.locator(host).getByRole('button',{name:'Active patients',exact:true}).click();
  const scope=page.locator(host),name=scope.locator('a[href="https://www.avaemr.ca/patients/123456"]:visible').first();await name.waitFor();assert.equal(await name.innerText(),expected);
  const copy=scope.getByRole('button',{name:'Copy name: '+expected,exact:true}).first();if(await copy.count()){await copy.click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected);}
  if(section==='patients')await scope.getByRole('link',{name:'Open Ava chart for Other, Casey',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await name.waitFor();await page.setViewportSize({width:1440,height:1000});
 }
 for(const [n,v] of Object.entries(fixtures))if(n!=='billing.json')assert.deepEqual(JSON.parse(await readFile(file(n),'utf8')),v,'Viewing must not rewrite '+n);
 assert.deepEqual(errors,[]);console.log('PASS shared name display, chart links and clipboard across all Work OS apps; source identities unchanged.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),os.tmpdir());await rm(dir,{recursive:true,force:true});}
