import {normalize,validate} from './patients-core.mjs';
import {mergeRoster} from './roster-merge.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const value=(p,field)=>p[field]??(field==='familyContacts'?[]:'');
function find(roster,id){for(const collection of ['patients','otherPatients']){const patient=roster[collection]?.find(p=>String(p.id)===String(id));if(patient)return {patient,collection};}throw new Error('Patient is no longer in this roster. Reload before editing.');}

// Save only an owned field. Merge remote changes into the local draft separately.
export function prepareRosterFieldSave({base,local,remote,patientId,field,expected,next}){
  if(!['familyContacts','ava'].includes(field))throw new Error('Unsupported shared patient field.');
  [base,local,remote]=[base,local,remote].map(r=>structuredClone(normalize(r)));
  const b=find(base,patientId),l=find(local,patientId),r=find(remote,patientId);
  if(b.collection!==l.collection||b.collection!==r.collection||[l,r].some(x=>x.patient.phn!==b.patient.phn||x.patient.name!==b.patient.name))throw new Error('Patient identity or roster placement changed. Reload before saving.');
  if(!equal(value(l.patient,field),expected))throw new Error('This field changed while the editor was open. Reopen it before saving.');
  if(!equal(value(l.patient,field),value(b.patient,field)))throw new Error('Save or discard the pending changes to this field first.');
  if(!equal(value(r.patient,field),value(b.patient,field))&&!equal(value(r.patient,field),next))throw new Error('This field changed elsewhere. Reload the roster before saving.');
  if(field==='ava'){
    if(!/^\d{6,10}$/.test(next))throw new Error('Enter an Ava EMR number containing 6–10 digits.');
    if(['patients','otherPatients','removedPatients'].some(c=>remote[c].some(p=>String(p.id)!==String(patientId)&&String(p.ava||'')===next)))throw new Error('This Ava EMR number is already assigned to another patient.');
  }
  r.patient[field]=structuredClone(next);l.patient[field]=structuredClone(next);
  validate(remote);
  const merged=mergeRoster(base,local,remote);
  if(merged.conflicts.length)throw new Error('Resolve the other pending roster conflicts before saving this field.');
  return {saved:remote,pending:merged.roster};
}
