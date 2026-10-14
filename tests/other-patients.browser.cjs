const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0]==='/roster-core.js'?'roster-core.js':'index.html';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(root,name)));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const active={id:'own',name:'Synthetic Own',phn:'9000000001',ava:'900001',unit:'cedar',room:'1401',codes:'401'};
  const other=(id,name,phn,ava,extra={})=>({id,name,phn,ava,unit:'',room:'',codes:'',dob:'1940-01-01',...extra});
  let disk={patients:[active],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[],removedPatients:[],otherPatients:[other('other-1','Synthetic Alpha','9000000002','900002'),other('other-2','Synthetic Beta','9000000003','900003',{unit:'cedar',room:'1402',doctor:'Dr. Adam Siemens'}),other('other-3','Synthetic Gamma','9000000004','900004',{doctor:'Previously recorded doctor',extra:{keep:true}})],customRoot:{preserve:true}},revision=1,writes=0,rejectSave=false;
  const initial=structuredClone(disk);
  await page.route('https://www.googleapis.com/**',async route=>{
   const req=route.request();assert.ok(req.url().includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'));
   if(req.method()==='PUT'){
    if(rejectSave||req.headers()['if-match']!=='r'+revision){await route.fulfill({status:412,json:{}});return;}
    disk=JSON.parse(req.postData());revision++;writes++;await route.fulfill({json:{}});return;
   }
   assert.equal(req.method(),'GET');await route.fulfill({json:req.url().includes('alt=media')?disk:{etag:'r'+revision}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>{window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>o.callback({access_token:'synthetic',expires_in:3600})})}}};maybeSaveDailySnapshot=async()=>{};});
  await page.locator('#btn-connect').click();await page.waitForFunction(()=>!connectionChecking&&state.googleConnected);
  await page.getByRole('button',{name:'Other patients',exact:true}).click();
  assert.equal(await page.locator('#other-list tbody tr').count(),3);
  assert.equal(await page.locator('#other-list .pnm a').first().getAttribute('target'),'_blank');
  assert.equal(await page.getByRole('link',{name:'Synthetic Alpha',exact:true}).getAttribute('href'),'https://www.avaemr.ca/patients/900002');
  assert.equal(await page.locator('#other-list .phn-copy').count(),3);
  const select=()=>page.locator('[data-other-doctor="other-1"]');
  assert.equal(await select().inputValue(),'');
  assert.equal(await select().locator('option').count(),7); // blank, five current doctors, preserved historical value
  assert.equal(await select().locator('option',{hasText:'Onboarding'}).count(),1);
  await select().selectOption('Dr. Celine Laferriere');await page.evaluate(()=>saveQueue);
  assert.equal(disk.otherPatients[0].doctor,'Dr. Celine Laferriere');assert.equal(writes,1);
  assert.deepEqual(disk.patients,initial.patients);assert.deepEqual(disk.billingDates,initial.billingDates);assert.deepEqual(disk.otherPatients[2],initial.otherPatients[2]);assert.deepEqual(disk.customRoot,initial.customRoot);
  await page.locator('#btn-connect').click();await page.waitForFunction(()=>!connectionChecking);
  assert.equal(await select().inputValue(),'Dr. Celine Laferriere');
  await page.locator('#other-search').fill('900002');assert.equal(await page.locator('#other-list tbody tr').count(),1);
  await page.locator('#other-search').fill('');
  await page.locator('#other-doctor-filter').selectOption('Dr. Adam Siemens');assert.equal(await page.locator('#other-list tbody tr').count(),1);
  await page.locator('#other-doctor-filter').selectOption('');
  await select().selectOption('');await page.evaluate(()=>saveQueue);assert.equal(disk.otherPatients[0].doctor,'');
  await page.locator('#other-doctor-filter').selectOption('__unassigned');assert.equal(await page.locator('#other-list tbody tr').count(),1);
  await page.locator('#other-doctor-filter').selectOption('');
  assert.equal(await page.evaluate(()=>state.patients.length),1);
  await page.evaluate(()=>{buildTrimList();buildTrimBilling();});assert.equal(await page.locator('#print-trim').textContent().then(x=>x.includes('Synthetic Alpha')),false);
  fs.mkdirSync(path.join(root,'work'),{recursive:true});await page.screenshot({path:path.join(root,'work','other-patients-synthetic.png'),fullPage:true});
  rejectSave=true;await select().selectOption('Dr. Tarun Soni');await page.evaluate(()=>saveQueue);
  assert.equal(disk.otherPatients[0].doctor,'');assert.equal(await page.evaluate(()=>writeBlocked),true);assert.equal(await select().isDisabled(),true);
  assert.ok((await page.locator('#ss').textContent()).includes('NOT SAVED'));
  rejectSave=false;await page.locator('#btn-connect').click();await page.waitForFunction(()=>!connectionChecking);assert.equal(await select().inputValue(),'');
  // Legacy rosters have an empty directory and can still be loaded.
  delete disk.otherPatients;revision++;await page.locator('#btn-connect').click();await page.waitForFunction(()=>!connectionChecking);
  assert.ok((await page.locator('#other-list').textContent()).includes('No other patients'));
  assert.deepEqual(errors,[]);console.log('Other patients browser checks passed: chart links, PHN controls, doctor save/clear/reload, filters, unknown saved doctor, separate panel/prints, 412 protection and legacy roster.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
