// Fictional schedule only. No EMR requests or real patient data.
import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'oat-schedule-')),rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),oatPath=path.join(dir,'oat.json');
const patients=[{id:'one',name:'Jordan Lee (sample)',ava:'1234567',phn:'0000000001',status:'active'},{id:'two',name:'Sam Patel (sample)',ava:'1234568',phn:'0000000002',status:'active'},{id:'three',name:'Morgan Chen (sample)',ava:'1234569',phn:'0000000003',status:'active'}];
const records={schemaVersion:1,clinic:'oat-fh',patients,clinicDays:[{date:'2026-11-13',appointments:[{id:'a',time:'09:00',patientId:'one',note:'Follow-up'},{id:'b',time:'09:20',patientId:'two',note:'In person'},{id:'c',time:'09:40',patientId:'three',note:'Telephone'},{id:'d',time:'10:00',label:'Break'},{id:'e',time:'10:20',sourceName:'Alex Taylor (sample)',note:'New patient'}]}]};
const original=JSON.stringify(records);await Promise.all([writeFile(rosterPath,JSON.stringify({patients:[],otherPatients:[],removedPatients:[],units:[],billingDates:[]})),writeFile(billingPath,JSON.stringify(blankLedger('schedule-test'))),writeFile(oatPath,original),mkdir('work',{recursive:true})]);
const server=createServer({rosterPath,billingPath,oatPath,lockPath:path.join(dir,'lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1240,height:940}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/?section=oat-fh`);const host=page.locator('#oat-fh-workspace');
 const setDate=async value=>{await host.locator('[data-calendar]').click();await host.locator('#oat-calendar [data-date="'+value+'"]').click();};
 await setDate('2026-11-13');await host.getByText('4 appointments',{exact:true}).waitFor();
 assert.equal(await host.locator('.oat-schedule-table tbody tr').count(),5);assert.equal(await host.locator('.oat-schedule-table tbody a').count(),3);assert.equal(await host.locator('.oat-schedule-table tbody a').first().getAttribute('href'),'https://www.avaemr.ca/patients/1234567');assert.match(await host.locator('.oat-schedule-table').innerText(),/Patient match needed/);
 await page.screenshot({path:'work/oat-schedule-preview.png',fullPage:true});
 await setDate('2026-11-20');await host.getByRole('heading',{name:'No schedule saved',exact:true}).waitFor();assert.equal(await host.locator('.oat-schedule-table').isVisible(),false);
 await host.getByRole('button',{name:'All patients',exact:true}).click();assert.deepEqual(await host.locator('[data-oat-patients] thead th').allTextContents(),['#','Patient','PHN']);assert.equal(await host.locator('[data-oat-patients] tbody tr').count(),3);assert.doesNotMatch(await host.locator('[data-oat-patients]').getByRole('searchbox').getAttribute('placeholder'),/location/i);
 await host.getByRole('button',{name:'Schedule',exact:true}).click();await setDate('2026-11-13');await page.setViewportSize({width:390,height:844});assert.equal(await host.locator('.oat-schedule-table tbody a').count(),3);assert.ok(await host.getByRole('button',{name:'Choose clinic date',exact:true}).isVisible());
 assert.equal(await readFile(oatPath,'utf8'),original);
 await host.getByRole('searchbox',{name:'Search clinic day'}).fill('Patel');assert.equal(await host.locator('.oat-schedule-table tbody tr').count(),1);
 await host.getByRole('searchbox',{name:'Search clinic day'}).fill('000-000-0001');assert.equal(await host.locator('.oat-schedule-table tbody tr').count(),1);
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);await host.getByRole('button',{name:'Copy PHN for Jordan Lee (sample)'}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'0000000001');
 await host.getByRole('searchbox',{name:'Search clinic day'}).fill('');
 await host.getByRole('checkbox',{name:'Finished appointment for Sam Patel (sample)'}).click();
 await host.locator('.oat-save-status').filter({hasText:'Saved to laptop'}).waitFor();assert.equal(await host.locator('.oat-schedule-table tbody tr').count(),4);
 assert.equal(JSON.parse(await readFile(oatPath,'utf8')).clinicDays[0].appointments[1].finished,true);
 await page.reload();await host.getByText('4 appointments',{exact:true}).waitFor();
 assert.equal(await host.locator('.oat-schedule-table tbody tr').count(),4);
 await host.locator('.oat-completed summary').click();assert.match(await host.locator('.oat-completed').innerText(),/Sam Patel/);
 await host.locator('.oat-completed input[type=checkbox]').click();await host.locator('.oat-save-status').filter({hasText:'Saved to laptop'}).waitFor();
 assert.equal(await host.locator('.oat-schedule-table tbody tr').count(),5);
 assert.equal(await host.locator('[data-appointment=d] input[type=checkbox]').count(),0);
 await setDate('2026-11-20');await host.getByRole('heading',{name:'No schedule saved',exact:true}).waitFor();await setDate('2026-11-13');
 const changed=JSON.parse(await readFile(oatPath,'utf8'));changed.clinicDays[0].appointments[0].time='08:50';await writeFile(oatPath,JSON.stringify(changed));
 await host.getByRole('checkbox',{name:'Finished appointment for Jordan Lee (sample)'}).click();await host.locator('.oat-schedule-status').filter({hasText:'changed elsewhere'}).waitFor();
 assert.equal(JSON.parse(await readFile(oatPath,'utf8')).clinicDays[0].appointments[0].finished,undefined);
 await page.setViewportSize({width:1240,height:940});await host.locator('[data-reload]').click();await host.getByRole('checkbox',{name:'Finished appointment for Jordan Lee (sample)'}).waitFor();
 const bounds=await host.locator('.oat-day-controls button').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})));assert.ok(bounds.every(b=>Math.abs(b.top-bounds[0].top)<2&&b.height===bounds[0].height));
 await page.screenshot({path:'work/oat-schedule-updated.png',fullPage:true});

 const pending=structuredClone(records);pending.patients[0].ava=null;await writeFile(oatPath,JSON.stringify(pending));await host.locator('[data-reload]').click();await host.locator('.oat-schedule-table').getByText('Ava number pending',{exact:true}).waitFor();assert.equal(await host.locator('.oat-schedule-table tbody a').count(),2);await host.getByRole('button',{name:'All patients',exact:true}).click();await host.locator('[data-oat-patients]').getByText('Ava number pending',{exact:true}).waitFor();
 pending.patients[0].ava='1234567';await writeFile(oatPath,JSON.stringify(pending));await host.locator('[data-oat-patients]').getByRole('button',{name:'Reload OAT FH',exact:true}).click();await host.locator('[data-oat-patients] tbody a').filter({hasText:'Jordan Lee'}).waitFor();await host.getByRole('button',{name:'Schedule',exact:true}).click();assert.equal(await host.locator('.oat-schedule-table tbody a').count(),3);
 assert.deepEqual(errors,[]);console.log('PASS RAAC dated schedule, pending Ava patients, later chart links, unmatched names, breaks, empty dates, no OAT Location column, patient roster and mobile.');
}catch(error){console.log(await page.locator('body').innerText(),errors);throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
