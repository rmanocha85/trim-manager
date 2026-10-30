// Pure workspace helpers. No patient data or network access.
import {clone,dueState,validDiagnosis,validDate,today,upsertInteractiveEntry,validateLedger,entryIssues} from './core.mjs?v=20261030-workspace2';

// Display confirmed identity corrections as one history without rewriting records.
// Names alone never establish identity; different recorded PHNs stay separate.
export function patientHistoryGroups(ledger,patients){
  const byKey=new Map(patients.map(p=>[p.key,p])),targets=new Map();
  for(const [key,baseline] of Object.entries(ledger.baselines||{})){
    const c=baseline.identityCorrection,previous=c?.previousPatientKey;
    const old=byKey.get(previous),current=byKey.get(key);
    if(!c?.confirmedInChat||!old||!current||previous===key||old.phn||c.previousPhn||
      previous!==`roster:${c.rosterId}`||old.id!==c.rosterId||current.id!==c.rosterId||
      !/^\d{10}$/.test(c.correctedPhn)||current.phn!==c.correctedPhn||key!==`phn:${c.correctedPhn}`||
      !old.ava||String(old.ava)!==String(current.ava))continue;
    if(!targets.has(previous))targets.set(previous,[]);
    targets.get(previous).push(key);
  }
  const aliases=new Map([...targets].filter(([,keys])=>keys.length===1).map(([key,keys])=>[key,keys[0]]));
  const groups=new Map();
  for(const patient of patients){
    const key=aliases.get(patient.key)||patient.key;
    if(!groups.has(key))groups.set(key,{patient:byKey.get(key),keys:new Set()});
    groups.get(key).keys.add(patient.key);
  }
  return [...groups.values()];
}

// Count changed charges, not people, timestamps, or cancellation audit records.
export function changedBillCount(rows){
  return rows.reduce((count,r)=>{
    if(!r.before&&!r.after)return count;
    const before=new Map((r.before?.items||[]).map(i=>[i.code,i])),after=new Map((r.after?.items||[]).map(i=>[i.code,i]));
    return count+[...new Set([...before.keys(),...after.keys()])].filter(code=>stable(before.get(code))!==stable(after.get(code))||r.before?.comment!==r.after?.comment).length;
  },0);
}
export function routineCandidates(ledger,patients,date){
  return patients.filter(p=>p.panel).map(patient=>{
    const state=dueState(ledger,patient,date),diagnoses=String(patient.codes||'').trim().split(/[,;\s]+/).filter(Boolean);
    const already=[...ledger.entries,...(ledger.historicalBillings||[])].some(e=>e.patientKey===patient.key&&e.date===date);
    const problem=state.kind==='unknown'?'Starting billing history unknown':!diagnoses.length?'Usual ICD-9 missing':!diagnoses.every(validDiagnosis)?'Usual ICD-9 needs review':'';
    return {patient,last:state.last,diagnosis:diagnoses[0]||'',usualCodes:diagnoses.join(', '),status:state.kind==='hospital'?'hospital':already?'billed':problem?'review':state.kind==='due'?'due':'later',reason:state.kind==='hospital'?state.label:already?'Already billed on this date':problem||state.label};
  });
}
export function addRoutineBatch(ledger,patients,date,keys){
  if(!validDate(date)||date>today())throw new Error('Choose today or an earlier billing date.');
  const selected=new Set(keys);if(!selected.size)throw new Error('Select patients you saw.');
  const candidates=routineCandidates(ledger,patients,date),chosen=[...selected].map(key=>candidates.find(c=>c.patient.key===key));
  if(chosen.some(c=>!c||c.status!=='due'))throw new Error('The selection changed or includes a patient who is not eligible. Review the list again.');
  let next=clone(ledger);const entries=[];
  for(const c of chosen){
    // Match individual routine billing: no per-charge override, so reports use
    // the patient's complete usual ICD-9 set, not an arbitrarily chosen code.
    next=upsertInteractiveEntry(next,c.patient,date,[{code:'00114',units:1}]);
    const entry=next.entries.find(e=>e.patientKey===c.patient.key&&e.date===date);
    const issues=entryIssues(entry,next,c.patient);if(issues.length)throw new Error(issues.join(' '));
    entries.push(clone(entry));
  }
  validateLedger(next);return {ledger:next,receipt:{date,entries}};
}
export function undoRoutineBatch(ledger,receipt){
  if(!receipt?.entries?.length)throw new Error('No new routine batch to undo.');
  for(const original of receipt.entries){
    const current=ledger.entries.find(e=>e.id===original.id);
    if(current&&(current.batchId||stable(current)!==stable(original)))throw new Error('A batch entry has since been edited. Remove its codes individually in History.');
  }
  const ids=new Set(receipt.entries.map(e=>e.id)),next=clone(ledger);next.entries=next.entries.filter(e=>!ids.has(e.id));validateLedger(next);return next;
}
export function newestBillingFirst(entries){
  const entered=e=>{const time=Date.parse(e.createdAt);return Number.isFinite(time)?time:0;};
  // Entry creation, not service date or last edit. Legacy records without a
  // creation timestamp stay below dated entries, ordered by service date.
  return [...entries].sort((a,b)=>entered(b)-entered(a)||b.date.localeCompare(a.date)||String(a.id).localeCompare(String(b.id)));
}
const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function sessionChanges(base,current){
  if(!base||!current)return [];
  const rows=[],old=new Map(base.entries.map(e=>[e.id,e])),next=new Map(current.entries.map(e=>[e.id,e]));
  for(const id of new Set([...old.keys(),...next.keys()])){
    const before=old.get(id),after=next.get(id),entry=after||before;
    if(stable(before)===stable(after))continue;
    rows.push({kind:!before?'Added billing':!after?'Removed billing':'Edited billing',patientKey:entry.patientKey,name:current.patients[entry.patientKey]?.name||base.patients[entry.patientKey]?.name||'Patient',date:entry.date,before,after});
  }
  const oldPeople=new Map((base.nonPanel||[]).map(p=>[p.key,p]));
  const newPeople=new Map((current.nonPanel||[]).map(p=>[p.key,p]));
  for(const key of new Set([...oldPeople.keys(),...newPeople.keys()]))if(stable(oldPeople.get(key))!==stable(newPeople.get(key)))rows.push({kind:!oldPeople.has(key)?'Added patient':!newPeople.has(key)?'Removed patient':'Updated patient',patientKey:key,name:(newPeople.get(key)||oldPeople.get(key)).name,date:'',detail:'Coverage list only; original roster unchanged.'});
  for(const key of new Set([...Object.keys(base.baselines),...Object.keys(current.baselines)]))if(stable(base.baselines[key])!==stable(current.baselines[key]))rows.push({kind:'Starting date',patientKey:key,name:current.patients[key]?.name||base.patients[key]?.name||'Patient',date:current.baselines[key]?.date||base.baselines[key]?.date,detail:current.baselines[key]?'Updated starting billing date.':'Removed starting billing date.'});
  // Cancellations are already represented by patient/code changes and Undo rows.
  for(const key of new Set([...Object.keys(base.newPatientStarts||{}),...Object.keys(current.newPatientStarts||{})]))if(stable(base.newPatientStarts?.[key])!==stable(current.newPatientStarts?.[key]))rows.push({kind:'First routine review',patientKey:key,name:current.patients[key]?.name||base.patients[key]?.name||'Patient',date:current.newPatientStarts?.[key]?.firstRoutineDate||'',detail:'New-patient review plan updated. No charge has been created.'});
  for(const [field,label] of [['settings','Settings'],['batches','Batch handoff'],['historicalBillings','Billing history'],['imports','Reviewed import'],['reviewResolutions','Clarification'],['units','Location reference']])if(stable(base[field])!==stable(current[field]))rows.push({kind:label,name:label,date:'',detail:`${label} updated on this device; will be saved with the session.`});
  // Include identity updates not already represented by another change.
  for(const key of new Set([...Object.keys(base.patients),...Object.keys(current.patients)]))if(stable(base.patients[key])!==stable(current.patients[key])&&!rows.some(r=>r.patientKey===key))rows.push({kind:'Patient details',patientKey:key,name:current.patients[key]?.name||base.patients[key]?.name||'Patient',date:'',detail:'Saved patient details changed.'});
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
}
export function normalizePHN(value){return String(value||'').replace(/[\s-]/g,'');}
export function matchesPatientSearch(patient,query){
  const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const words=normalize(query).split(/[\s,]+/).filter(Boolean);
  const text=normalize(`${patient.name} ${patient.room||''} ${patient.phn||''}`);
  return words.every(word=>text.includes(word));
}
export function coveragePatient(fields,existing,id){
  const name=String(fields.name||'').trim(),phn=normalizePHN(fields.phn);
  if(!name||name.length>120)throw new Error('Enter the patient name.');
  if(!/^\d{10}$/.test(phn))throw new Error('Check the PHN: enter exactly 10 digits. Letters are never converted to numbers.');
  const key=`phn:${phn}`;if(existing.some(p=>p.key===key))throw new Error('This PHN is already on the list. Search for and select the existing patient above.');
  return {id,key,name,phn,unit:String(fields.unit||''),room:String(fields.room||'').trim(),codes:String(fields.codes||'').trim(),ava:'',panel:false};
}
export function extractDemographics(text){
  const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean),names=[],phns=[];
  for(const line of lines){
    const labelled=line.match(/^(?:patient\s+name|name)\s*[:=]\s*([\p{L}][\p{L} .,'’\-]{2,119})$/iu);
    const bare=line.match(/^([\p{L}][\p{L}'’\- ]{1,50},\s*[\p{L}][\p{L}.'’\- ]{0,60})(?:\s+[|$].*)?$/u);
    const name=(labelled?.[1]||bare?.[1]||'').trim();
    if(name&&!/\b(?:BC|AB|ON|Canada|Mission|Dashboard|Consult|Medical|Notes|Orders)\b/i.test(name))names.push(name);
    // Only explicit PHN labels, or the AVA PHN/province row. Never guess from phone/chart numbers.
    const labelledPHN=line.match(/\b(?:PHN|personal health number|health number)\s*[:#=]?\s*([\d -]{10,16})(?!\d)/i);
    const ava=line.match(/^([\d -]{10,16})\s*[|I]?\s*BC\b/i);
    const value=normalizePHN(labelledPHN?.[1]||ava?.[1]||'');
    if(/^\d{10}$/.test(value))phns.push(value);
  }
  const uniqueNames=[...new Set(names)],uniquePHNs=[...new Set(phns)];
  return {name:uniqueNames.length===1?uniqueNames[0]:'',phn:uniquePHNs.length===1?uniquePHNs[0]:'',warnings:[...(uniqueNames.length!==1?['Name unclear or multiple names found—enter it manually.']:[]),...(uniquePHNs.length!==1?['PHN unclear or multiple PHNs found—enter all 10 digits manually.']:[])]};
}
