// A procedure date is a fact, not proof that administrative closeout finished.
export const closeoutSteps=['metadata','documents','sourceCleanup','provisionDraft','mileage','calendar','pharmacyDraft'];
const text=value=>typeof value==='string'&&value.trim().length>0;
export function checkpointDone(step,value){
  return !!value&&text(value.source)&&text(value.verifiedAt)&&
    (value.status==='verified'||(!['metadata','documents'].includes(step)&&value.status==='excluded'&&text(value.reason)));
}
export function closeoutOutstanding(patient){
  return closeoutSteps.filter(step=>!checkpointDone(step,patient.postProvision?.checkpoints?.[step]));
}
export function isProvisionClosed(patient){
  return patient.postProvision?.status==='complete'&&text(patient.postProvision.completedAt)&&
    /^\d{4}-\d{2}-\d{2}$/.test(patient.provisionDate||'')&&text(patient.provisionSource)&&!closeoutOutstanding(patient).length;
}
export function isProvisionPending(patient){return !!patient.provisionDate&&!isProvisionClosed(patient);}
export function maidAppPatients(patients){return patients.filter(p=>!isProvisionClosed(p));}
export function patientLocation(patient){
  return patient.currentLocation?.display_name||patient.currentLocation?.label||patient.location||'Not recorded';
}
