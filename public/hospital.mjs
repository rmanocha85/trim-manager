// One canonical history on the roster patient. Admission is inclusive; return
// is exclusive, so the patient is back at TRIM on the recorded return date.
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export function validateHospitalStays(patient){
  if(patient?.hospitalStays===undefined)return [];
  const stays=patient.hospitalStays;
  if(!Array.isArray(stays))throw new Error('Hospital stays must be a list.');
  const ids=new Set();
  for(const s of stays){
    if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||!validDate(s.admittedDate)||(s.returnedDate!==null&&(!validDate(s.returnedDate)||s.returnedDate<s.admittedDate)))throw new Error('Invalid hospital stay: check identity, admission and return dates.');
    ids.add(s.id);
  }
  const sorted=[...stays].sort((a,b)=>a.admittedDate.localeCompare(b.admittedDate));
  for(let i=1;i<sorted.length;i++)if(!sorted[i-1].returnedDate||sorted[i].admittedDate<sorted[i-1].returnedDate||sorted[i].admittedDate===sorted[i-1].admittedDate)throw new Error('Hospital stays overlap. Correct the existing dates first.');
  return stays;
}
export function hospitalAt(patient,date){return validateHospitalStays(patient).find(s=>s.admittedDate<=date&&(!s.returnedDate||date<s.returnedDate))||null;}
export function latestHospitalStay(patient,date='9999-12-31'){return validateHospitalStays(patient).filter(s=>s.admittedDate<=date).sort((a,b)=>a.admittedDate.localeCompare(b.admittedDate)).at(-1)||null;}
export function latestHospitalReturn(patient,date){return validateHospitalStays(patient).filter(s=>s.returnedDate&&s.returnedDate<=date).map(s=>s.returnedDate).sort().at(-1)||null;}
export function hospitalBlocks114(patient,date){const stay=hospitalAt(patient,date);return Boolean(stay&&stay.admittedDate<date);}
export function assertHospital114(patient,date,items){if(items.some(i=>i.code==='00114')&&hospitalBlocks114(patient,date))throw new Error('114 is blocked after admission day while this patient is in hospital. Record the return date or correct the hospital dates. 14077 remains available.');}
export function updateHospitalStay(raw,key,{id=null,admittedDate,returnedDate=null},asOf){
  if(!validDate(asOf)||!validDate(admittedDate)||admittedDate>asOf||(returnedDate&&(!validDate(returnedDate)||returnedDate>asOf)))throw new Error('Enter actual hospital dates, not future dates.');
  const next=structuredClone(raw),matches=['patients','otherPatients','removedPatients'].flatMap(c=>(next[c]||[]).filter(p=>('phn:'+String(p.phn||'').replace(/\D/g,''))===key));
  if(!/^phn:\d{10}$/.test(key)||matches.length!==1)throw new Error('Hospital dates require one verified roster PHN. Add or correct this patient in TRIM Patient first.');
  const p=matches[0],stays=validateHospitalStays(p),old=id?stays.find(s=>s.id===id):null;
  if(id&&!old)throw new Error('Hospital stay changed. Reload before editing.');
  const stay={...old,id:old?.id||crypto.randomUUID(),admittedDate,returnedDate:returnedDate||null,updatedAt:new Date().toISOString()};
  p.hospitalStays=old?stays.map(s=>s.id===id?stay:s):[...stays,stay];
  validateHospitalStays(p);return next;
}
