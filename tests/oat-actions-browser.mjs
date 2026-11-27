// Fictional records only; clipboard and phone changes never touch live data.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'oat-actions-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),oatPath=path.join(dir,'oat-fh-roster.json'),purplePath=path.join(dir,'oat-purple-roster.json');
const patients=[
  {id:'one',name:'Example, Alex',phn:'0000000001',ava:'1234567',status:'active',phone:'604-555-0101'},
  {id:'two',name:'Sample, Robin',phn:'0000000002',ava:'1234568',status:'active'},
  {id:'old',name:'History, Taylor',phn:'0000000003',ava:'1234569',status:'history'}
];
const roster={patients:[{id:'trim-one',name:'Example, Morgan',phn:'0000000004',ava:'1234570',unit:'cedar',room:'1',codes:'401',familyContacts:[
  {name:'Public guardianship (synthetic)',phone:'604-555-0102'},
  {name:'Synthetic contact',relationship:'PG/T',phone:'604-555-0103'},
  {name:'Synthetic daughter',relationship:'Daughter',phone:'604-555-0104'}
]}],otherPatients:[],removedPatients:[],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[]};
const oat={schemaVersion:1,clinic:'oat-fh',patients,clinicDays:[]},purple={...oat,clinic:'oat-purple'};
const ledger=JSON.stringify(blankLedger('oat-actions-test'));
await Promise.all([writeFile(rosterPath,JSON.stringify(roster)),writeFile(billingPath,ledger),writeFile(oatPath,JSON.stringify(oat)),writeFile(purplePath,JSON.stringify(purple)),mkdir('work',{recursive:true})]);
const server=createServer({rosterPath,billingPath,oatPath,purplePath,lockPath:path.join(dir,'lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
if(process.env.TRIM_ASSET_BASE)await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/')&&(url.pathname==='/'||/\.(mjs|css|html|svg)$/.test(url.pathname))){
    const response=await fetch(process.env.TRIM_ASSET_BASE+(url.pathname==='/'?'index.html':url.pathname.slice(1))+url.search);assert.ok(response.ok);
    await route.fulfill({status:200,contentType:response.headers.get('content-type'),body:await response.text()});
  }else await route.fallback();
});
const origin=`http://127.0.0.1:${server.address().port}`;
const expected=p=>`${p.name}\nPHN: ${p.phn}\n\nJust wanted to confirm if this patient is still under my care for OAT in our system?\nThanks!`;
try{
  await page.goto(origin+'/?section=oat-fh');
  const host=page.locator('#oat-fh-workspace'),panel=host.locator('[data-oat-patients]');
  await host.getByRole('button',{name:'Active patients',exact:true}).click();
  const first=panel.locator('tbody tr').first(),second=panel.locator('tbody tr').nth(1),message=first.locator('.oat-patient-message');
  await message.waitFor();assert.equal(await panel.locator('thead th').last().innerText(),'Actions');
  assert.equal(await first.locator('td').last().locator('.oat-patient-message').count(),1);
  assert.equal(await first.locator('td').last().locator('.clinic-phone-edit').count(),1);
  assert.equal(await first.locator('td').nth(3).locator('.clinic-phone-edit').count(),0);
  await message.click();assert.equal(await page.evaluate(async()=>(await navigator.clipboard.readText()).replaceAll('\r\n','\n')),expected(patients[0]));
  assert.equal(await host.locator('dialog:modal').count(),0);
  await message.click({button:'right'});
  const dialog=host.getByRole('dialog',{name:'OAT care confirmation'});
  assert.equal(await dialog.getByRole('textbox',{name:'Message'}).inputValue(),expected(patients[0]));
  await dialog.getByRole('textbox',{name:'Message'}).fill(expected(patients[0])+'\nEdited for this conversation.');
  await dialog.getByRole('button',{name:'Copy message',exact:true}).click();
  assert.match(await page.evaluate(async()=>(await navigator.clipboard.readText()).replaceAll('\r\n','\n')),/Edited for this conversation\.$/);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await second.locator('.oat-patient-message').click();assert.equal(await page.evaluate(async()=>(await navigator.clipboard.readText()).replaceAll('\r\n','\n')),expected(patients[1]));
  await message.click();assert.match(await page.evaluate(async()=>(await navigator.clipboard.readText()).replaceAll('\r\n','\n')),/Edited for this conversation\.$/);
  await message.focus();await page.keyboard.press('Shift+F10');assert.equal(await dialog.isVisible(),true);await dialog.getByRole('button',{name:'Close',exact:true}).click();

  // A clipboard denial leaves selectable text for manual copying.
  await page.evaluate(()=>{window.savedClipboardWrite=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=()=>Promise.reject(new Error('denied'));});
  await second.locator('.oat-patient-message').click();await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox',{name:'Message'}).inputValue(),expected(patients[1]));
  assert.match(await dialog.locator('[role=status]').innerText(),/Select and copy/);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>{navigator.clipboard.writeText=window.savedClipboardWrite;delete window.savedClipboardWrite;});

  await first.getByRole('button',{name:'Actions for Example, Alex',exact:true}).click();
  await host.getByRole('button',{name:'Edit phone…',exact:true}).click();
  await host.getByRole('textbox',{name:'Phone number'}).fill('604-555-0199');
  await host.getByRole('button',{name:'Save phone',exact:true}).click();
  await first.getByRole('link',{name:/Call Example, Alex.*604-555-0199/}).waitFor();
  await second.getByRole('button',{name:'Actions for Sample, Robin',exact:true}).click();
  await host.getByRole('button',{name:'Add phone…',exact:true}).click();
  await host.getByRole('textbox',{name:'Phone number'}).fill('604-555-0198');
  await host.getByRole('button',{name:'Save phone',exact:true}).click();
  await second.getByRole('link',{name:/Call Sample, Robin.*604-555-0198/}).waitFor();
  assert.deepEqual(JSON.parse(await readFile(oatPath,'utf8')).patients.map(p=>p.phone),['604-555-0199','604-555-0198',undefined]);

  for(const width of [1440,1920,390]){
    await page.setViewportSize({width,height:940});
    const tableBox=await panel.locator('.clinic-table-wrap').boundingBox();
    assert.ok(tableBox.x>=0&&tableBox.x+tableBox.width<=width,'Roster scrolls inside its own container');
    const metrics=await first.evaluate(row=>{
      const actions=row.lastElementChild.getBoundingClientRect(),menu=row.querySelector('.clinic-phone-edit').getBoundingClientRect(),message=row.querySelector('.oat-patient-message').getBoundingClientRect();
      return {gap:actions.right-menu.right,overlap:message.right-menu.left};
    });
    assert.ok(metrics.gap>=10&&metrics.gap<20,'Menu is at the far right');assert.ok(metrics.overlap<=1,'Action icons do not overlap');
  }
  await page.setViewportSize({width:1440,height:940});await page.screenshot({path:'work/oat-fh-actions-synthetic.png'});
  await page.reload();await host.getByRole('button',{name:'Active patients',exact:true}).click();await first.getByRole('link',{name:/604-555-0199/}).waitFor();
  await message.click();assert.equal(await page.evaluate(async()=>(await navigator.clipboard.readText()).replaceAll('\r\n','\n')),expected(patients[0]));
  await host.getByRole('button',{name:'Patient history',exact:true}).click();await host.getByRole('button',{name:'Copy OAT care confirmation for History, Taylor'}).click();assert.equal(await page.evaluate(async()=>(await navigator.clipboard.readText()).replaceAll('\r\n','\n')),expected(patients[2]));
  await page.locator('[data-section="oat-purple"]').click();const purpleHost=page.locator('#oat-purple-workspace');
  await purpleHost.getByRole('button',{name:'Active patients',exact:true}).click();await purpleHost.locator('tbody tr').first().waitFor();
  assert.equal(await purpleHost.locator('.oat-patient-message').count(),0);
  assert.equal(await purpleHost.locator('[data-oat-patients] thead th').count(),6);

  await page.locator('[data-section="patients"]').click();
  const contact=page.locator('#patients-workspace .family-contact');await contact.first().waitFor();
  assert.equal(await contact.nth(0).locator('.family-contact-role').innerText(),'PG/T');
  assert.equal(await contact.nth(1).locator('.family-contact-role').innerText(),'PG/T');
  assert.equal(await contact.nth(2).locator('.family-contact-role').count(),0);
  assert.ok(await contact.nth(0).locator('.family-contact-role').isVisible());
  assert.equal(await contact.nth(0).getByRole('link').getAttribute('href'),'tel:6045550102');
  await contact.nth(0).getByRole('button',{name:/Copy number/}).click();assert.equal(await page.evaluate(async()=>(await navigator.clipboard.readText()).replaceAll('\r\n','\n')),'604-555-0102');
  await page.screenshot({path:'work/trim-pgt-synthetic.png'});
  assert.equal(await readFile(rosterPath,'utf8'),JSON.stringify(roster));assert.equal(await readFile(billingPath,'utf8'),ledger);assert.equal(await readFile(purplePath,'utf8'),JSON.stringify(purple));
  assert.deepEqual(errors,[]);
  console.log('PASS OAT FH right-aligned actions, exact message copy/edit/fallback, patient draft isolation, phone edit/add/reload, history, responsive layout, unchanged Purple, and visible TRIM PG/T with working phone controls.');
}catch(error){console.error('Browser errors:',errors);await page.screenshot({path:'work/oat-actions-failure.png'});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
