import {escapeHTML as esc,rosterView} from './core.mjs?v=20261006-session1';
const REPORT_CSS=`@page{size:letter portrait;margin:.35in}*{box-sizing:border-box}body{margin:0;background:#dfe2d9;color:#111;font-family:Arial,sans-serif}.page{width:7.8in;height:10.3in;margin:16px auto;background:white;padding:0;position:relative;overflow:hidden;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.page-header{height:.53in;border-bottom:1.4px solid #222;padding:5px 2px;display:flex;justify-content:space-between;align-items:start}.page-header h1{font-size:15px;margin:0 0 3px}.page-header p{font-size:9px;margin:0}.page-header .right{text-align:right;font-size:9px}.body{height:9.46in;overflow:hidden;padding-top:6px}.page-footer{height:.26in;border-top:1px solid #bbb;font-size:8px;display:flex;justify-content:space-between;align-items:center}.unit-heading{background:#e8ece5;border-top:1px solid #777;border-bottom:1px solid #bbb;font-size:9px;font-weight:bold;padding:3px 5px}.row{display:grid;grid-template-columns:2.25in 1fr .58in;border-bottom:.5px solid #ccc;min-height:14px;align-items:start;font-size:8px;line-height:1.3;break-inside:avoid}.row>div{padding:3px 4px;overflow-wrap:anywhere}.row .name{font-weight:bold}.row .ident{font-size:7px;font-weight:normal;color:#333}.row.billed{background:#f1f5ef}.code{font-weight:bold}.details{font-size:7.5px}.comment{font-size:7.5px;margin-top:2px}.columns{display:grid;grid-template-columns:2.25in 1fr .58in;background:#f5f5f2;font-size:8px;font-weight:bold;padding:4px}.patient-banner{padding:8px 4px;font-size:10px;border-bottom:1px solid #444}.patient-row{display:grid;grid-template-columns:.85in 1fr;border-bottom:1px solid #ccc;font-size:10px;padding:8px 4px;gap:10px}.patient-row .details,.patient-row .comment{font-size:9px}.blank{display:grid;place-items:center;color:#888;font-size:10px}.warning{color:#7b2821;font-weight:bold} @media print{body{background:white}.page{margin:0;width:100%;height:10.3in;box-shadow:none}.page-header,.page-footer,.row,.unit-heading{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
export function diagnosisForItem(i,e,usual=''){return i.diagnosis?.trim()||(i.code==='13334'?e.items.find(x=>['00114','00127','13115'].includes(x.code))?.diagnosis?.trim():'')||usual;}
export function reportLines(e,usual=''){return e.items.map(i=>`<div><span class="code">${esc(i.code)}${Number(i.units)>1?` × ${esc(i.units)}`:''}${i.customLabel?` · ${esc(i.customLabel)}`:''}</span>${i.start||i.end?` <span>${esc(i.start||'?')}${i.end?`–${esc(i.end)}`:''}</span>`:''}${i.requestAt?`<div class="details">Request: ${esc(i.requestAt.replace('T',' '))} · ${esc(i.requester)}</div>`:''}${i.participants?`<div class="details">Participants: ${esc(i.participants)}</div>`:''}${i.reason?`<div class="details">R: ${esc(i.reason)}</div>`:''}${diagnosisForItem(i,e,usual)?`<span class="details"> ICD-9: ${esc(diagnosisForItem(i,e,usual))}</span>`:''}</div>`).join('')+(e.comment?`<div class="comment">${esc(e.comment)}</div>`:'');}
export function reportGroups(ledger,roster,entries,layout){
  const people=rosterView(roster,ledger);const find=k=>people.find(p=>p.key===k)||ledger.patients[k];const units=[...roster.units];
  for(const p of people)if(!units.some(u=>u.id===p.unit))units.push({id:p.unit,name:p.unit||'LOCATION NOT RECORDED',floor:''});
  const sortedPeople=list=>list.sort((a,b)=>units.findIndex(u=>u.id===a.unit)-units.findIndex(u=>u.id===b.unit)||String(a.room).localeCompare(String(b.room),undefined,{numeric:true})||a.name.localeCompare(b.name));
  if(layout==='patient')return [...new Set(entries.map(e=>e.patientKey))].map(find).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>({title:p.name,subtitle:`PHN ${p.phn||'not recorded'} · ${(units.find(u=>u.id===p.unit)?.name)||p.unit} · Room ${p.room||'—'}`,rows:entries.filter(e=>e.patientKey===p.key).sort((a,b)=>a.date.localeCompare(b.date)).map(e=>({html:`<div class="patient-row"><strong>${esc(e.date)}</strong><div>${reportLines(e,p.codes)}</div></div>`}))}));
  return [...new Set(entries.map(e=>e.date))].sort().map(date=>{
    const day=entries.filter(e=>e.date===date);const included=sortedPeople(people.filter(p=>p.panel||day.some(e=>e.patientKey===p.key)));let previous=null;const rows=[];
    for(const p of included){const unit=units.find(u=>u.id===p.unit);if(previous!==p.unit){rows.push({unit:true,html:`<div class="unit-heading">${esc(unit?.name||p.unit)}${unit?.floor?` · FLOOR ${esc(unit.floor)}`:''}</div>`});previous=p.unit;}
      const e=day.find(e=>e.patientKey===p.key);rows.push({html:`<div class="row ${e?'billed':''}"><div class="name">${esc(p.name)}<div class="ident">${esc(p.phn)} · Rm ${esc(p.room||'—')}${!p.panel?' · COVERAGE':''}</div></div><div>${e?reportLines(e,p.codes):''}</div><div>${esc(e?[...new Set(e.items.map(i=>diagnosisForItem(i,e,p.codes)).filter(Boolean))].join(', '):p.codes)}</div></div>`});}
    return {title:`TRIM List · ${date}`,subtitle:`${day.length} patients selected · ${day.reduce((n,e)=>n+e.items.length,0)} charges`,rows};
  });
}
export async function renderReport(frame,ledger,roster,entries,layout){
  const groups=reportGroups(ledger,roster,entries,layout);
  const from=entries.map(e=>e.date).sort()[0],to=entries.map(e=>e.date).sort().at(-1);
  const title=`TRIM_Billing_${from}_to_${to}_${layout==='date'?'By-Date':'By-Patient'}${ledger.settings.parallel?'_COMPARISON':''}`;
  const compactCSS='.row,.columns{grid-template-columns:3.15in 1fr .55in}.row>div{padding:1px 4px}.row .ident{display:inline;font-size:8.5px;margin-left:5px}.row{font-size:9px;line-height:1.25}';
  frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${REPORT_CSS}${compactCSS}</style></head><body></body></html>`;
  await new Promise(resolve=>{frame.onload=resolve;});
  const doc=frame.contentDocument;let pages=[];
  const page=(group,continuation=false)=>{
    const el=doc.createElement('section');el.className='page';
    el.innerHTML=`<div class="page-header"><div><h1>${esc(group.title)}${continuation?' · continued':''}</h1><p>${esc(group.subtitle)}</p></div><div class="right">${ledger.settings.parallel?'<span class="warning">COMPARISON ONLY · DO NOT SUBMIT</span>':'PHYSICIAN-REVIEWED BILLING'}<br>${esc(from)} to ${esc(to)}</div></div><div class="body">${layout==='date'?'<div class="columns"><span>Patient / PHN / room</span><span>Selected billing · times · comments</span><span>ICD</span></div>':''}</div><div class="page-footer"><span>TRIM · ${esc(group.title)}</span><span class="page-number"></span></div>`;
    doc.body.append(el);pages.push(el);return el.querySelector('.body');
  };
  for(const [groupIndex,g] of groups.entries()){
    let body=page(g),lastHeader=null,count=0;
    for(const row of g.rows){
      const node=doc.createElement('div');node.innerHTML=row.html;
      body.append(node);
      if(body.scrollHeight>body.clientHeight+1){
        node.remove();
        // Never leave a unit heading stranded at the foot of a page.
        if(body.lastElementChild?.dataset.unit==='true')body.lastElementChild.remove();
        body=page(g,true);count=0;
        if(lastHeader&&!row.unit){const h=doc.createElement('div');h.innerHTML=lastHeader;body.append(h);}
        body.append(node);
        if(body.scrollHeight>body.clientHeight+1)throw new Error('A billing row is too long to fit a page. Shorten its billing comment or split the detail before printing. Nothing was finalized.');
      }
      if(row.unit){node.dataset.unit='true';lastHeader=row.html;}count++;
    }
    if(groupIndex<groups.length-1&&pages.length%2===1){const blank=doc.createElement('section');blank.className='page blank';blank.textContent='Intentionally blank · next section starts on a new sheet';doc.body.append(blank);pages.push(blank);}
  }
  pages.forEach((p,i)=>{const n=p.querySelector('.page-number');if(n)n.textContent=`Page ${i+1} of ${pages.length}`;});
  return {title,pages:pages.length};
}
