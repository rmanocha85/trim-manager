const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const R=require('../roster-core.js');
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;
    const target=file==='/'?'index.html':file.slice(1);
    if(!['index.html','roster-core.js','favicon.svg'].includes(target)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(path.join(root,target)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{browser=await chromium.launch({headless:true,channel:process.env.TRIM_BROWSER_CHANNEL||'chrome'});}
  catch(e){server.close();throw e;}
  try{
    const page=await browser.newPage({viewport:{width:1400,height:950}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.accept());
    let disk={patients:[{id:'synthetic-1',name:'Synthetic Patient',phn:'9000000001',ava:'900001',unit:'cedar',room:'1',codes:'TEST',extra:{keep:true}}],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[],other:'preserved'},rev=1;
    await page.route('https://www.googleapis.com/**',async route=>{
      const req=route.request();
      assert.ok(req.url().includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'));
      if(req.method()==='PUT'){
        if(req.headers()['if-match']!=='r'+rev){await route.fulfill({status:412,body:'{}'});return;}
        disk=JSON.parse(req.postData());rev++;await route.fulfill({json:{id:'synthetic'}});return;
      }
      await route.fulfill({json:req.url().includes('alt=media')?disk:{etag:'r'+rev}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('drive-connected')),false);
    await page.evaluate(async()=>{state.googleConnected=true;state.googleToken='synthetic';maybeSaveDailySnapshot=async()=>{};await loadDrive();});
    await page.evaluate(()=>promptDel('synthetic-1'));
    await page.locator('#delmv button.btn-danger').click();
    await page.evaluate(()=>saveQueue);
    assert.equal(disk.patients.length,0);assert.equal(disk.removedPatients[0].removedDate,R.today());assert.equal(disk.other,'preserved');
    await page.getByRole('button',{name:'Removed Patients',exact:true}).click();
    await page.getByRole('cell',{name:'Synthetic Patient',exact:true}).waitFor();
    await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished)));
    fs.mkdirSync(path.join(root,'work'),{recursive:true});
    await page.screenshot({path:path.join(root,'work','removed-patients-synthetic.png'),fullPage:true});
    await page.getByRole('button',{name:'Patients',exact:true}).click();
    for(const [id,value] of Object.entries({'in-name':'Synthetic Patient','in-phn':'9000000001','in-room':'2','in-codes':'TEST','in-ava':'900001'}))await page.locator('#'+id).fill(value);
    await page.locator('#in-unit').selectOption('cedar');
    await page.evaluate(()=>addPatient());await page.evaluate(()=>saveQueue);
    assert.equal(disk.patients[0].id,'synthetic-1');assert.equal(disk.patients[0].room,'2');assert.deepEqual(disk.patients[0].extra,{keep:true});assert.equal(disk.removedPatients.length,0);
    const before=structuredClone(disk);rev++;
    await page.evaluate(()=>{promptDel('synthetic-1');confirmDel();});await page.evaluate(()=>saveQueue);
    assert.deepEqual(disk,before);assert.equal(await page.evaluate(()=>writeBlocked),true);
    await page.evaluate(()=>forceSyncFromDrive());assert.equal(await page.evaluate(()=>state.patients.length),1);
    assert.deepEqual(errors,[]);console.log('Browser smoke passed: old-schema load, removal, removed view, reactivation, stale-save refusal and sync recovery.');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
