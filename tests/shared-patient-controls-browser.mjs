import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'workos-fields-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json');
const first={id:'one',name:'Example, Alex',phn:'0000000001',unit:'test',room:'1',codes:'401'};
const second={id:'two',name:'Example, Robin',phn:'0000000002',unit:'test',room:'2',ava:'1234567',familyContacts:[{name:'Example, Sam',relationship:'Spouse',phone:'604-555-0101',extension:'42',source:'Preserve me'}]};
const roster={patients:[first],otherPatients:[second],removedPatients:[],units:[{id:'test',name:'EXAMPLE UNIT'}],billingDates:[]};
const ledger=JSON.stringify(blankLedger('shared-controls'));
await Promise.all([writeFile(rosterPath,JSON.stringify(roster)),writeFile(billingPath,ledger),mkdir('work',{recursive:true})]);
const server=createServer({rosterPath,billingPath,notesPath:path.join(dir,'notes'),lockPath:path.join(dir,'lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});page.setDefaultTimeout(12000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',route=>route.abort());
const read=async()=>JSON.parse(await readFile(rosterPath,'utf8'));
try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.patient').first().waitFor();
  await page.locator('[data-section=patients]').click();const root=page.locator('#patients-workspace'),row=id=>root.locator('[data-roster-patient="'+id+'"]');
  const contact=page.getByRole('dialog',{name:'Family contact',exact:true}),ava=page.getByRole('dialog',{name:'Ava EMR number',exact:true});
  // Make an unrelated pending roster edit before saving a contact.
  await row('one').locator('.patient-actions-toggle').click();await row('one').getByRole('button',{name:'Psychiatric consult',exact:true}).click();
  await row('one').getByRole('button',{name:'Add family contact for Example, Alex'}).click();
  await contact.getByLabel('Contact name').fill('Example, Casey');await contact.getByLabel('Relationship').fill('Son');await contact.getByLabel('Phone number',{exact:true}).fill('604-555-0100');
  await contact.getByRole('button',{name:'Save contact'}).click();await contact.waitFor({state:'hidden'});
  assert.equal((await read()).patients[0].pFlag,undefined);assert.equal((await read()).patients[0].familyContacts[0].name,'Example, Casey');
  assert.equal(await row('one').locator('.flag-psych').count(),1,'Pending flag remains in local draft');
  await row('two').getByRole('button',{name:'Edit contact for Example, Sam · Spouse'}).click();
  assert.equal(await contact.getByLabel('Extension (optional)').inputValue(),'42');assert.equal(await contact.getByRole('link').getAttribute('href'),'tel:6045550101');
  await contact.getByLabel('Phone number',{exact:true}).fill('604-555-0199');await contact.getByRole('button',{name:'Save contact'}).click();await contact.waitFor({state:'hidden'});
  assert.equal((await read()).otherPatients[0].familyContacts[0].source,'Preserve me');
  await row('two').getByRole('button',{name:'Copy number for Example, Sam · Spouse'}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'604-555-0199 ext. 42');
  await row('one').getByRole('button',{name:'Add Ava EMR number for Example, Alex'}).click();
  await ava.getByLabel('Ava EMR number',{exact:true}).fill('1234567');await ava.getByRole('button',{name:'Save Ava number'}).click();await ava.getByRole('alert').filter({hasText:'already assigned'}).waitFor();
  await ava.getByLabel('Ava EMR number',{exact:true}).fill('7654321');await ava.getByRole('button',{name:'Save Ava number'}).click();await ava.waitFor({state:'hidden'});
  assert.equal((await read()).patients[0].ava,'7654321');assert.equal((await read()).patients[0].pFlag,undefined);
  await page.screenshot({path:'work/shared-controls-roster.png'});
  // Billing opens exactly the same editor while retaining its own unsaved ledger.
  await row('one').getByRole('button',{name:'Open billing',exact:true}).click();await page.locator('#editor [data-code="00127"]').click();await page.locator('#editor .ava-edit').click();
  assert.equal(await ava.getByLabel('Ava EMR number',{exact:true}).inputValue(),'7654321');
  await ava.getByLabel('Ava EMR number',{exact:true}).fill('7654322');await ava.getByRole('button',{name:'Save Ava number'}).click();await ava.waitFor({state:'hidden'});
  assert.equal((await read()).patients[0].ava,'7654322');assert.equal(await readFile(billingPath,'utf8'),ledger);assert.equal(await page.locator('#editor [data-code="00127"].on').count(),1,'Pending billing remains in the editor');
  await page.locator('#editor [data-edit-contacts]').click();const choices=page.getByRole('dialog',{name:'Family contacts',exact:true});await choices.getByRole('button',{name:'Edit',exact:true}).click();
  for(const width of [1440,390]){await page.setViewportSize({width,height:940});const box=await contact.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);await page.screenshot({path:'work/shared-controls-contact-'+width+'.png'});}
  await contact.getByRole('button',{name:'Cancel'}).click();await page.setViewportSize({width:1440,height:1000});
  // Failed save retains input and shows no false success.
  await page.locator('#editor .ava-edit').click();await ava.getByLabel('Ava EMR number',{exact:true}).fill('7654323');
  await page.route('**/api/roster/document',route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic save unavailable'})}):route.continue());
  await ava.getByRole('button',{name:'Save Ava number'}).click();await ava.getByRole('alert').filter({hasText:'Synthetic save unavailable'}).waitFor();assert.equal(await ava.getByLabel('Ava EMR number',{exact:true}).inputValue(),'7654323');assert.equal((await read()).patients[0].ava,'7654322');
  await page.unroute('**/api/roster/document');await ava.getByRole('button',{name:'Save Ava number'}).click();await ava.waitFor({state:'hidden'});assert.equal((await read()).patients[0].ava,'7654323');
  // A concurrent change to the same field must stop this save.
  await page.locator('#editor .ava-edit').click();const remote=await read();remote.patients[0].ava='7654399';await writeFile(rosterPath,JSON.stringify(remote));
  await ava.getByLabel('Ava EMR number',{exact:true}).fill('7654324');await ava.getByRole('button',{name:'Save Ava number'}).click();await ava.getByRole('alert').filter({hasText:'changed elsewhere'}).waitFor();assert.equal((await read()).patients[0].ava,'7654399');
  assert.equal(await readFile(billingPath,'utf8'),ledger);assert.deepEqual(errors,[]);
  console.log('PASS shared patient controls: both TRIM rosters, Billing, extensions, duplicate/stale Ava, failures, targeted saves, pending work, mobile.');
}catch(error){console.error(errors);await page.screenshot({path:'work/shared-controls-failure.png'});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
