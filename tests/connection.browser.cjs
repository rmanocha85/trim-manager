const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=req.url.split('?')[0]==='/roster-core.js'?'roster-core.js':'index.html';
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(root,file)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,channel:process.env.TRIM_BROWSER_CHANNEL||'chrome'});
    const context=await browser.newContext({viewport:{width:1500,height:950}}),page=await context.newPage();
    const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const disk={patients:[{id:'synthetic',name:'Synthetic Patient',phn:'9000000001',ava:'900001',unit:'cedar',room:'1',codes:'TEST'}],units:[{id:'cedar',name:'CEDAR',floor:1}],billingDates:[]};
    let responseStatus=200,gate=null;
    await page.route('https://www.googleapis.com/**',async route=>{
      const req=route.request();requests.push(req.method());assert.ok(req.url().includes('1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3'));
      if(gate)await gate;
      await route.fulfill({status:responseStatus,json:responseStatus===200?(req.url().includes('alt=media')?disk:{etag:'original'}):{error:'synthetic unauthorized'}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const control=page.locator('#btn-connect');
    assert.equal(await control.textContent(),'● Reconnect Drive');
    await page.evaluate(()=>{window.google={accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'synthetic',expires_in:3600})})}}};});
    await control.click();await page.waitForFunction(()=>document.getElementById('btn-connect').dataset.state==='ok');
    assert.equal(await control.textContent(),'● Drive connected');assert.equal(await page.evaluate(()=>state.patients.length),1);
    await page.evaluate(()=>{state.patients[0].room='UNSAVED';writeBlocked=true;setSS('NOT SAVED — pending roster edit',false);});
    let release;gate=new Promise(resolve=>release=resolve);
    await control.click();await page.waitForFunction(()=>document.getElementById('btn-connect').dataset.state==='busy');
    assert.equal(await control.textContent(),'◌ Checking Drive…');
    fs.mkdirSync(path.join(root,'work'),{recursive:true});
    await page.locator('header').screenshot({path:path.join(root,'work','drive-status-checking-synthetic.png')});
    release();gate=null;await page.waitForFunction(()=>document.getElementById('btn-connect').dataset.state==='ok');
    assert.equal(await page.locator('#ss').textContent(),'NOT SAVED — pending roster edit');
    assert.equal(await page.evaluate(()=>state.patients[0].room),'UNSAVED');
    assert.equal(await page.evaluate(()=>writeBlocked),true);
    await page.locator('header').screenshot({path:path.join(root,'work','drive-status-connected-synthetic.png')});
    await context.setOffline(true);await page.waitForFunction(()=>document.getElementById('btn-connect').dataset.state==='error');
    assert.equal(await control.textContent(),'● Reconnect Drive');
    await page.locator('header').screenshot({path:path.join(root,'work','drive-status-offline-synthetic.png')});
    await context.setOffline(false);await page.waitForFunction(()=>document.getElementById('btn-connect').dataset.state==='ok');
    responseStatus=401;await control.click();await page.waitForFunction(()=>!connectionChecking);
    assert.equal(await control.textContent(),'● Reconnect Drive');assert.equal(await page.evaluate(()=>state.googleToken),null);
    responseStatus=200;await control.click();await page.waitForFunction(()=>document.getElementById('btn-connect').dataset.state==='ok');
    await page.evaluate(()=>acceptDriveToken({access_token:'short-synthetic',expires_in:.01}));
    await page.waitForFunction(()=>document.getElementById('btn-connect').dataset.state==='error');
    assert.equal(await page.evaluate(()=>state.googleToken),null);
    assert.equal(await page.locator('#ss').textContent(),'NOT SAVED — pending roster edit');
    assert.ok(requests.length>0&&requests.every(method=>method==='GET'));
    assert.deepEqual(errors,[]);console.log('Connection browser checks passed: all three states, read-only first login/check/reconnect, unsaved edits preserved, offline/online, 401 and token expiry.');
  }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
