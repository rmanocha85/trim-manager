import {randomUUID} from 'node:crypto';
import {validateOatRoster} from './public/oat-roster-repository.mjs';
import {validClinicDate} from './public/oat-schedule.mjs';
const phnValue=value=>String(value??'').replace(/[\s-]/g,'');
export function prepareOatImport(original,input,now=new Date().toISOString()){
  validateOatRoster(original);
  if(!validClinicDate(input?.clinicDate)||!Array.isArray(input.appointments)||!input.source?.pdfSha256||!input.source?.emailUrl)throw new Error('A verified clinic date, appointments and PDF/email provenance are required.');
  const next=structuredClone(original),added=[],requested=new Set(),registrationNeeded=[];
  const appointments=input.appointments.map((row,index)=>{
    if(row.unmatched===true){if(typeof row.name!=='string'||!row.name.trim())throw new Error('An unresolved appointment needs its supplied name.');return {id:`${input.clinicDate}-${index+1}`,time:row.time,sourceName:row.name,...(row.note?{note:row.note}:{})};}
    if(row.label&&!row.phn&&!row.patientId&&!row.name)return {id:`${input.clinicDate}-${index+1}`,time:row.time,label:row.label,...(row.note?{note:row.note}:{})};
    let patient;
    if(row.patientId){patient=next.patients.find(p=>p.id===row.patientId);if(!patient)throw new Error('An appointment refers to an unknown roster patient.');}
    const phn=phnValue(row.phn);
    if(phn){
      if(!/^\d{10}$/.test(phn))throw new Error('An appointment PHN is incomplete or invalid.');
      const match=next.patients.find(p=>p.phn===phn);if(patient&&patient.phn!==phn)throw new Error('Patient ID and PHN conflict.');patient ||= match;
    }
    if(!patient){
      if(!phn||typeof row.name!=='string'||!row.name.trim()||!validClinicDate(row.dob))throw new Error('A new patient needs a source-verified name, PHN and DOB. Resolve this row before import.');
      patient={id:'oat-fh-'+randomUUID(),name:row.name.trim(),phn,dob:row.dob,ava:null,status:'active',createdAt:now,source:structuredClone(input.source),avaRegistration:{status:'pending'}};
      next.patients.push(patient);added.push(patient.id);
    }
    if(row.dob&&(!validClinicDate(row.dob)||patient.dob&&patient.dob!==row.dob))throw new Error('An appointment DOB conflicts with the roster.');
    if(!patient.dob&&row.dob)patient.dob=row.dob;
    if(!patient.ava&&patient.avaRegistration?.status!=='sent'&&!requested.has(patient.id)){
      if(!/^\d{10}$/.test(patient.phn||'')||!validClinicDate(patient.dob))throw new Error('A pending Ava patient needs a verified PHN and DOB before registration email preparation.');
      requested.add(patient.id);registrationNeeded.push({patientId:patient.id,name:patient.name,phn:patient.phn,dob:patient.dob});
    }
    return {id:`${input.clinicDate}-${index+1}`,time:row.time,patientId:patient.id,...(row.name?{sourceName:row.name}:{}),...(row.note?{note:row.note}:{})};
  });
  const day={date:input.clinicDate,appointments,source:structuredClone(input.source),updatedAt:now};
  next.clinicDays ||= [];const index=next.clinicDays.findIndex(d=>d.date===input.clinicDate);
  if(index>=0){
    if(next.clinicDays[index].source?.pdfSha256!==input.source.pdfSha256&&input.replaceExisting!==true)throw new Error('A different schedule is already saved for this date. Review its changes and explicitly select replacement.');
    next.clinicDays[index]=day;
  }else next.clinicDays.push(day);
  next.updatedAt=now;validateOatRoster(next);
  return {roster:next,added,registrationNeeded};
}
export function setOatAva(original,phn,ava,now=new Date().toISOString()){
  const next=structuredClone(validateOatRoster(original)),digits=phnValue(phn),value=String(ava);
  if(!/^\d{10}$/.test(digits)||!/^\d{6,10}$/.test(value))throw new Error('A valid PHN and Ava number are required.');
  const patient=next.patients.find(p=>p.phn===digits);if(!patient)throw new Error('No matching roster PHN.');
  if(patient.ava&&patient.ava!==value||next.patients.some(p=>p.id!==patient.id&&p.ava===value))throw new Error('This Ava number conflicts with a saved identity.');
  patient.ava=value;patient.updatedAt=now;next.updatedAt=now;return validateOatRoster(next);
}
export function recordOatRegistrationSent(original,receipt,expectedRecipient){
  if(typeof expectedRecipient!=='string'||!expectedRecipient.includes('@')||receipt?.recipient!==expectedRecipient||!receipt.messageUrl||!Number.isFinite(Date.parse(receipt.sentAt))||!Array.isArray(receipt.patientIds)||!receipt.patientIds.length)throw new Error('A verified Sent email receipt for the intended office recipient is required.');
  const next=structuredClone(validateOatRoster(original));
  for(const id of new Set(receipt.patientIds)){
    const patient=next.patients.find(p=>p.id===id);if(!patient)throw new Error('A sent receipt references an unknown patient.');
    patient.avaRegistration={...patient.avaRegistration,status:'sent',recipient:receipt.recipient,messageUrl:receipt.messageUrl,sentAt:receipt.sentAt};
  }
  next.updatedAt=receipt.sentAt;return validateOatRoster(next);
}
