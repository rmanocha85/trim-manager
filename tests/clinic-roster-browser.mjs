// Synthetic records only; no production paths or external requests.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from './server-fixture.mjs';
import {blankLedger} from '../public/core.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'trim-clinic-'));
const rosterPath=path.join(dir,'roster.json'),billingPath=path.join(dir,'billing.json'),maidPath=path.join(dir,'maid-roster.json');
const panel={id:'synthetic',name:'SYNTHETIC, Panel',phn:'0000000001',ava:'123456',unit:'cedar',room:'1',codes:'401'};
const roster=JSON.stringify({patients:[panel],otherPatients:[],removedPatients:[],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[]});
const ledger=JSON.stringify(blankLedger('synthetic-clinic'));
const people=[{id:'z',name:'Zulu Synthetic',ava:'123457',phn:'0000000002',status:'active',location:'Home'}, {id:'a',name:'Alpha Synthetic',ava:'123458',phn:'0000000003',status:'active',location:'Hospice'}, {id:'h',name:'History Synthetic',ava:null,phn:null,status:'history',location:null}];
people[0].contacts=[
 {name:'Zulu Synthetic',role:'Patient - preferred contact on 1632',phone:'604-555-0101',primary:true,source:'Synthetic 1632 patient/contact sections',sourceDate:'2026-10-01',verifiedDate:'2026-11-08'},
 {name:'Family Synthetic',role:'Son - MAID referral contact',phone:'604-555-0102',primary:false,source:'Synthetic referral',verifiedDate:'2026-11-08'},
 {name:'Team Synthetic',role:'Inpatient team',phone:'604-555-0103',extension:'42',facility:'Synthetic hospital',unit:'Unit A',source:'Synthetic referral'},
 {name:'Witness Synthetic',role:'Witness',phone:null,source:'Synthetic 1632 witness section'}
];
people[2].contacts=[{name:'History Synthetic',role:'Patient',phone:'604-555-0104'},{name:'Contact Synthetic',role:'Preferred contact',relationship:'Daughter',primary:true,phone:'604-555-0105',source:'Synthetic 1632',verifiedDate:'2026-11-08'}];
const maid=JSON.stringify({schemaVersion:1,patients:people});
await Promise.all([writeFile(rosterPath,roster),writeFile(billingPath,ledger),writeFile(maidPath,maid),mkdir('work',{recursive:true})]);
const server=createServer({rosterPath,billingPath,maidPath,lockPath:path.join(dir,'test.lock')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.route('https://**/*',r=>r.abort());
try{
 assert.equal((await fetch(origin+'/api/maid/roster')).status,401);
 await page.goto(origin+'/?section=maid');const m=page.locator('#maid-workspace');await m.locator('tbody tr').first().waitFor();
 assert.deepEqual(await m.locator('tbody a[target="_blank"]').allTextContents(),['Zulu Synthetic','Alpha Synthetic']);
 assert.equal(await m.locator('tbody a[target="_blank"]').first().getAttribute('href'),'https://www.avaemr.ca/patients/123457');
 assert.deepEqual(await m.locator('thead th').allTextContents(),['#','Patient','PHN','Patient phone','Primary / family contact','Location','Assessment','1645','Details / actions']);
 const first=m.locator('tbody tr').first(),own=first.locator('.clinic-patient-phone'),family=first.locator('.clinic-contacts');
 assert.match(await own.innerText(),/Patient - preferred contact on 1632/);assert.doesNotMatch(await own.innerText(),/Family Synthetic/);
 assert.equal(await own.locator('a').getAttribute('href'),'tel:6045550101');
 assert.match(await family.innerText(),/Family Synthetic/);assert.match(await family.innerText(),/Son - MAID referral contact/);assert.match(await family.innerText(),/Care team \/ inpatient/);assert.match(await family.innerText(),/Synthetic hospital · Unit A/);assert.match(await family.innerText(),/Other contacts\s+Witness Synthetic/);
 assert.equal(await family.getByRole('link',{name:/Call Team Synthetic/}).getAttribute('href'),'tel:6045550103');
 assert.match(await family.getByRole('link',{name:/Call Team Synthetic/}).getAttribute('title'),/enter extension 42 after connection/);
 assert.equal(await first.locator('.clinic-phn-copy').innerText(),'');assert.equal(await first.locator('.clinic-phn-copy svg').count(),1);
 await first.locator('summary').click();assert.match(await first.locator('.clinic-contact-sources').innerText(),/Synthetic 1632 patient\/contact sections · Source date: 2026-10-01 · Verified: 2026-11-08/);await first.locator('summary').click();
 assert.equal(await m.locator('tbody tr').nth(1).locator('.clinic-patient-phone').innerText(),'Not recorded');
 // Inspect links only: no protocol navigation and no external call is permitted in this test.
 await m.getByRole('button',{name:'Copy PHN for Zulu Synthetic',exact:true}).click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'0000000002');
 assert.equal(await m.locator('.clinic-feedback').innerText(),'PHN copied.');
 await m.getByRole('searchbox').fill('hospice');assert.equal(await m.locator('tbody tr').count(),1);assert.equal(await m.locator('tbody td').first().innerText(),'2');
 await m.getByRole('searchbox').fill('');await m.getByRole('button',{name:'History',exact:true}).click();assert.equal(await m.locator('tbody a[target="_blank"]').count(),0);assert.match(await m.innerText(),/Ava number needed/);
 assert.equal(await m.locator('.clinic-patient-phone a').getAttribute('href'),'tel:6045550104');assert.match(await m.locator('.clinic-contacts').innerText(),/Preferred contact · Daughter/);assert.equal(await m.locator('.clinic-contacts a').getAttribute('href'),'tel:6045550105');
 await m.getByRole('button',{name:'All',exact:true}).click();assert.equal(await m.locator('tbody tr').count(),3);
 await page.locator('[data-section="oat-fh"]').click();const oat=page.locator('#oat-fh-workspace');assert.match(await oat.innerText(),/Waiting for your patient list/);
 // Exercise the same ordered renderer with synthetic OAT data; it never saves.
 await page.evaluate(async data=>{const {clinicRosterUI}=await import('./clinic-roster.mjs');clinicRosterUI({host:document.querySelector('#oat-fh-workspace'),kind:'oat-fh'}).setPatients(data);},people.slice(0,2));
 assert.deepEqual(await oat.locator('tbody a').allTextContents(),['Zulu Synthetic','Alpha Synthetic']);
 await oat.getByRole('searchbox').fill('alpha');assert.equal(await oat.locator('tbody td').first().innerText(),'2');
 await page.locator('[data-section="patients"]').click();assert.equal(await page.locator('#patients-workspace').isVisible(),true);assert.equal(await m.isVisible(),false);
 await page.locator('[data-section="billing"]').click();assert.equal(await page.locator('.shell').isVisible(),true);
 await page.locator('[data-section="maid"]').click();await page.screenshot({path:'work/maid-roster-synthetic.png',fullPage:true});
 for(const width of [390,1024,1440,1920]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Page overflow at ${width}`);}
 assert.deepEqual(errors,[]);assert.equal(await readFile(rosterPath,'utf8'),roster);assert.equal(await readFile(billingPath,'utf8'),ledger);assert.equal(await readFile(maidPath,'utf8'),maid);

 // Persist status transitions, cancel removal, then remove all metadata and reject a stale tab.
 await m.getByRole('button',{name:'Active',exact:true}).click();
 await m.getByRole('button',{name:'Move to History',exact:true}).first().click();
 await m.locator('.clinic-feedback').filter({hasText:'Patient status saved.'}).waitFor();
 let saved=JSON.parse(await readFile(maidPath,'utf8'));assert.equal(saved.patients[0].status,'history');assert.equal(saved.patients[0].statusHistory.length,1);
 await m.getByRole('button',{name:'History',exact:true}).click();
 await m.locator('tbody tr').filter({hasText:'Zulu Synthetic'}).getByRole('button',{name:'Move to Active',exact:true}).click();
 await m.locator('.clinic-feedback').filter({hasText:'Patient status saved.'}).waitFor();
 await m.getByRole('button',{name:'Active',exact:true}).click();
 await m.getByRole('button',{name:'Remove Zulu Synthetic',exact:true}).click();await m.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(JSON.parse(await readFile(maidPath,'utf8')).patients.length,3);
 await m.getByRole('button',{name:'Remove Zulu Synthetic',exact:true}).click();await m.getByRole('button',{name:'Remove patient',exact:true}).click();
 await m.locator('.clinic-feedback').filter({hasText:'Patient removed.'}).waitFor();
 saved=JSON.parse(await readFile(maidPath,'utf8'));assert.equal(saved.patients.length,2);assert.ok(!JSON.stringify(saved).includes('Zulu Synthetic'));
 await page.reload();await m.locator('tbody tr').first().waitFor();assert.equal(await m.locator('tbody tr').count(),1);
 const external=JSON.parse(await readFile(maidPath,'utf8'));external.patients=external.patients.filter(p=>p.id!=='a');await writeFile(maidPath,JSON.stringify(external));
 await m.getByRole('button',{name:'Move to History',exact:true}).click();await m.locator('.clinic-feedback').filter({hasText:'changed elsewhere'}).waitFor();
 assert.deepEqual(JSON.parse(await readFile(maidPath,'utf8')).patients,external.patients);
 await m.getByRole('button',{name:'Reload MAID',exact:true}).click();await m.locator('.clinic-empty').filter({hasText:'No patients match'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS clinic navigation, private read access, Ava links, PHN clipboard, search, stable order, history, OAT placeholder, responsive layout, persisted status, confirmed removal, stale-tab rejection, unchanged TRIM files.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
