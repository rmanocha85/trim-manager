import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';
import {facilityNames} from '../public/il-data.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(),'trim-il-'));
const file = name => path.join(temp,name);
const sites = Object.fromEntries([...facilityNames.keys()].map((site,i) => [site,{patients:[
  {name:'Test '+site,ava:'12345'+i,phn:i===1?null:'000000000'+i,dob:'1950-01-01'}
]}]));
await Promise.all([
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
  page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(8000);
  assert.equal((await fetch(origin+'/api/il/rosters')).status,401);
  await page.goto(origin+'/?section=the-cedars');
  const view = page.locator('#il-workspace');
  await view.getByRole('link',{name:/Open Ava chart for Test the-cedars/}).waitFor();
  for (const [id,title] of facilityNames) {
    await page.getByRole('button',{name:title,exact:true}).click();
    const row = view.locator('tbody tr').filter({hasText:'Test '+id});
    const patient = sites[id].patients[0];
    assert.equal(await row.getByRole('link').getAttribute('href'),'https://www.avaemr.ca/patients/'+patient.ava);
    const copies = row.getByRole('button',{name:/Copy PHN/});
    assert.equal(await copies.count(),patient.phn?1:0);
    if (patient.phn) {
      await copies.click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patient.phn);
    }
    await row.getByRole('button',{name:/Copy Ava number/}).click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),patient.ava);
  }
  const open = () => view.getByRole('button',{name:'Add patient',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await open();
  await dialog.getByLabel('Patient name').fill('Synthetic Addition');
  await dialog.getByLabel('Ava chart number').fill('999999');
  await dialog.getByLabel('PHN').fill('0000000099');
  await dialog.getByLabel('Date of birth').fill('1955-12-01');
  await dialog.getByRole('button',{name:'Add patient'}).click();
  await view.getByRole('link',{name:/Synthetic Addition/}).waitFor();
  await page.reload();
  await view.getByRole('link',{name:/Synthetic Addition/}).waitFor();
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
  assert.deepEqual(errors,[]);
  console.log('PASS facility navigation, chart links, clipboard, missing PHN, add, duplicate, persistence and layout.');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(temp,{recursive:true,force:true});
}
