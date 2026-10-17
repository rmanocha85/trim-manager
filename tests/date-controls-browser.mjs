// Synthetic date controls only. No account, live browser or patient data.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from './server-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({locale:'en-GB',timezoneId:'Asia/Tokyo',viewport:{width:390,height:844}});
  await page.goto(`http://127.0.0.1:${server.address().port}/?connection=manual`);
  await page.evaluate(async()=>{
    const host=document.createElement('section');host.id='synthetic-date-test';host.style='padding:20px';
    host.innerHTML='<label>Test date<input id="test-date" type="date" value="2026-10-06" max="2026-10-07"></label><label>Request date<input id="test-request" type="datetime-local" value="2026-10-06T18:30"></label>';
    document.body.prepend(host);document.querySelector('#gate').hidden=true;
    const {enhanceDateInputs}=await import('/dates.mjs');enhanceDateInputs(host);
  });
  const group=page.getByRole('group',{name:'Test date',exact:true});
  assert.equal(await group.locator('.named-date-summary').textContent(),'Tue, Oct 6, 2026');
  assert.equal(await group.getByRole('combobox',{name:'Test date month',exact:true}).locator('option:checked').textContent(),'Oct');
  await group.getByRole('combobox',{name:'Test date day',exact:true}).selectOption('07');assert.equal(await page.locator('#test-date').inputValue(),'2026-10-07');
  assert.equal(await group.locator('.named-date-summary').textContent(),'Wed, Oct 7, 2026');
  await group.getByRole('combobox',{name:'Test date day',exact:true}).selectOption('08');assert.equal(await page.locator('#test-date').inputValue(),'');
  await group.getByRole('combobox',{name:'Test date month',exact:true}).selectOption('02');await group.getByRole('combobox',{name:'Test date day',exact:true}).selectOption('30');assert.equal(await page.locator('#test-date').inputValue(),'');
  await group.getByRole('combobox',{name:'Test date day',exact:true}).selectOption('28');assert.equal(await page.locator('#test-date').inputValue(),'2026-02-28');
  const request=page.getByRole('group',{name:'Request date',exact:true});await request.getByRole('textbox',{name:'Request date time',exact:true}).fill('1837');await request.getByRole('textbox',{name:'Request date time',exact:true}).press('Tab');assert.equal(await page.locator('#test-request').inputValue(),'2026-10-06T18:37');assert.equal(await request.locator('.named-date-summary').textContent(),'Tue, Oct 6, 2026 · 18:37');
  await page.locator('#test-request').evaluate(el=>el.disabled=true);await request.locator('select:disabled').first().waitFor();assert.equal(await request.getByRole('textbox').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'work/named-date-controls.png'});
  console.log('PASS named-month date controls: day/month/year, weekday, invalid/future dates, datetime wall time, lock propagation, alternate timezone/locale and narrow screen.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
