// Alternate identifiers are entered only after the physician confirms the identity.
export const oatPhns=p=>[p.phn,...(p.alternatePhns||[]).map(alias=>alias.phn)].filter(Boolean);
export const oatNames=p=>[p.name,...(p.nameAliases||[])];
export const hasOatPhn=(p,phn)=>oatPhns(p).includes(phn);
export function oatPhnIndex(patients){
  const index=new Map();
  for(const patient of patients){
    if(patient.alternatePhns&&(!Array.isArray(patient.alternatePhns)||patient.alternatePhns.some(alias=>!alias||typeof alias.phn!=='string'||!/^\d{10}$/.test(alias.phn)))||patient.nameAliases&&(!Array.isArray(patient.nameAliases)||patient.nameAliases.some(name=>typeof name!=='string'||!name.trim())))throw new Error('Invalid OAT alternate identifiers.');
    for(const phn of oatPhns(patient)){
      if(!/^\d{10}$/.test(phn)||index.has(phn))throw new Error('Invalid or duplicate OAT PHN or alternate PHN.');
      index.set(phn,patient);
    }
  }
  return index;
}
