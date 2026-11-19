import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Render synthetic data only, with no connection to the clinical application.
const root=path.resolve('public');
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<iframe id="report"></iframe>');}
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:1200}});
await mkdir('work/compact-billing',{recursive:true});
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(async()=>{
    const {renderReport}=await import('/reports.mjs');
    const people=Array.from({length:5},(_,n)=>({id:String(n),key:'phn:000000000'+n,phn:'000000000'+n,name:['Anderson, Alex','Bennett, Morgan','Carter, Jamie','Davis, Taylor','Ellis, Jordan'][n],panel:true,unit:'hidden-unit',room:'hidden-room',codes:'401'}));
    const roster={patients:people,units:[{id:'hidden-unit',name:'HIDDEN LOCATION',floor:'HIDDEN FLOOR'}]};
    const entries=people.flatMap((p,n)=>Array.from({length:4},(_,d)=>({id:`${n}-${d}`,patientKey:p.key,date:`2026-11-${String(d+1).padStart(2,'0')}`,comment:d===3&&n===1?'Example entry comment':'',items:[{code:d===3&&n===1?'14077':'00114',units:1,diagnosis:'401',...(d===3&&n===1?{start:'10:00',end:'10:10',participants:'Example nurse',reason:'Review monitoring and care plan.'}:{})}]})));
    const ledger={patients:Object.fromEntries(people.map(p=>[p.key,p])),nonPanel:[],baselines:{},entries,settings:{parallel:true}};
    const frame=document.querySelector('#report');
    const render=async(es,layout='patient')=>{
      const before=JSON.stringify(ledger);
      const result=await renderReport(frame,ledger,roster,es,layout);
      if(before!==JSON.stringify(ledger))throw Error('Report mutated ledger');
      const doc=frame.contentDocument;
      return {...result,html:doc.documentElement.outerHTML,text:doc.body.innerText,pages:[...doc.querySelectorAll('.page')].map(p=>({rows:p.querySelectorAll('.patient-row').length,headers:p.querySelectorAll('.patient-banner').length,overflow:p.querySelector('.body').scrollHeight>p.querySelector('.body').clientHeight+1})),rows:doc.querySelectorAll('.patient-row').length,blank:doc.querySelectorAll('.blank').length};
    };
    const compact=await render(entries);
    const long=await render(Array.from({length:90},(_,n)=>({...entries[0],id:'long-'+n,date:'2026-11-01',items:[{code:'14077',units:2,diagnosis:'401',start:'09:00',end:'09:25',requestAt:'2026-11-01T08:00:00Z',requester:'Synthetic requester',participants:'Synthetic RN',reason:'Unique detail '+n+' - '+('Wrapped billing explanation. '.repeat(8))}]})));
    let oversized='';try{await render([{...entries[0],items:[{code:'00114',units:1,reason:'Too long '.repeat(3000)}]}]);}catch(e){oversized=e.message;}
    const dates=await render(entries,'date');
    await render(entries);
    return {compact,long,dates,oversized};
  });
  assert.equal(result.compact.pages.length,1);
  assert.equal(result.compact.pages[0].headers,5);
  assert.equal(result.compact.rows,20);
  assert.doesNotMatch(result.compact.text,/hidden-unit|hidden-room|HIDDEN LOCATION|HIDDEN FLOOR/);
  assert.match(result.compact.text,/Example entry comment/);
  assert.match(result.compact.text,/10:00–10:10/);
  assert.equal(result.long.rows,90);
  assert.ok(result.long.pages.length>1);
  assert.match(result.long.text,/continued/);
  assert.equal((result.long.text.match(/Unique detail /g)||[]).length,90);
  for(const r of [result.compact,result.long,result.dates]){assert.equal(r.blank,0);assert.ok(r.pages.every(p=>!p.overflow));}
  assert.ok(result.long.pages.every(p=>p.rows>0&&p.headers>0));
  assert.match(result.oversized,/too long to fit/);
  const preview=await browser.newPage({viewport:{width:850,height:1100}});
  await preview.setContent(result.compact.html);
  await preview.screenshot({path:'work/compact-billing/compact-preview.png',fullPage:true});
  await preview.pdf({path:'work/compact-billing/compact-preview.pdf',preferCSSPageSize:true,printBackground:true});
  await writeFile('work/compact-billing/result.json',JSON.stringify({samplePages:result.compact.pages.length,longPages:result.long.pages.length,longCharges:result.long.rows}));
  console.log(`PASS five patients / 20 charges on one page; 90 long charges over ${result.long.pages.length} pages with continued headers; no lost rows, locations, blank pages, clipping or ledger writes; oversized rows rejected.`);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
