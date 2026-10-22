import {normalize,validate} from './patients-core.mjs';
const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b)=>stable(a)===stable(b);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
// Merge patient fields independently, but treat moves/removals as whole-record
// operations. A removal must never silently erase a concurrent patient edit.
export function mergeRoster(base,local,remote,choices={}){
  if(!base)throw new Error('This patient draft has no starting copy. Review it before reloading the saved roster.');
  [base,local,remote]=[base,local,remote].map(normalize);
  const conflicts=[];
  function pick(path,b,l,r,label=path){
    if(equal(l,b)||equal(l,r))return structuredClone(r);
    if(equal(r,b))return structuredClone(l);
    if(object(b)&&object(l)&&object(r)){
      const out={};for(const k of new Set([...Object.keys(r),...Object.keys(l),...Object.keys(b)])){
        const v=pick(path+'.'+k,b[k],l[k],r[k],label+' · '+k);if(v!==undefined)out[k]=v;
      }return out;
    }
    const token=stable([path,b,l,r]),choice=choices[path];
    if(choice?.token===token)return structuredClone(choice.side==='local'?l:r);
    conflicts.push({id:path,label,token,local:l,drive:r});return structuredClone(r);
  }
  const collections=['patients','otherPatients','removedPatients'];
  const records=doc=>new Map(collections.flatMap(c=>doc[c].map(patient=>[String(patient.id),{collection:c,patient}])));
  const maps=[base,local,remote].map(records),result={};
  for(const c of collections)result[c]=[];
  for(const id of new Set(maps.flatMap(m=>[...m.keys()]))){
    const [b,l,r]=maps.map(m=>m.get(id)),label=(l||r||b).patient.name;
    let value;
    if(b&&l&&r&&b.collection===l.collection&&b.collection===r.collection)value={collection:r.collection,patient:pick('patient:'+id,b.patient,l.patient,r.patient,label)};
    else {
      // Wrap to prevent recursive merging of a move with an unrelated edit.
      const chosen=pick('patient:'+id,b&&[b],l&&[l],r&&[r],label);value=chosen?.[0];
    }
    if(value)result[value.collection].push(value.patient);
  }
  for(const k of new Set([...Object.keys(remote),...Object.keys(local),...Object.keys(base)]))if(!collections.includes(k)){
    const value=pick(k,base[k],local[k],remote[k]);if(value!==undefined)result[k]=value;
  }
  if(!conflicts.length)validate(result);
  return {roster:result,conflicts};
}
