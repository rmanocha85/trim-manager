// Three-way session merge. Never treat an old complete file as a replacement for Drive.
import {clone,validateLedger,assertImmutable} from './core.mjs?v=20261007-cancel1';
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const equal=(a,b)=>stable(a)===stable(b);
const entryKey=e=>`${e.patientKey}|${e.date}`;
const entryValue=e=>e&&Object.fromEntries(Object.entries(e).filter(([k])=>!['id','createdAt','updatedAt'].includes(k)));
export function mergeSession(base,local,remote,choices={}){
  if(!base)throw new Error('This older draft has no saved starting copy. Review Local changes, then discard it and re-enter any billing you need.');
  for(const value of [base,local,remote])validateLedger(value);
  if(base.datasetId!==local.datasetId||base.datasetId!==remote.datasetId)throw new Error('These are different billing files. Nothing was saved.');
  const result=clone(remote),conflicts=[];
  function choose(id,label,b,l,r,{entry=false,locked=false}={}){
    const eq=entry?(a,z)=>equal(entryValue(a),entryValue(z)):equal;
    if(eq(l,b)||eq(l,r))return r;
    if(eq(r,b)&&!locked)return l;
    // A choice is valid only for the exact versions the user reviewed.
    const token=stable([id,b,l,r]);
    const choice=choices[id];
    if(choice?.token===token&&(choice.side==='drive'||(choice.side==='local'&&!locked)))return choice.side==='drive'?r:l;
    conflicts.push({id,label,token,local:l,drive:r,entry,locked});return r;
  }
  function array(field,key,label,options=()=>({})){
    const maps=[base,local,remote].map(v=>new Map((v[field]||[]).map(x=>[key(x),x]))),out=[];
    for(const k of new Set([...maps[2].keys(),...maps[1].keys(),...maps[0].keys()])){
      const [b,l,r]=maps.map(m=>m.get(k));
      const value=choose(`${field}:${k}`,label(l||r||b),b,l,r,options(b,l,r));
      if(value!==undefined)out.push(clone(value));
    }
    if(out.length||field in remote||field in local)result[field]=out;
  }
  const name=e=>local.patients[e.patientKey]?.name||remote.patients[e.patientKey]?.name||'Patient';
  array('entries',entryKey,e=>`${name(e)} · ${e.date}`,(b,l,r)=>({entry:true,locked:Boolean(r?.batchId||b?.batchId||(remote.historicalBillings||[]).some(h=>entryKey(h)===entryKey(l||b||r)))}));
  array('nonPanel',p=>p.key,p=>`${p.name} — patient details`);
  array('cancellations',c=>c.id,()=> 'Billing removal record');
  for(const [field,key] of [['batches','id'],['historicalBillings','id'],['imports','sourceDatasetId'],['reviewResolutions','key']])array(field,x=>x[key],()=>field,(_b,_l,r)=>({locked:Boolean(r)}));
  for(const field of ['patients','baselines','settings']){
    result[field]={};
    for(const k of new Set([...Object.keys(remote[field]),...Object.keys(local[field]),...Object.keys(base[field])])){
      const label=field==='settings'?`Setting: ${k}`:`${local.patients[k]?.name||remote.patients[k]?.name||'Patient'} — ${field==='baselines'?'starting date':'details'}`;
      const value=choose(`${field}:${k}`,label,base[field][k],local[field][k],remote[field][k]);
      if(value!==undefined)result[field][k]=clone(value);
    }
  }
  const known=new Set(['entries','nonPanel','cancellations','batches','historicalBillings','imports','reviewResolutions','patients','baselines','settings','app','schema','datasetId','revision','updatedAt','localWriter']);
  for(const k of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]))if(!known.has(k)){
    const value=choose(`field:${k}`,`Workspace: ${k}`,base[k],local[k],remote[k]);
    if(value===undefined)delete result[k];else result[k]=clone(value);
  }
  // Two offline sessions can each auto-add the day's bonus. Keep the existing
  // Drive bonus, otherwise one deterministic auto-added bonus; never alter history.
  const bonusDays=new Set((remote.historicalBillings||[]).filter(h=>h.codes.includes('13334')).map(h=>h.date));
  const ordered=[...result.entries].sort((a,b)=>Number(remote.entries.some(e=>e.id===b.id&&e.items.some(i=>i.code==='13334')))-Number(remote.entries.some(e=>e.id===a.id&&e.items.some(i=>i.code==='13334')))||a.id.localeCompare(b.id));
  for(const e of ordered)if(e.items.some(i=>i.code==='13334')){
    if(bonusDays.has(e.date)&&!e.batchId&&!remote.entries.some(r=>r.id===e.id&&r.items.some(i=>i.code==='13334')))e.items=e.items.filter(i=>i.code!=='13334'||!i.autoAdded);
    if(e.items.some(i=>i.code==='13334'))bonusDays.add(e.date);
  }
  if(!conflicts.length){validateLedger(result);assertImmutable(remote,result);}
  return {ledger:result,conflicts};
}
