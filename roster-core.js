/* Private roster data is loaded at runtime. No patient data belongs in this file. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TrimRoster=api;
})(globalThis,function(){
  'use strict';
  const digits=value=>String(value??'').replace(/\D/g,'');
  function today(now=new Date()){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const value=type=>parts.find(p=>p.type===type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
  function dateParts(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Invalid removal calendar date.');
    const [y,m,d]=value.split('-').map(Number);
    if(y<1000||m<1||m>12||d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate())throw new Error('Invalid removal calendar date.');
    return [y,m,d];
  }
  function expiresOn(removedDate){
    const [y,m,d]=dateParts(removedDate);
    const end=new Date(Date.UTC(y,m-1+3,1));
    const year=end.getUTCFullYear(),month=end.getUTCMonth()+1;
    const day=Math.min(d,new Date(Date.UTC(year,month,0)).getUTCDate());
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function validate(raw){
    if(!raw||!Array.isArray(raw.patients)||!Array.isArray(raw.units)||!Array.isArray(raw.billingDates)||
       (raw.removedPatients!==undefined&&!Array.isArray(raw.removedPatients)))throw new Error('Invalid roster structure.');
    const seen={id:new Set(),phn:new Set(),ava:new Set()};
    for(const p of [...raw.patients,...(raw.removedPatients||[])]){
      if(!p||['id','name','phn','unit','room','codes','ava'].some(k=>!Object.hasOwn(p,k))||!String(p.id)||!String(p.name))throw new Error('Incomplete roster identity.');
      for(const key of ['id','phn','ava']){
        const value=key==='id'?String(p[key]):digits(p[key]);
        if(!value)continue;
        if(seen[key].has(value))throw new Error(`Duplicate ${key} across active or removed patients. Review the roster.`);
        seen[key].add(value);
      }
    }
    for(const p of raw.removedPatients||[])dateParts(p.removedDate);
    for(const p of raw.patients)if(Object.hasOwn(p,'removedDate'))throw new Error('Active patient has a removal date.');
    return raw;
  }
  function normalize(raw){return {...validate(raw),removedPatients:raw.removedPatients||[]};}
  function expire(raw,asOf=today()){
    dateParts(asOf);
    const roster=normalize(raw);
    return {...roster,removedPatients:roster.removedPatients.filter(p=>asOf<expiresOn(p.removedDate))};
  }
  function remove(raw,id,asOf=today()){
    const roster=normalize(raw),target=roster.patients.find(p=>String(p.id)===String(id));
    if(!target){
      if(roster.removedPatients.some(p=>String(p.id)===String(id)))return expire(roster,asOf);
      throw new Error('Patient not found; nothing removed.');
    }
    return expire({...roster,patients:roster.patients.filter(p=>p!==target),removedPatients:[...roster.removedPatients,{...target,removedDate:asOf}]},asOf);
  }
  function add(raw,fields,asOf=today(),newId=()=>globalThis.crypto.randomUUID()){
    const roster=expire(raw,asOf),phn=digits(fields.phn),ava=digits(fields.ava);
    if(!String(fields.name||'').trim()||!fields.unit||!String(fields.room||'').trim()||!String(fields.codes||'').trim()||!/^\d{10}$/.test(phn)||!/^\d{6,10}$/.test(ava))throw new Error('Name, unit, room, codes, 10-digit PHN and 6–10-digit Ava number are required.');
    if(!roster.units.some(u=>u.id===fields.unit))throw new Error('Unknown unit.');
    const matches=p=>digits(p.phn)===phn||digits(p.ava)===ava;
    if(roster.patients.some(matches))throw new Error('PHN or Ava already belongs to an active patient.');
    const retained=roster.removedPatients.filter(matches);
    if(retained.length>1||retained.some(p=>digits(p.phn)!==phn||digits(p.ava)!==ava))throw new Error('Returning patient identifiers conflict. Verify both PHN and Ava before reactivation.');
    const old=retained[0];
    const patient={...old,...fields,id:old?.id||newId(),phn,ava};
    delete patient.removedDate;
    return validate({...roster,patients:[...roster.patients,patient],removedPatients:roster.removedPatients.filter(p=>p!==old)});
  }
  function edit(raw,id,fields,asOf=today()){
    const roster=expire(raw,asOf),old=roster.patients.find(p=>String(p.id)===String(id));
    if(!old)throw new Error('Patient not found.');
    const updated={...old,...fields,id:old.id};
    if(Object.hasOwn(fields,'phn'))updated.phn=digits(fields.phn);
    if(Object.hasOwn(fields,'ava'))updated.ava=digits(fields.ava);
    return validate({...roster,patients:roster.patients.map(p=>p===old?updated:p)});
  }
  return {today,expiresOn,validate,normalize,expire,remove,add,edit};
});
