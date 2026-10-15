const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0]==='/roster-core.js'?'roster-core.js':'index.html';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(root,name)));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const patient=(id,name,phn,ava)=>({id,name,phn,ava,unit:'cedar',room:'1401',codes:'401',custom:{keep:true}});
  let disk={patients:[patient('own','Synthetic Own','9000000001','900001')],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[],removedPatients:[],otherPatients:[patient('other','Synthetic Other','9000000002','900002')],customRoot:{keep:true}},revision=1,writes=0,rejectSave=false;
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
  const connect=async()=>{await page.locator('#btn-connect').click();await page.waitForFunction(()=>!connectionChecking&&state.googleConnected);};
  const own=()=>page.locator('[data-notes-upload="own"]'),other=()=>page.locator('[data-notes-upload="other"]');
  await connect();assert.equal(writes,0);assert.equal(await own().isChecked(),false);
  const box=await own().boundingBox(),link=await page.getByRole('link',{name:'Synthetic Own',exact:true}).boundingBox();assert.ok(box.x+box.width<link.x,'checkbox must be immediately left of name');
  await own().check();await page.evaluate(()=>saveQueue);
  assert.equal(disk.patients[0].notesDataUploaded,true);assert.ok(Number.isFinite(Date.parse(disk.patients[0].notesDataUploadedAt)));assert.equal(writes,1);
  assert.ok((await page.locator('#notes-upload-count').textContent()).includes('1 of 1 uploaded'));
  assert.deepEqual(disk.otherPatients,initial.otherPatients);assert.deepEqual(disk.customRoot,initial.customRoot);assert.deepEqual(disk.patients[0].custom,initial.patients[0].custom);
  await connect();assert.equal(await own().isChecked(),true);assert.equal(await own().locator('..').textContent(),'Uploaded');
  fs.mkdirSync(path.join(root,'work'),{recursive:true});await page.screenshot({path:path.join(root,'work','notes-upload-synthetic.png'),fullPage:true});
  await own().uncheck();await page.evaluate(()=>saveQueue);assert.equal(disk.patients[0].notesDataUploaded,false);assert.equal(disk.patients[0].notesDataUploadedAt,null);
  await page.getByRole('button',{name:'Other patients',exact:true}).click();await other().check();await page.evaluate(()=>saveQueue);assert.equal(disk.otherPatients[0].notesDataUploaded,true);assert.equal(disk.patients[0].notesDataUploaded,false);
  await connect();assert.equal(await other().isChecked(),true);
  await page.getByRole('button',{name:'Patients',exact:true}).click();
  await page.evaluate(()=>{inHistoryView=true;render();});assert.equal(await own().isDisabled(),true);await page.evaluate(()=>{inHistoryView=false;render();});
  await page.context().setOffline(true);await page.waitForFunction(()=>!state.googleConnected);assert.equal(await own().isDisabled(),true);await page.context().setOffline(false);await page.waitForFunction(()=>!connectionChecking);await connect();
  rejectSave=true;await own().check();await page.evaluate(()=>saveQueue);
  assert.equal(disk.patients[0].notesDataUploaded,false);assert.equal(await own().locator('..').textContent(),'Not saved');assert.equal(await own().isDisabled(),true);assert.ok((await page.locator('#ss').textContent()).includes('NOT SAVED'));
  rejectSave=false;await connect();assert.equal(await own().isChecked(),false);assert.equal(await own().isDisabled(),false);
  const R=require('../roster-core.js');const marked={...disk,patients:[{...disk.patients[0],notesDataUploaded:true,notesDataUploadedAt:'2026-10-15T12:00:00Z'}]};const removed=R.remove(marked,'own','2026-10-15');assert.equal(removed.removedPatients[0].notesDataUploaded,true);assert.equal(R.add(removed,initial.patients[0],'2026-10-16').patients[0].notesDataUploaded,true);
  assert.deepEqual(disk.billingDates,initial.billingDates);assert.deepEqual(errors,[]);
  console.log('Upload tracking passed: left-of-name placement, legacy unchecked, save/reload/clear, separate lists, history/offline protection, failed-save status and recovery, retention preservation.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
