// Fictional patients in temporary JSON files. No live clinic records are read or changed.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';
import {pacificDate} from '../public/oat-schedule.mjs';
import {applyOatAction} from '../public/oat-roster-repository.mjs';
import {oatStatusAction} from '../public/oat-patient-status.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'oat-history-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),oatPath=path.join(dir,'oat-fh-roster.json'),purplePath=path.join(dir,'oat-purple-roster.json');
const patients=[
  {id:'one',name:'Example, Alex',phn:'0000000001',alternatePhns:[{phn:'0000000009',jurisdiction:'BC'}],ava:'1234567',status:'active',phone:'604-555-0101'},
  {id:'old',name:'Sample, Robin',phn:'0000000002',ava:'1234568',status:'history',statusHistory:[{from:'active',to:'history',date:'2026-11-17',source:'synthetic.csv'}]}
];
const clinicDays=[{date:pacificDate(),appointments:[{id:'a',time:'09:00',patientId:'one',sourcePhn:'0000000009'},{id:'b',time:'09:20',patientId:'old'},{id:'break',time:'09:40',label:'Break'}]}];
const oat={schemaVersion:1,clinic:'oat-fh',patients,clinicDays},purple={...oat,clinic:'oat-purple'};
const trim=JSON.stringify({patients:[],otherPatients:[],removedPatients:[],units:[],billingDates:[]}),ledger=JSON.stringify(blankLedger('oat-history-test'));
await Promise.all([writeFile(rosterPath,trim),writeFile(billingPath,ledger),writeFile(oatPath,JSON.stringify(oat)),writeFile(purplePath,JSON.stringify(purple)),mkdir('work',{recursive:true})]);
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
const read=async file=>JSON.parse(await readFile(file,'utf8'));
try{
  for(const [clinic,file,other] of [['oat-fh',oatPath,purplePath],['oat-purple',purplePath,oatPath]]){
    const untouchedOther=await readFile(other,'utf8');
    await page.goto(origin+'/?section='+clinic);
    const host=page.locator('#'+clinic+'-workspace'),panel=host.locator('[data-oat-patients]'),history=host.getByRole('button',{name:'Patient history',exact:true}),active=host.getByRole('button',{name:'Active patients',exact:true}),notice=panel.locator('.oat-status-notice'),search=panel.getByRole('searchbox');
    await history.click();await panel.getByRole('link',{name:'Sample, Robin',exact:true}).waitFor();
    assert.equal(await active.locator('span').innerText(),'1');assert.equal(await history.locator('span').innerText(),'1');
    assert.match(await panel.locator('.oat-status-date').innerText(),/Nov 17/);
    const restoreIcon=await panel.locator('.oat-reactivate svg').boundingBox();assert.ok(restoreIcon.width>=16&&restoreIcon.height>=16,'Reactivate icon is visible');
    await search.fill('Robin Sample');assert.equal(await panel.locator('tbody tr').count(),1);
    await search.fill('0000-000-002');assert.equal(await panel.locator('tbody tr').count(),1);
    await search.fill('1234568');assert.equal(await panel.locator('tbody tr').count(),1);
    await active.click();await panel.getByRole('button',{name:'Search history',exact:true}).click();assert.equal(await search.inputValue(),'1234568');
    await panel.getByRole('button',{name:'Reactivate Sample, Robin',exact:true}).click();
    await notice.getByText(/Sample, Robin reactivated/).waitFor();assert.equal(await panel.locator('tbody tr').count(),0);
    assert.equal(await active.locator('span').innerText(),'2');assert.equal(await history.locator('span').innerText(),'0');
    const reactivated=(await read(file)).patients.find(p=>p.id==='old');assert.equal(reactivated.status,'active');assert.equal(reactivated.ava,'1234568');
    await notice.getByRole('button',{name:'View active',exact:true}).click();await panel.getByRole('link',{name:'Sample, Robin',exact:true}).waitFor();
    await notice.getByRole('button',{name:'Undo',exact:true}).click();await notice.getByText(/Status change undone/).waitFor();
    assert.equal((await read(file)).patients.find(p=>p.id==='old').status,'history');assert.equal(await active.locator('span').innerText(),'1');
    await history.click();await search.fill('');await panel.getByRole('button',{name:'Reactivate Sample, Robin',exact:true}).click();await notice.getByText(/reactivated/).waitFor();
    await page.reload();await active.click();await panel.getByRole('link',{name:'Sample, Robin',exact:true}).waitFor();
    assert.equal(await panel.locator('tbody tr').count(),2);assert.equal(await notice.isVisible(),false);
    await panel.getByRole('button',{name:'Actions for Sample, Robin',exact:true}).click();await panel.getByRole('button',{name:'Move to history',exact:true}).click();
    await notice.getByText(/moved to history/).waitFor();await notice.getByRole('button',{name:'Undo',exact:true}).click();await notice.getByText(/Status change undone/).waitFor();
    await panel.getByRole('link',{name:'Sample, Robin',exact:true}).waitFor();

    // Current-day phone controls work directly, including the completed section.
    await host.getByRole('button',{name:'Schedule',exact:true}).click();
    await host.getByRole('button',{name:'Choose clinic date',exact:true}).click();await host.locator('.oat-calendar [data-date="'+pacificDate()+'"]').click();
    const schedule=host.locator('.oat-schedule-table'),phoneForm=host.locator('.clinic-remove-dialog');
    await schedule.getByRole('button',{name:'Copy PHN for Example, Alex',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'0000000009','Schedule keeps the supplied provincial identifier');
    await host.getByRole('searchbox',{name:'Search clinic day',exact:true}).fill('0000-000-009');assert.equal(await schedule.locator('tbody tr').count(),1);assert.equal(await schedule.getByRole('link',{name:'Example, Alex',exact:true}).getAttribute('href'),'https://www.avaemr.ca/patients/1234567');await host.getByRole('searchbox',{name:'Search clinic day',exact:true}).fill('');
    const addIcon=await schedule.getByRole('button',{name:'Add phone number for Sample, Robin',exact:true}).locator('svg').boundingBox();assert.ok(addIcon.width>=16&&addIcon.height>=16,'Missing-phone icon is visible on the schedule');
    await schedule.getByRole('button',{name:'Edit phone number for Example, Alex',exact:true}).click();
    assert.equal(await phoneForm.getByRole('link',{name:/Call Example, Alex/}).getAttribute('href'),'tel:6045550101');
    await phoneForm.getByRole('button',{name:'Cancel',exact:true}).click();
    await schedule.getByRole('button',{name:'Copy number for Example, Alex',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'604-555-0101');
    await schedule.getByRole('button',{name:'Add phone number for Sample, Robin',exact:true}).click();await phoneForm.getByRole('textbox',{name:'Phone number'}).fill('604-555-0112');await phoneForm.getByRole('button',{name:'Save phone'}).click();
    await schedule.locator('.roster-phone[data-roster-tip*="604-555-0112"]').waitFor();
    await schedule.getByRole('button',{name:'Actions for Sample, Robin',exact:true}).click();await host.getByRole('button',{name:'Edit phone…',exact:true}).click();await phoneForm.getByRole('textbox',{name:'Phone number'}).fill('604-555-0113');await phoneForm.getByRole('button',{name:'Save phone'}).click();
    await schedule.locator('.roster-phone[data-roster-tip*="604-555-0113"]').waitFor();
    await schedule.getByRole('checkbox',{name:'Finished appointment for Sample, Robin'}).check();await host.getByText('Saved to laptop folder · cloud sync unverified.',{exact:true}).waitFor();
    await host.locator('.oat-completed summary').click();await host.locator('.oat-completed').getByRole('button',{name:'Edit phone number for Sample, Robin',exact:true}).click();assert.equal(await phoneForm.getByRole('link',{name:/Call Sample, Robin/}).getAttribute('href'),'tel:6045550113');await phoneForm.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.reload();await host.getByRole('button',{name:'Choose clinic date'}).click();await host.locator('.oat-calendar [data-date="'+pacificDate()+'"]').click();await host.locator('.oat-completed summary').click();await host.locator('.oat-completed .roster-phone[data-roster-tip*="604-555-0113"]').waitFor();
    await active.click();
    await panel.getByRole('button',{name:'Actions for Example, Alex',exact:true}).click();await panel.getByRole('button',{name:'Move to history',exact:true}).click();await notice.getByText(/moved to history/).waitFor();
    // Undo must keep a phone edit made in the meantime, even by another browser.
    const changed=await read(file);changed.patients[0].phone='604-555-0199';await writeFile(file,JSON.stringify(changed));
    await notice.getByRole('button',{name:'Undo',exact:true}).click();await notice.getByText(/Status change undone/).waitFor();assert.equal((await read(file)).patients[0].phone,'604-555-0199');
    const saved=await read(file);assert.equal(saved.patients.length,2);assert.equal(saved.clinicDays[0].appointments[1].finished,true);assert.equal(saved.clinicDays[0].appointments[1].patientId,'old');
    assert.equal(await readFile(other,'utf8'),untouchedOther,'Actions stay in the selected clinic');
  }
  const host=page.locator('#oat-purple-workspace'),panel=host.locator('[data-oat-patients]'),notice=panel.locator('.oat-status-notice');
  // A failed write leaves the last verified records and disables further changes.
  await page.route('**/api/oat-purple/roster',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic save unavailable'})}):route.continue());
  const before=await readFile(purplePath,'utf8');await panel.getByRole('button',{name:'Actions for Example, Alex',exact:true}).click();await panel.getByRole('button',{name:'Move to history',exact:true}).click();
  await panel.locator('.clinic-load-status').filter({hasText:'Status change was not confirmed'}).waitFor();assert.equal(await readFile(purplePath,'utf8'),before);assert.equal(await notice.isVisible(),false);
  assert.equal(await panel.getByRole('button',{name:'Actions for Example, Alex',exact:true}).isDisabled(),true);
  await page.unroute('**/api/oat-purple/roster');await panel.getByRole('button',{name:'Reload OAT Purple',exact:true}).click();await panel.getByRole('button',{name:'Actions for Example, Alex',exact:true}).waitFor();
  // A newer status decision prevents Undo from overwriting it.
  await panel.getByRole('button',{name:'Actions for Example, Alex',exact:true}).click();await panel.getByRole('button',{name:'Move to history',exact:true}).click();await notice.getByText(/moved to history/).waitFor();
  let fresh=await read(purplePath);fresh=applyOatAction(fresh,oatStatusAction(fresh.patients[0],'oat-purple','active'));await writeFile(purplePath,JSON.stringify(fresh));
  await notice.getByRole('button',{name:'Undo',exact:true}).click();await panel.locator('.clinic-load-status').filter({hasText:'changed elsewhere'}).waitFor();assert.deepEqual(await read(purplePath),fresh);
  // Visible review flag and explicit resolution, each reversible.
  fresh.patients[0].statusReview={panelStatus:'history',asOf:'2026-11-27',source:'synthetic.csv',sha256:'synthetic'};await writeFile(purplePath,JSON.stringify(fresh));
  await panel.getByRole('button',{name:'Reload OAT Purple',exact:true}).click();await panel.getByText('Latest list differs',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'Actions for Example, Alex',exact:true}).click();await panel.getByRole('button',{name:'Keep current status',exact:true}).click();await notice.getByText(/kept active/).waitFor();assert.equal(await panel.getByText('Latest list differs',{exact:true}).count(),0);
  await notice.getByRole('button',{name:'Undo',exact:true}).click();await panel.getByText('Latest list differs',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'Actions for Example, Alex',exact:true}).click();await panel.getByRole('button',{name:'Use imported status: history',exact:true}).click();await notice.getByText(/moved to history/).waitFor();
  await notice.getByRole('button',{name:'View history',exact:true}).click();await panel.getByRole('button',{name:'Reactivate Example, Alex',exact:true}).waitFor();assert.equal((await read(purplePath)).patients[0].statusOverride,undefined);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:940});const bounds=await panel.locator('.clinic-table-wrap').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
    const toast=await notice.boundingBox();assert.ok(toast.x>=0&&toast.x+toast.width<=width);await page.screenshot({path:'work/oat-history-'+width+'-synthetic.png'});
  }
  assert.equal(await readFile(rosterPath,'utf8'),trim);assert.equal(await readFile(billingPath,'utf8'),ledger);assert.deepEqual(errors,[]);
  console.log('PASS both clinics: history search, reactivation, Undo, counts, reload, clinic isolation, current-day phone call/copy/add/edit and completed views, stale/save failure protection, review resolution and responsive layout.');
}catch(error){console.error('Browser errors:',errors);await page.screenshot({path:'work/oat-history-failure.png'});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
