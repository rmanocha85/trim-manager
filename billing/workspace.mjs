// Pure workspace helpers. No patient data or network access.
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
  for(const [field,label] of [['cancellations','Billing removals'],['settings','Settings'],['batches','Batch handoff'],['historicalBillings','Billing history'],['imports','Reviewed import'],['reviewResolutions','Clarification'],['units','Location reference']])if(stable(base[field])!==stable(current[field]))rows.push({kind:label,name:'Workspace',date:'',detail:'Included in the next session save.'});
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
