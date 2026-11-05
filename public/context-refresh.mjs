// Three-way reconciliation only combines independent fields. A concurrent edit to
// the same field is surfaced and leaves the browser draft untouched.
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function mergeImportedContext(base,local,remote){
 if(!base)throw new Error('Saved patient context changed. Your older recovered draft is retained; reconcile it before saving.');
 if(base.datasetId!==local.datasetId||base.datasetId!==remote.datasetId)throw new Error('Patient context workspace changed.');
 const result=structuredClone(remote);
 for(const key of new Set([...Object.keys(base.patients),...Object.keys(local.patients)])){
  const before=base.patients[key],ours=local.patients[key],theirs=remote.patients[key];if(equal(before,ours))continue;
  if(equal(before,theirs)||equal(ours,theirs)){if(ours)result.patients[key]=structuredClone(ours);else delete result.patients[key];continue;}
  if(!before||!ours||!theirs)throw new Error('A patient profile changed during editing. Your draft is retained; reconcile the profile before saving.');
  const merged=structuredClone(theirs);
  for(const field of new Set([...Object.keys(before),...Object.keys(ours)])){
   if(equal(before[field],ours[field]))continue;
   if(field==='updatedAt'){merged[field]=[ours[field],theirs[field]].filter(Boolean).sort().at(-1);continue;}
   if(!equal(before[field],theirs[field])&&!equal(ours[field],theirs[field]))throw new Error('A document import and your draft both changed '+field+'. Your draft is retained; reconcile this field before saving.');
   if(Object.hasOwn(ours,field))merged[field]=structuredClone(ours[field]);else delete merged[field];
  }
  result.patients[key]=merged;
 }
 return result;
}
