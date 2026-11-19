import {formatDate,formatRequestTime} from './dates.mjs?v=20261007-dates1';
import {escapeHTML as esc,rosterView} from './core.mjs?v=20261031-compact1';
const REPORT_CSS=`@page{size:letter portrait;margin:.35in}*{box-sizing:border-box}body{margin:0;background:#dfe2d9;color:#111;font-family:Arial,sans-serif}.page{width:7.8in;height:10.3in;margin:16px auto;background:white;padding:0;position:relative;overflow:hidden;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.page-header{height:.53in;border-bottom:1.4px solid #222;padding:5px 2px;display:flex;justify-content:space-between;align-items:start}.page-header h1{font-size:15px;margin:0 0 3px}.page-header p{font-size:9px;margin:0}.page-header .right{text-align:right;font-size:9px}.body{height:9.46in;overflow:hidden;padding-top:6px}.page-footer{height:.26in;border-top:1px solid #bbb;font-size:8px;display:flex;justify-content:space-between;align-items:center}.unit-heading{background:#e8ece5;border-top:1px solid #777;border-bottom:1px solid #bbb;font-size:9px;font-weight:bold;padding:3px 5px}.row{display:grid;grid-template-columns:2.25in 1fr .58in;border-bottom:.5px solid #ccc;min-height:14px;align-items:start;font-size:8px;line-height:1.3;break-inside:avoid}.row>div{padding:3px 4px;overflow-wrap:anywhere}.row .name{font-weight:bold}.row .ident{font-size:7px;font-weight:normal;color:#333}.row.billed{background:#f1f5ef}.code{font-weight:bold}.details{font-size:7.5px}.billing-note{white-space:pre-wrap}.comment{font-size:7.5px;margin-top:2px}.columns{display:grid;grid-template-columns:2.25in 1fr .58in;background:#f5f5f2;font-size:8px;font-weight:bold;padding:4px}.patient-banner{padding:8px 4px;font-size:10px;border-bottom:1px solid #444}.patient-row{display:grid;grid-template-columns:1.25in 1fr;border-bottom:1px solid #ccc;font-size:10px;padding:8px 4px;gap:10px}.patient-row .details,.patient-row .comment{font-size:9px}.blank{display:grid;place-items:center;color:#888;font-size:10px}.warning{color:#7b2821;font-weight:bold} @media print{body{background:white}.page{margin:0;width:100%;height:10.3in;box-shadow:none}.page-header,.page-footer,.row,.unit-heading{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
export function diagnosisForItem(i,e,usual=''){return i.diagnosis?.trim()||(i.code==='13334'?e.items.find(x=>['00114','00127','13115'].includes(x.code))?.diagnosis?.trim():'')||usual;}
export function reportLines(e,usual=''){return e.items.map(i=>`<div><span class="code">${esc(i.code)}${Number(i.units)>1?` × ${esc(i.units)}`:''}${i.customLabel?` · ${esc(i.customLabel)}`:''}</span>${i.start||i.end?` <span>${esc(i.start||'?')}${i.end?`–${esc(i.end)}`:''}</span>`:''}${i.requestAt?`<div class="details">Request: ${esc(formatRequestTime(i.requestAt))} · ${esc(i.requester)}</div>`:''}${i.participants?`<div class="details">Participants: ${esc(i.participants)}</div>`:''}${i.reason?`<div class="details billing-note">${i.code==='14077'?'Note':'R'}: ${esc(i.reason)}</div>`:''}${diagnosisForItem(i,e,usual)?`<span class="details"> ICD-9: ${esc(diagnosisForItem(i,e,usual))}</span>`:''}</div>`).join('')+(e.comment?`<div class="comment">${esc(e.comment)}</div>`:'');}
function patientItemDetails(i){
  return [i.customLabel?`<div>${esc(i.customLabel)}</div>`:'',
    i.start||i.end?`<div>${esc(i.start||'?')}${i.end?`–${esc(i.end)}`:''}</div>`:'',
    i.requestAt?`<div>Request: ${esc(formatRequestTime(i.requestAt))} · ${esc(i.requester)}</div>`:'',
    i.participants?`<div>Participants: ${esc(i.participants)}</div>`:'',
    i.reason?`<div class="billing-note">${esc(i.reason)}</div>`:''].join('');
}
const PATIENT_CSS=`.patient-banner{background:#e7ece9;border:0;padding:4px 8px;margin-top:7px;font-size:14px;line-height:1.25;font-weight:bold}.patient-banner small{display:block;font-size:11px;font-weight:normal;margin-top:2px}.patient-columns,.patient-row{display:grid;grid-template-columns:82px 65px 40px 70px minmax(0,1fr);gap:8px;padding:4px 8px;font-size:12px;line-height:1.3;overflow-wrap:anywhere}.patient-columns{font-size:10px;font-weight:bold;color:#444;padding-top:7px}.patient-row{border-bottom:1px solid #d8ddda}.patient-banner{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
export function reportGroups(ledger,roster,entries,layout){
  const people=rosterView(roster,ledger);const find=k=>people.find(p=>p.key===k)||ledger.patients[k];const units=[...roster.units];
  for(const p of people)if(!units.some(u=>u.id===p.unit))units.push({id:p.unit,name:p.unit||'LOCATION NOT RECORDED',floor:''});
  const sortedPeople=list=>list.sort((a,b)=>units.findIndex(u=>u.id===a.unit)-units.findIndex(u=>u.id===b.unit)||String(a.room).localeCompare(String(b.room),undefined,{numeric:true})||a.name.localeCompare(b.name));
  if(layout==='patient')return [...new Set(entries.map(e=>e.patientKey))].map(find).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>({
    title:p.name,subtitle:`PHN ${p.phn||'not recorded'}`,
    rows:entries.filter(e=>e.patientKey===p.key).sort((a,b)=>a.date.localeCompare(b.date)).flatMap(e=>e.items.map((i,index)=>({html:`<div class="patient-row"><span>${esc(e.date)}</span><strong>${esc(i.code)}</strong><span>${esc(i.units??1)}</span><span>${esc(diagnosisForItem(i,e,p.codes))}</span><div>${patientItemDetails(i)}${index===e.items.length-1&&e.comment?`<div class="billing-note">${esc(e.comment)}</div>`:''}</div></div>`})))
  }));
  return [...new Set(entries.map(e=>e.date))].sort().map(date=>{
    const day=entries.filter(e=>e.date===date);const included=sortedPeople(people.filter(p=>p.panel||day.some(e=>e.patientKey===p.key)));let previous=null;const rows=[];
    for(const p of included){const unit=units.find(u=>u.id===p.unit);if(previous!==p.unit){rows.push({unit:true,html:`<div class="unit-heading">${esc(unit?.name||p.unit)}${unit?.floor?` · FLOOR ${esc(unit.floor)}`:''}</div>`});previous=p.unit;}
      const e=day.find(e=>e.patientKey===p.key);rows.push({html:`<div class="row ${e?'billed':''}"><div class="name">${esc(p.name)}<div class="ident">${esc(p.phn)} · Rm ${esc(p.room||'—')}${!p.panel?' · COVERAGE':''}</div></div><div>${e?reportLines(e,p.codes):''}</div><div>${esc(e?[...new Set(e.items.map(i=>diagnosisForItem(i,e,p.codes)).filter(Boolean))].join(', '):p.codes)}</div></div>`});}
    return {title:`TRIM List · ${formatDate(date)}`,subtitle:`${day.length} patients selected · ${day.reduce((n,e)=>n+e.items.length,0)} charges`,rows};
  });
}
export async function renderReport(frame,ledger,roster,entries,layout){
  const groups=reportGroups(ledger,roster,entries,layout);
  const from=entries.map(e=>e.date).sort()[0],to=entries.map(e=>e.date).sort().at(-1);
  const title=`TRIM_Billing_${from}_to_${to}_${layout==='date'?'By-Date':'By-Patient'}${ledger.settings.parallel?'_COMPARISON':''}`;
  const compactCSS='.row,.columns{grid-template-columns:3.15in 1fr .55in}.row>div{padding:1px 4px}.row .ident{display:inline;font-size:8.5px;margin-left:5px}.row{font-size:9px;line-height:1.25}';
  frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${REPORT_CSS}${compactCSS}${layout==='patient'?PATIENT_CSS:''}</style></head><body></body></html>`;
  await new Promise(resolve=>{frame.onload=resolve;});
  const doc=frame.contentDocument;let pages=[];
  const page=(group,continuation=false)=>{
    const el=doc.createElement('section');el.className='page';
    el.innerHTML=`<div class="page-header"><div><h1>${esc(group.title)}${continuation?' · continued':''}</h1><p>${esc(group.subtitle)}</p></div><div class="right">${ledger.settings.parallel?'<span class="warning">COMPARISON ONLY · DO NOT SUBMIT</span>':'PHYSICIAN-REVIEWED BILLING'}<br>${esc(formatDate(from))} to ${esc(formatDate(to))}</div></div><div class="body">${layout==='date'?'<div class="columns"><span>Patient / PHN / room</span><span>Selected billing · times · comments</span><span>ICD</span></div>':''}</div><div class="page-footer"><span>TRIM · ${esc(group.title)}</span><span class="page-number"></span></div>`;
    doc.body.append(el);pages.push(el);return el.querySelector('.body');
  };
  if(layout==='patient'){
    const report={title:'TRIM Billing',subtitle:'By patient'};
    let body=null;
    const header=(g,continued)=>{
      const el=doc.createElement('div');el.className='patient-heading';
      el.innerHTML=`<div class="patient-banner">${esc(g.title)}${continued?' · continued':''}<small>${esc(g.subtitle)}</small></div><div class="patient-columns"><span>DATE</span><span>FEE CODE</span><span>UNITS</span><span>ICD-9</span><span>TIMES / BILLING NOTES</span></div>`;
      return el;
    };
    const overflows=()=>body.scrollHeight>body.clientHeight+1;
    for(const g of groups){
      if(!body)body=page(report);
      let heading=header(g,false);body.append(heading);
      for(const [index,row] of g.rows.entries()){
        const node=doc.createElement('div');node.innerHTML=row.html;body.append(node);
        if(overflows()){
          node.remove();
          // Move a new patient's heading with their first charge; never orphan it.
          if(index===0)heading.remove();
          if(!body.querySelector('.patient-row'))throw new Error('A billing row is too long to fit a page. Shorten its billing comment or split the detail before printing. Nothing was finalized.');
          body=page(report);heading=header(g,index>0);body.append(heading,node);
          if(overflows())throw new Error('A billing row is too long to fit a page. Shorten its billing comment or split the detail before printing. Nothing was finalized.');
        }
      }
    }
  }else{
    for(const g of groups){
      let body=page(g),lastHeader=null;
      for(const row of g.rows){
        const node=doc.createElement('div');node.innerHTML=row.html;
        body.append(node);
        if(body.scrollHeight>body.clientHeight+1){
          node.remove();
          if(body.lastElementChild?.dataset.unit==='true')body.lastElementChild.remove();
          body=page(g,true);
          if(lastHeader&&!row.unit){const h=doc.createElement('div');h.innerHTML=lastHeader;body.append(h);}
          body.append(node);
          if(body.scrollHeight>body.clientHeight+1)throw new Error('A billing row is too long to fit a page. Shorten its billing comment or split the detail before printing. Nothing was finalized.');
        }
        if(row.unit){node.dataset.unit='true';lastHeader=row.html;}
      }
    }
  }
  pages.forEach((p,i)=>{const n=p.querySelector('.page-number');if(n)n.textContent=`Page ${i+1} of ${pages.length}`;});
  return {title,pages:pages.length};
}
