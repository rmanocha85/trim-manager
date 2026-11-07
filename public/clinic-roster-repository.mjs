const V2='https://www.googleapis.com/drive/v2/files';
const conflict=()=>Object.assign(new Error('MAID changed elsewhere. Reload the MAID list and review before trying again.'),{status:409});
export function validateClinicRoster(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.patients))throw new Error('Invalid clinic roster.');
  const ids=new Set(),phns=new Set(),avas=new Set();
  for(const p of data.patients){
    if(!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name.trim()||!['active','history'].includes(p.status)||ids.has(p.id)||p.phn&&(!/^\d{10}$/.test(p.phn)||phns.has(p.phn))||p.ava&&(!/^\d{6,10}$/.test(p.ava)||avas.has(p.ava))||p.contacts&&!Array.isArray(p.contacts)||p.statusHistory&&!Array.isArray(p.statusHistory))throw new Error('Invalid or duplicate clinic patient.');
    ids.add(p.id);if(p.phn)phns.add(p.phn);if(p.ava)avas.add(p.ava);
  }
  return data;
}
function mergeFacts(old,changes){
  const result={...old};for(const [k,v] of Object.entries(changes)){
    if(['__proto__','constructor','prototype'].includes(k))throw new Error('Invalid field.');
    result[k]=v&&typeof v==='object'&&!Array.isArray(v)?mergeFacts(old?.[k]||{},v):structuredClone(v);
  }return result;
}
export function applyMaidAction(data,action,now=new Date().toISOString()){
  validateClinicRoster(data);const next=structuredClone(data),p=next.patients.find(p=>p.id===action.patientId);
  if(action.type==='create'){
    if(!action.patient)throw new Error('A verified patient is required.');next.patients.push(structuredClone(action.patient));
  }else{
    if(!p)throw conflict();
    if(action.type==='remove')next.patients=next.patients.filter(x=>x.id!==p.id);
    else if(action.type==='status'){
      if(!['active','history'].includes(action.status))throw new Error('Invalid MAID status.');
      if(p.status===action.status)return data;
      p.statusHistory=[...(p.statusHistory||[]),{from:p.status,to:action.status,at:now}];p.status=action.status;p.updatedAt=now;
    }else if(action.type==='update'){
      if(!action.changes||Object.keys(action.changes).some(k=>['id','phn','statusHistory'].includes(k)))throw new Error('Identity or status history cannot be overwritten.');
      const updated=mergeFacts(p,action.changes);
      if(updated.status!==p.status)updated.statusHistory=[...(p.statusHistory||[]),{from:p.status,to:updated.status,at:now}];
      updated.updatedAt=now;next.patients[next.patients.indexOf(p)]=updated;
    }else throw new Error('Unknown MAID action.');
  }
  next.updatedAt=now;return validateClinicRoster(next);
}
export class MaidRepository {
  // The private roster keeps its Drive identity when its containing folder moves.
  constructor(adapter){this.adapter=adapter;this.fileId='11WLFL5WHoIK93YaQpZUHDnLbGJzXfLB4';}
  async locate(){return this.fileId;}
  async load(){
    if(this.adapter.mode==='local'){const result=await this.adapter.request('/api/maid/roster');validateClinicRoster(result.roster);return result;}
    const id=await this.locate();
    for(let attempt=0;attempt<3;attempt++){
      const before=await this.adapter.request(V2+'/'+id+'?fields=id,etag');
      const roster=validateClinicRoster(await this.adapter.request(V2+'/'+id+'?alt=media'));
      const after=await this.adapter.request(V2+'/'+id+'?fields=id,etag');
      if(before.etag&&before.etag===after.etag)return {roster,etag:after.etag};
    }throw conflict();
  }
  async mutate(action,expected){
    if(!expected?.etag)throw conflict();
    if(this.adapter.mode==='local')return this.adapter.request('/api/maid/roster',{method:'POST',headers:{'Content-Type':'application/json','If-Match':expected.etag},body:JSON.stringify(action)});
    const current=await this.load();if(current.etag!==expected.etag)throw conflict();
    const next=applyMaidAction(current.roster,action);if(next===current.roster)return current;
    await this.adapter.request('https://www.googleapis.com/upload/drive/v2/files/'+this.fileId+'?uploadType=media',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':expected.etag},body:JSON.stringify(next)});
    const saved=await this.load();if(JSON.stringify(saved.roster)!==JSON.stringify(next))throw conflict();return saved;
  }
}
export async function loadMaidRoster(adapter){return (await new MaidRepository(adapter).load()).roster;}
