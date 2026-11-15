import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';

const dir=await mkdtemp(path.join(os.tmpdir(),'trim-roster-billing-'));
const rosterPath=path.join(dir,'roster.json'), billingPath=path.join(dir,'billing.json');
const patient={id:'sample',name:'Example, Morgan',room:'214',unit:'unit',palliativeFlag:true,phn:'0000000001'};
const other={id:'second',name:patient.name,room:'215',unit:'unit'};
const contacts=[{name:'Sam Example',relationship:'Son',phone:'(604) 555-0142'}];
const roster={patients:[{...patient,familyContacts:contacts}],otherPatients:[other],units:[{id:'unit',name:'DEWDNEY'}]};
for(let i=2;i<=18;i++)roster.patients.push({id:'sample-'+i,name:'Example, '+i,phn:String(i).padStart(10,'0'),unit:'unit',room:String(i)});
const ledger=blankLedger('synthetic');
await writeFile(rosterPath,JSON.stringify(roster));await writeFile(billingPath,JSON.stringify(ledger));
const server=createServer({rosterPath,billingPath,lockPath:path.join(dir,'lock'),notesPath:path.join(dir,'notes')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  page.setDefaultTimeout(10000);
  await page.route('https://**/*', route=>route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('.patient').first().waitFor();
  const list=page.locator('#roster'),toggle=page.locator('#add-patient-section summary');
  const tall=await list.evaluate(el=>el.clientHeight);
  await toggle.click();await page.locator('#other-form').waitFor();
  assert.ok(tall>await list.evaluate(el=>el.clientHeight)+100);
  await toggle.click();
  const tab=page.locator('[data-section=patients]'),root=page.locator('#patients-workspace');
  const row=id=>root.locator('[data-roster-patient="'+id+'"]');
  await tab.click();
  const record=row('sample'), number=record.locator('.family-contact');
  assert.match(await number.innerText(),/Sam Example \(Son\)/);
  await number.getByRole('button',{name:'Copy number'}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),contacts[0].phone);
  assert.equal(await number.getByRole('link').getAttribute('href'),'tel:6045550142');
  const fits=await record.locator('.pinned-unit').evaluate(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    return range.getClientRects().length===1&&range.getBoundingClientRect().right<=el.closest('td').getBoundingClientRect().right;
  });
  assert.ok(fits,'DEWDNEY must fit on one line inside its own column');
  const form=root.locator('.family-contact-dialog');
  async function enter(row,action,name,relationship,phone){
    await row.getByRole('button',{name:action,exact:true}).click();
    await form.getByLabel('Contact name').fill(name);await form.getByLabel('Relationship').fill(relationship);
    await form.getByLabel('Phone number').fill(phone);await form.getByRole('button',{name:'Save contact'}).click();
    await form.waitFor({state:'hidden'});
  }
  await enter(record,'+ Add contact','Casey Example','Daughter','604-555-0103');
  assert.equal(await record.locator('.family-contact').count(),2);
  await enter(row('second'),'+ Add contact','Robin Example','Spouse','604-555-0168');
  await enter(row('second'),'Edit','Robin Example','Partner','604-555-0188');
  assert.deepEqual(JSON.parse(await readFile(rosterPath,'utf8')),roster);
  await page.locator('#sync:not([disabled])').click();
  await page.waitForFunction(()=>!document.querySelector('#sync').textContent.includes('Saving') && document.querySelector('#local-changes').dataset.state!=='busy');
  assert.match(await page.locator('#local-changes').innerText(),/Saved to folder/,await page.locator('#session-status').textContent());
  await page.reload();await page.locator('.patient').first().waitFor();await tab.click();
  assert.match(await row('second').innerText(),/Partner/);
  assert.equal(await row('second').locator('.family-contact a').getAttribute('href'),'tel:6045550188');
  assert.equal(await record.locator('.family-contact').count(),2);
  for(const [id,key] of [['second','roster:second'],['sample','phn:0000000001']]){
    await row(id).getByRole('button',{name:'Open billing',exact:true}).click();
    await page.locator('#billing #editor h2').waitFor();
    assert.equal(await page.locator('.patient.selected').getAttribute('data-patient'),key);
    assert.match(await page.locator('#editor h2').innerText(),/Example, Morgan/);
    assert.equal(await page.locator('#billing').getAttribute('data-mode'),'concern');
    await tab.click();
  }
  assert.deepEqual(JSON.parse(await readFile(billingPath,'utf8')),ledger);
  console.log('PASS visible family contacts, clipboard, ZAC call target, edit/save/reload, unit label, space for results and same-name billing navigation for both roster types.');
} finally {
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
}
