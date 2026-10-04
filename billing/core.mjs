export const SCHEMA = 1;
export const APP = 'trim-billing';
export const RESET_CODES = ['00114','00115','00127','13115'];
export const CODES = [
  {code:'00114', label:'LTC in-person', note:'Routine interval check is a planning aid; early claims require a reason.'},
  {code:'00115', label:'Urgent assessment', reason:true, request:true, attendance:true, note:'08:00–23:00, within 24 hours of facility request; verify urgency criteria.'},
  {code:'00127', label:'Palliative facility visit', reason:true, note:'Verify palliative criteria and any additional same-day claim requirements.'},
  {code:'13115', label:'LTC admission', reason:true, admission:true, note:'Initial in-person admission, once per patient per physician. Confirm reconciliation, care plan and MOST; not a return from hospital or physician transfer.'},
  {code:'13334', label:'First visit bonus', note:'Once per physician/day; requires qualifying visit. Not with urgent assessment.'},
  {code:'14077', label:'Provider conference', timed:true, participants:true, reason:true, portal:true, annual:18, note:'Two-way clinical conference, not routine-round communication. Start/end in claim and chart. Annual units shown are recorded here only.'},
  {code:'13121', label:'Family conference', timed:true, participants:true, reason:true, annual:100, physicianLimit:true, note:'Care planning/consent criteria, not routine updates. Separate time from other services.'},
  {code:'14067', label:'Brief provider conference', participants:true, reason:true, portal:true, annual:150, physicianLimit:true, note:'Clinical conferencing criteria; not an administrative or family conversation.'},
  {code:'13005', label:'Allied-worker advice', request:true, reason:true, note:'Document caller, request time and advice; same-day service restrictions apply.'},
  {code:'01200', label:'Evening call-out', request:true, attendance:true, reason:true, callout:true, note:'Special call and travel; first patient only. Check time-window and same-day restrictions.'},
  {code:'01201', label:'Night call-out', request:true, attendance:true, reason:true, callout:true, note:'Special call and travel; first patient only. Check time-window and same-day restrictions.'},
  {code:'01202', label:'Weekend / holiday call-out', request:true, attendance:true, reason:true, callout:true, note:'Special call and travel; first patient only. Check time-window and same-day restrictions.'}
];
export const codeInfo = code => CODES.find(x => x.code === code);
export const today = () => {const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const clone = value => structuredClone(value);
export function validDate(s) { if(!/^\d{4}-\d{2}-\d{2}$/.test(s||'')) return false; const d=new Date(`${s}T12:00:00Z`); return !Number.isNaN(+d)&&d.toISOString().slice(0,10)===s; }
export function addDays(s,n) {if(!validDate(s)) return null; const d=new Date(`${s}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function daysBetween(a,b) {return (Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000;}
export function minutes(s) {return /^([01]\d|2[0-3]):[0-5]\d$/.test(s||'')?Number(s.slice(0,2))*60+Number(s.slice(3)):null;}
export const escapeHTML = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function blankLedger(id=crypto.randomUUID()) {return {app:APP,schema:SCHEMA,datasetId:id,revision:0,updatedAt:null,entries:[],baselines:{},nonPanel:[],patients:{},units:[],batches:[],settings:{parallel:true,portalYears:[]}};}
export function patientKey(p) {const phn=String(p.phn||'').replace(/\D/g,'');return phn?`phn:${phn}`:`roster:${String(p.id)}`;}
export function normalizeRoster(raw) {
  if(!Array.isArray(raw?.patients)||!Array.isArray(raw?.units)) throw new Error('Not a TRIM roster file.');
  const seen=new Set();
  const patients=raw.patients.map(p=>{
    if(!p.id||!p.name) throw new Error('Roster contains an incomplete identity.');
    const key=patientKey(p); if(seen.has(key)) throw new Error('Duplicate patient identity in roster; source must be reviewed.');seen.add(key);
    return {id:String(p.id),key,name:String(p.name),phn:String(p.phn||''),unit:String(p.unit||''),room:String(p.room||''),codes:String(p.codes||''),ava:String(p.ava||''),pFlag:p.pFlag===true,panel:true};
  });
  return {patients,units:raw.units.map(u=>({id:String(u.id),name:String(u.name),floor:u.floor??''}))};
}
export function rosterView(roster, ledger) {
  const map=new Map(Object.entries(ledger.patients).map(([key,p])=>[key,{...p,key,panel:false,retained:true}]));
  for(const p of ledger.nonPanel) map.set(p.key,{...p,panel:false});
  for(const p of roster.patients) map.set(p.key,p);
  return [...map.values()];
}
export function validateLedger(l) {
  if(l?.app!==APP||l.schema!==SCHEMA||typeof l.datasetId!=='string'||!Number.isInteger(l.revision)||l.revision<0) throw new Error('Unsupported billing file; original roster files are never writable here.');
  for(const k of ['entries','nonPanel','units','batches']) if(!Array.isArray(l[k])) throw new Error(`Invalid ${k}.`);
  for(const k of ['patients','baselines','settings']) if(!l[k]||typeof l[k]!=='object'||Array.isArray(l[k])) throw new Error(`Invalid ${k}.`);
  const ids=new Set();
  for(const e of l.entries) {
    if(!e.id||ids.has(e.id)||!e.patientKey||!validDate(e.date)||!Array.isArray(e.items)) throw new Error('Invalid/duplicate billing entry.');
    ids.add(e.id);
    if(!l.patients[e.patientKey]) throw new Error('Billing entry is missing its patient identity.');
    if(!e.items.length||e.items.some(i=>!/^\d{5}$/.test(i.code)||!Number.isInteger(Number(i.units))||Number(i.units)<1||Number(i.units)>99)) throw new Error('Invalid billing code or units.');
  }
  for(const b of Object.values(l.baselines)) if(!validDate(b.date)||b.date>today()) throw new Error('Invalid starting billing date.');
  if(typeof l.settings.parallel!=='boolean'||!Array.isArray(l.settings.portalYears))throw new Error('Invalid billing settings.');
  const patientDates=new Set();
  for(const e of l.entries){const k=`${e.patientKey}|${e.date}`;if(patientDates.has(k))throw new Error('Duplicate patient/date billing.');patientDates.add(k);}
  const batchIds=new Set();
  for(const b of l.batches) {
    if(!b.id||batchIds.has(b.id)||!Array.isArray(b.entryIds)||new Set(b.entryIds).size!==b.entryIds.length) throw new Error('Invalid batch.');
    batchIds.add(b.id);
    for(const id of b.entryIds) if(!l.entries.some(e=>e.id===id&&e.batchId===b.id)) throw new Error('Batch/entry mismatch.');
  }
  for(const e of l.entries) if(e.batchId&&!l.batches.some(b=>b.id===e.batchId&&b.entryIds.includes(e.id))) throw new Error('Finalized entry has no batch.');
  return l;
}
export function assertImmutable(previous,next) {
  if(previous.datasetId!==next.datasetId) throw new Error('Wrong billing dataset.');
  for(const b of previous.batches) if(JSON.stringify(b)!==JSON.stringify(next.batches.find(x=>x.id===b.id))) throw new Error('Handed-over batches cannot be altered.');
  for(const e of previous.entries.filter(e=>e.batchId)) if(JSON.stringify(e)!==JSON.stringify(next.entries.find(x=>x.id===e.id))) throw new Error('Handed-over billing cannot be altered.');
}
export function lastBilling(ledger,key,asOf='9999-12-31',resetOnly=false,excludeId=null) {
  const dates=ledger.entries.filter(e=>e.patientKey===key&&e.date<=asOf&&e.id!==excludeId&&(!resetOnly||e.items.some(i=>RESET_CODES.includes(i.code)))).map(e=>e.date);
  const base=ledger.baselines[key];if(base?.date<=asOf) dates.push(base.date);
  return dates.sort().at(-1)||null;
}
export function dueState(ledger,patient,date=today()) {
  if(!patient.panel) return {label:'Ad hoc only',kind:'adhoc',last:lastBilling(ledger,patient.key,date)};
  const last=lastBilling(ledger,patient.key,date,true);if(!last) return {label:'History needed',kind:'unknown',last:null};
  const due=addDays(last,14); return {last,due,kind:due<=date?'due':'later',label:due<=date?'Due for billing review':`Next ${due}`};
}
export function upsertEntry(ledger,patient,date,items,comment='',id=null) {
  if(!validDate(date)||date>today()) throw new Error('Choose a valid service date, not a future date.');
  if(!items.length) throw new Error('Select at least one code.');
  const l=clone(ledger);const existing=id?l.entries.find(e=>e.id===id):l.entries.find(e=>e.patientKey===patient.key&&e.date===date);
  if(id&&!existing) throw new Error('Entry no longer exists. Reload before editing.');
  if(existing?.batchId) throw new Error('This entry has already been handed over.');
  if(l.entries.some(e=>e.patientKey===patient.key&&e.date===date&&e.id!==existing?.id)) throw new Error('A billing entry already exists for this patient/date. Edit that entry instead.');
  l.patients[patient.key]=clone(patient);
  const entry={id:existing?.id||crypto.randomUUID(),patientKey:patient.key,panelAtBilling:existing?.panelAtBilling??patient.panel,date,items:clone(items),comment,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),batchId:null};
  if(existing) l.entries[l.entries.findIndex(e=>e.id===existing.id)]=entry; else l.entries.push(entry);
  return l;
}
export function removeEntry(ledger,id) {
  const e=ledger.entries.find(e=>e.id===id);if(!e) throw new Error('Entry not found.');if(e.batchId) throw new Error('Handed-over entries cannot be removed.');
  const l=clone(ledger);l.entries=l.entries.filter(e=>e.id!==id);return l;
}
export function batchEntries(ledger,from,to) {return ledger.entries.filter(e=>!e.batchId&&e.date>=from&&e.date<=to).sort((a,b)=>a.date.localeCompare(b.date)||a.patientKey.localeCompare(b.patientKey));}
export function entryIssues(entry,ledger,patient) {
  const errors=[]; const required=(ok,msg)=>{if(!ok)errors.push(msg);};
  const codes=entry.items.map(i=>i.code); const all=ledger.entries;
  if(entry.date>today()) errors.push('Future service date.');
  if(new Set(codes).size!==codes.length) errors.push('Duplicate code on the same entry.');
  for(const i of entry.items) {
    const info=codeInfo(i.code); const prefix=`${i.code}: `;
    if(!info) {required(i.customVerified===true&&Boolean(i.customLabel?.trim()),prefix+'custom code needs a description and physician rule confirmation.');if(i.customTimed){required(minutes(i.start)!==null&&minutes(i.end)!==null&&minutes(i.end)>minutes(i.start),prefix+'custom timed code needs valid start/end times.');}}
    if(info?.reason||(entry.panelAtBilling??patient?.panel)===false) required(Boolean(i.reason?.trim()),prefix+'reason required.');
    if(info?.participants) required(Boolean(i.participants?.trim()),prefix+'participants / roles required.');
    if(info?.request) required(Boolean(i.requester?.trim())&&Boolean(i.requestAt)&&!Number.isNaN(Date.parse(i.requestAt)),prefix+'requesting person and request date/time required.');
    if(info?.attendance) required(minutes(i.start)!==null,prefix+'attendance time required.');
    if(info?.admission||info?.callout) required(i.attested===true,prefix+'confirm the code-specific criteria.');
    if(info?.portal) required(ledger.settings.portalYears?.includes(entry.date.slice(0,4)),prefix+'confirm eligible portal status for this year in Settings.');
    if(info?.timed) {
      const a=minutes(i.start),b=minutes(i.end);required(a!==null&&b!==null&&b>a,prefix+'valid start/end times required (same-day interval).');
      if(a!==null&&b!==null&&b>a) {
        required(b-a>=8,prefix+'less than eight minutes; review the appropriate code.');
        required(Number(i.units)<=Math.min(2,Math.floor((b-a+7)/15)),prefix+'units exceed documented time or daily maximum.');
        const overlap=all.some(e=>e.date===entry.date&&e.items.some(x=>!(e.id===entry.id&&x===i)&&codeInfo(x.code)?.timed&&minutes(x.start)!==null&&minutes(x.end)!==null&&a<minutes(x.end)&&b>minutes(x.start)));
        required(!overlap,prefix+'overlapping timed service recorded for this physician.');
      }
    } else if(info) required(Number(i.units)===1,prefix+'use one unit; additional services need separate review.');
    if(info?.annual) {
      const total=all.filter(e=>e.date.slice(0,4)===entry.date.slice(0,4)&&(info.physicianLimit||e.patientKey===entry.patientKey)).flatMap(e=>e.items).filter(x=>x.code===i.code).reduce((sum,x)=>sum+Number(x.units),0);
      required(total<=info.annual,prefix+`recorded-here annual total ${total} exceeds reference limit ${info.annual}.`);
    }
    if(i.code==='13115') required(!all.some(e=>e.id!==entry.id&&e.patientKey===entry.patientKey&&e.items.some(x=>x.code==='13115')),prefix+'another admission charge is already recorded.');
    if(i.code==='00114') {
      const prior=lastBilling(ledger,entry.patientKey,entry.date,true,entry.id);
      if(prior&&daysBetween(prior,entry.date)<14) required(Boolean(i.reason?.trim()),prefix+'within 14 days of recorded billing; explanatory claim note required.');
    }
    if(i.code==='00115'&&i.requestAt&&minutes(i.start)!==null) {
      const gap=(Date.parse(`${entry.date}T${i.start}`)-Date.parse(i.requestAt))/3600000;
      required(gap>=0&&gap<=24,prefix+'attendance must be within 24 hours after request.');
      required(minutes(i.start)>=480&&minutes(i.start)<=1380,prefix+'outside 08:00–23:00; review code.');
    }
  }
  if(codes.includes('13334')) {
    required(codes.some(c=>['00114','00127','13115'].includes(c)),'13334 requires a qualifying same-day visit on this entry.');
    required(!all.some(e=>e.date===entry.date&&e.id!==entry.id&&e.items.some(i=>i.code==='13334')),'13334 already recorded on this date.');
    required(!all.some(e=>e.date===entry.date&&e.items.some(i=>i.code==='00115')),'13334 with an urgent assessment on this date requires review; blocked in this prototype.');
  }
  if(codes.includes('00115')&&codes.some(c=>['13334','01200','01201','01202'].includes(c))) errors.push('Urgent assessment cannot be combined with these bonus/call-out codes.');
  if(codes.includes('14067')&&codes.some(c=>['14077','14018'].includes(c))) errors.push('14067 cannot be combined with 14077/14018.');
  if(codes.includes('14077')&&codes.includes('14018')) errors.push('14077 cannot be combined with 14018.');
  if(codes.includes('13005')&&codes.some(c=>!['13005','14076'].includes(c))) errors.push('13005 has same-day service restrictions.');
  if(codes.includes('13115')&&codes.some(c=>['00114','00115'].includes(c))) required(entry.items.filter(i=>['00114','00115'].includes(i.code)).every(i=>i.reason?.trim()),'Admission plus visit requires a medical-necessity claim note.');
  return [...new Set(errors)];
}
export function finalizeBatch(ledger,entries,{from,to,layout,reviewed=false,delivered=false}) {
  if(ledger.settings.parallel) throw new Error('Paper comparison mode is active. Explicitly end it in Settings before final handoff.');
  if(!reviewed||!delivered||!entries.length) throw new Error('Confirm review and actual delivery before finalizing.');
  if(entries.some(e=>e.batchId||!ledger.entries.some(x=>x.id===e.id))) throw new Error('Batch selection changed.');
  const l=clone(ledger);const b={id:crypto.randomUUID(),from,to,layout,entryIds:entries.map(e=>e.id),handedOverAt:new Date().toISOString()};
  l.batches.push(b);for(const e of l.entries) if(b.entryIds.includes(e.id)) e.batchId=b.id;return l;
}
