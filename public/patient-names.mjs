// One patient-name presentation rule for Work OS. Never guess surname boundaries.
// Existing mixed-case spelling (McDonald, deVries) remains authoritative.
export function formatNameInput(value){
  return String(value??'').replace(/\p{L}[\p{L}\p{M}]*/gu,word=>{
    if(/^(II|III|IV)$/.test(word))return word;
    const [first]=word;
    if(word!==word.toUpperCase()&&word!==word.toLowerCase())return word;
    return first.toUpperCase()+word.slice(first.length).toLowerCase();
  }).replace(/\s*,\s*/gu,', ');
}
export const formatNamePart=value=>formatNameInput(value).trim();
export function rosterName(lastName,firstName){
  if(!lastName?.trim()||!firstName?.trim())throw new Error('Verified last and given names are required.');
  return formatNamePart(lastName)+', '+formatNamePart(firstName);
}
export function patientName(patient){
  if(patient&&typeof patient==='object'){
    if(patient.lastName?.trim()&&patient.firstName?.trim())return rosterName(patient.lastName,patient.firstName);
    return formatNamePart(patient.name);
  }
  return formatNamePart(patient);
}
