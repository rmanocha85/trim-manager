import {oatPhns,oatNames} from './oat-identifiers.mjs?v=20261127-oat-identity1';
const statuses=new Set(['active','history']);
const manualSource='Physician edit in Work OS';
const conflict=()=>Object.assign(new Error('This patient’s status changed elsewhere. Reload the clinic roster before trying again.'),{status:409});
const dateAt=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));

// Phone and appointment edits do not invalidate Undo; any status or panel review edit does.
export function oatStatusVersion(patient){
  return JSON.stringify([patient.status,patient.statusHistory||[],patient.statusOverride||null,patient.statusReview||null]);
}
export function oatStatusAction(patient,clinic,status,options={}){
  return {type:'patient-status',clinic,patientId:patient.id,status,expectedVersion:oatStatusVersion(patient),id:crypto.randomUUID(),at:new Date().toISOString(),...options};
}
export function changeOatPatientStatus(roster,action){
  if(action.clinic!==roster.clinic||!statuses.has(action.status)||typeof action.id!=='string'||!/^[\w-]{1,80}$/.test(action.id)||typeof action.at!=='string'||!Number.isFinite(Date.parse(action.at)))throw new Error('Invalid OAT patient status change.');
  if(action.review!==undefined&&!['keep','panel'].includes(action.review)||action.undoOf&&action.review)throw new Error('Invalid OAT status review.');
  const next=structuredClone(roster),patient=next.patients.find(p=>p.id===action.patientId);
  if(!patient||oatStatusVersion(patient)!==action.expectedVersion)throw conflict();
  const history=patient.statusHistory||[],last=history.at(-1);
  if(history.some(entry=>entry.id===action.id))throw conflict();
  const previousOverride=patient.statusOverride||null,previousReview=patient.statusReview||null;
  const entry={id:action.id,from:patient.status,to:action.status,date:dateAt(action.at),at:action.at,source:manualSource,previousOverride,previousReview};
  const restore=(key,value)=>{if(value)patient[key]=structuredClone(value);else delete patient[key];};
  if(action.undoOf){
    if(last?.id!==action.undoOf||last.source!==manualSource||last.undoOf||action.status!==last.from)throw conflict();
    restore('statusOverride',last.previousOverride);restore('statusReview',last.previousReview);entry.undoOf=last.id;
  }else if(action.review){
    if(!patient.statusReview||action.status!==(action.review==='keep'?patient.status:patient.statusReview.panelStatus))throw conflict();
    if(action.review==='panel')delete patient.statusOverride;
    delete patient.statusReview;entry.review=action.review;
  }else{
    if(patient.status===action.status)throw conflict();
    patient.statusOverride={status:action.status,id:action.id,at:action.at};delete patient.statusReview;
  }
  patient.status=action.status;patient.statusHistory=[...history,entry];next.updatedAt=action.at;
  return next;
}

// A full Ava panel can update demographics while a physician's contrary status
// remains effective. Agreement clears the override; disagreement needs review.
export function reconcileOatPatientStatus(patient,status,source,asOf){
  if(patient.statusOverride){
    if(patient.statusOverride.status!==status){
      patient.statusReview={panelStatus:status,asOf,source:source.file,sha256:source.sha256};
      return;
    }
    delete patient.statusOverride;
  }
  delete patient.statusReview;
  if(patient.status!==status){
    patient.statusHistory=[...(patient.statusHistory||[]),{from:patient.status,to:status,date:asOf,source:source.file}];
    patient.status=status;
  }
}
export function oatStatusDate(patient){
  return [...(patient.statusHistory||[])].reverse().find(entry=>entry.to===patient.status&&entry.from!==entry.to)?.date||'';
}
export function oatPatientMatches(patient,query){
  const words=query.toLocaleLowerCase().trim().split(/[\s,]+/).filter(Boolean);
  const names=oatNames(patient).map(name=>name.toLocaleLowerCase());
  const digits=query.replace(/\D/g,'');
  return names.some(name=>words.every(word=>name.includes(word)))||(/^[-\d\s]+$/.test(query)&&digits.length>0&&[...oatPhns(patient),patient.ava].some(value=>String(value||'').replace(/\D/g,'').includes(digits)));
}
