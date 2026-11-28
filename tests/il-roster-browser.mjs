import assert from 'node:assert/strict';
import {patientName} from '../public/patient-names.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';
import {facilityNames} from '../public/il-data.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(),'trim-il-'));
const file = name => path.join(temp,name);
const sites = Object.fromEntries([...facilityNames.keys()].filter(site=>site!=='pleasantview').map((site,i) => [site,{patients:[
  {name:'Test '+site,ava:'12345'+i,phn:i===1?null:'000000000'+i,dob:'1950-01-01'}
]}]));
const pv={schemaVersion:1,facility:'Pleasantview',emrSystem:'Ava',groups:{pleasantview_rc:{patients:[{name:'Test RC',emrNumber:'223456',phn:'0000000011'}]},pleasantview_al:{patients:[{name:'Test AL',emrNumber:'223457',phn:'0000000012'}]}}};
await Promise.all([
  writeFile(file('pleasantview-patients-data.json'),JSON.stringify(pv)),
  writeFile(file('il-rosters.json'),JSON.stringify({schemaVersion:1,sites})),
  writeFile(file('roster.json'),JSON.stringify({patients:[],otherPatients:[],removedPatients:[],units:[],billingDates:[]})),
  writeFile(file('billing.json'),JSON.stringify(blankLedger('synthetic')))
]);
const server = createServer({rosterPath:file('roster.json'),billingPath:file('billing.json'),lockPath:file('test.lock')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:'+server.address().port;
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const context = await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  await context.route('https://**/*',r=>r.abort());
  const page = await context.newPage();
  const errors = [];
  const rosterReads=[];
  const reads = endpoint => rosterReads.filter(url=>url.endsWith(endpoint)).length;
  page.on('request',req=>{if(req.method()==='GET'&&/\/api\/(il\/rosters|pleasantview\/roster)$/.test(req.url()))rosterReads.push(req.url());});
  page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(8000);
  assert.equal((await fetch(origin+'/api/il/rosters')).status,401);
  const preloadedPV=page.waitForResponse(r=>r.url().endsWith('/api/pleasantview/roster')&&r.status()===200);
  await page.goto(origin+'/?section=the-cedars');
  await preloadedPV;
  const view = page.locator('#il-workspace');
  await view.getByRole('link',{name:/Open Ava chart for Test The-Cedars/}).waitFor();
  assert.equal(reads('/api/il/rosters'),1,'Startup preload and the selected tab share one read');
  assert.equal(reads('/api/pleasantview/roster'),1,'Pleasantview preloads without opening its tab');
  for (const [id,title] of [...facilityNames].filter(([id])=>id!=='pleasantview')) {
    await page.getByRole('button',{name:title,exact:true}).click();
    const row = view.locator('tbody tr').filter({hasText:patientName('Test '+id)});
    const patient = sites[id].patients[0];
    assert.equal(await row.getByRole('link').getAttribute('href'),'https://www.avaemr.ca/patients/'+patient.ava);
    const copies = row.getByRole('button',{name:/Copy PHN/});
    assert.equal(await copies.count(),patient.phn?1:0);
    if (patient.phn) {
      await copies.click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patient.phn);
    }
    await row.getByRole('button',{name:/Copy name/}).click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patientName(patient));
    const a=await row.getByRole('link').boundingBox(),b=await row.getByRole('button',{name:/Copy name/}).boundingBox(),c=await row.locator('td').nth(2).boundingBox();
    assert.ok(Math.abs(a.y+a.height/2-b.y-b.height/2)<3,'Copy aligned with name');
    assert.ok(c.x-a.x<340,'PHN next to name');
  }
  assert.equal(reads('/api/il/rosters'),1,'Switching all three facility tabs reuses the shared file');
  const open = () => view.getByRole('button',{name:'Add patient',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await open();
  await dialog.getByLabel('Patient name').fill('Synthetic Addition');
  await dialog.getByLabel('Ava chart number').fill('999999');
  await dialog.getByLabel('PHN').fill('0000000099');
  await dialog.getByLabel('Date of birth').fill('1955-12-01');
  await dialog.getByRole('button',{name:'Add patient'}).click();
  await view.getByRole('link',{name:/Synthetic Addition/}).waitFor();
  const afterAdd=reads('/api/il/rosters');
  await page.getByRole('button',{name:'Carrington',exact:true}).click();
  await view.getByRole('link',{name:/Test Carrington/}).waitFor();
  await page.getByRole('button',{name:'The Cedars',exact:true}).click();
  await view.getByRole('link',{name:/Synthetic Addition/}).waitFor();
  assert.equal(reads('/api/il/rosters'),afterAdd,'A saved addition is immediately reused across tab switches');
  await page.reload();
  await view.getByRole('link',{name:/Synthetic Addition/}).waitFor();
  assert.equal(reads('/api/il/rosters'),afterAdd+1,'Page reload starts a fresh session');
  await open();
  await dialog.getByLabel('Patient name').fill('Duplicate');
  await dialog.getByLabel('Ava chart number').fill('999999');
  await dialog.getByRole('button',{name:'Add patient'}).click();
  await dialog.getByRole('alert').filter({hasText:'already on this site'}).waitFor();
  await dialog.getByRole('button',{name:'Cancel'}).click();
  const data=JSON.parse(await readFile(file('il-rosters.json'),'utf8'));
  assert.deepEqual(data.sites['the-cedars'].patients.at(-1),{
    name:'Synthetic Addition',ava:'999999',phn:'0000000099',dob:'1955-12-01',source:'manual'
  });
  assert.deepEqual(data.sites.carrington,sites.carrington);
  assert.deepEqual(data.sites.cedarbrook,sites.cedarbrook);
  for (const width of [390,800,1280,1920]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Viewport overflow at '+width);
  }
  await view.getByRole('button',{name:'Actions for Synthetic Addition'}).click();
  await page.getByRole('button',{name:'Remove from roster',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Remove from roster'}).click();
  await view.locator('.facility-status').filter({hasText:'Patient removed'}).waitFor();
  await page.reload();
  await view.getByRole('link',{name:/Test The-Cedars/}).waitFor();
  assert.equal(await view.getByRole('link',{name:/Synthetic Addition/}).count(),0);
  await page.getByRole('button',{name:'Pleasantview',exact:true}).click();
  await view.getByRole('link',{name:/Test Rc/}).waitFor();
  assert.deepEqual(await view.locator('tbody a').allTextContents(),['Test Rc','Test Al']);
  assert.deepEqual(await view.locator('.facility-group h2').allTextContents(),['Residential Care (RC) · 1','Assisted Living (AL) · 1']);
  await open();
  await dialog.getByLabel('Care group').selectOption('pleasantview_al');
  await dialog.getByLabel('Patient name').fill('Added AL');
  await dialog.getByLabel('Ava chart number').fill('334455');
  await dialog.getByRole('button',{name:'Add patient',exact:true}).click();
  await view.getByRole('link',{name:/Added Al/}).waitFor();
  const savedPV=JSON.parse(await readFile(file('pleasantview-patients-data.json'),'utf8'));
  assert.deepEqual(savedPV.groups.pleasantview_rc,pv.groups.pleasantview_rc);
  assert.equal(savedPV.groups.pleasantview_al.patients.at(-1).emrNumber,'334455');
  await view.getByRole('button',{name:'Actions for Added Al'}).click();
  await page.getByRole('button',{name:'Remove from roster',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Remove from roster'}).click();
  await view.locator('.facility-status').filter({hasText:'Patient removed'}).waitFor();
  assert.equal(await view.getByRole('link',{name:/Added Al/}).count(),0);
  const beforeFailure=await view.locator('tbody tr').count();
  await page.route('**/api/pleasantview/roster',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"Temporary failure"}'}));
  await view.getByRole('button',{name:'Reload roster'}).click();
  await view.locator('.facility-status').filter({hasText:'Showing the last loaded list'}).waitFor();
  assert.equal(await view.locator('tbody tr').count(),beforeFailure);
  assert.equal(await view.getByRole('button',{name:'Add patient'}).isDisabled(),true);
  await view.getByRole('searchbox').fill('Test');
  assert.match(await view.locator('.facility-status').innerText(),/Showing the last loaded list/);
  assert.equal(await view.getByRole('button',{name:'Add patient'}).isDisabled(),true);
  await view.getByRole('searchbox').fill('');
  await page.unroute('**/api/pleasantview/roster');
  await view.getByRole('button',{name:'Reload roster'}).click();
  await view.getByRole('button',{name:'Add patient'}).waitFor();
  await page.screenshot({path:'work/pleasantview-synthetic.png',fullPage:true});
  // A cached display may be older than another computer; conditional writes must not overwrite it.
  const remote=JSON.parse(await readFile(file('il-rosters.json'),'utf8'));
  remote.sites.cedarbrook.patients.push({name:'Synthetic Remote',ava:'445566',phn:null,dob:null});
  await writeFile(file('il-rosters.json'),JSON.stringify(remote));
  const beforeSwitch=reads('/api/il/rosters');
  await page.getByRole('button',{name:'Cedarbrooke',exact:true}).click();
  await view.getByRole('link',{name:/Test Cedarbrook/}).waitFor();
  assert.equal(await view.getByRole('link',{name:/Synthetic Remote/}).count(),0);
  assert.equal(reads('/api/il/rosters'),beforeSwitch);
  await open();
  await dialog.getByLabel('Patient name').fill('Synthetic Conflicting Addition');
  await dialog.getByLabel('Ava chart number').fill('556677');
  await dialog.getByRole('button',{name:'Add patient',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:/Reload/}).waitFor();
  assert.deepEqual(JSON.parse(await readFile(file('il-rosters.json'),'utf8')),remote,'A stale save must leave the remote file intact');
  await dialog.getByRole('button',{name:'Cancel'}).click();
  assert.equal(await view.getByRole('button',{name:'Add patient'}).isDisabled(),true);
  await view.getByRole('button',{name:'Reload roster'}).click();
  await view.getByRole('link',{name:/Synthetic Remote/}).waitFor();
  assert.equal(reads('/api/il/rosters'),beforeSwitch+1);
  assert.equal(await view.getByRole('button',{name:'Add patient'}).isDisabled(),false);
  await page.getByRole('button',{name:'The Cedars',exact:true}).click();
  await view.getByRole('link',{name:/Test The-Cedars/}).waitFor();
  await page.getByRole('button',{name:'Cedarbrooke',exact:true}).click();
  await view.getByRole('link',{name:/Synthetic Remote/}).waitFor();
  assert.equal(reads('/api/il/rosters'),beforeSwitch+1,'Reload updates every tab sharing the file');
  remote.sites.carrington.patients.push({name:'Synthetic Global Refresh',ava:'667788',phn:null,dob:null});
  await writeFile(file('il-rosters.json'),JSON.stringify(remote));
  await page.getByRole('button',{name:'Roster',exact:true}).click();
  await page.locator('#workspace-more').click();
  await page.locator('#load-latest').click();
  await page.waitForFunction(()=>!document.querySelector('#load-latest').disabled);
  await page.getByRole('button',{name:'Carrington',exact:true}).click();
  await view.getByRole('link',{name:/Synthetic Global Refresh/}).waitFor();
  assert.equal(reads('/api/il/rosters'),beforeSwitch+2,'Global refresh reloads the shared roster even when a different section is open');
  assert.deepEqual(errors,[]);
  console.log('PASS facility preload, zero-request cached navigation, explicit/global refresh, stale-write protection, chart links, clipboard, add/remove persistence and layout.');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(temp,{recursive:true,force:true});
}
