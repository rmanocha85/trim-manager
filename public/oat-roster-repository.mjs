import {phoneLink} from './clinic-contacts.mjs?v=20261108-closeout1';
import {validateClinicRoster} from './clinic-roster-repository.mjs';
import {validateClinicDays,finishAppointment} from './oat-schedule.mjs?v=20261117-purple1';
const V2='https://www.googleapis.com/drive/v2/files';
const FOLDER='1d90SEhco30YL0AAE20gt11pzFBjOOJUn';
// The shared roster's existing Drive ID. Google still enforces account and file access.
export const OAT_FILE_ID='1dyQnrCSdywVJ8GRktgBLyDj_0m5rN9VR';
export const oatClinics={
  'oat-fh':{title:'OAT Fraser Health',folder:FOLDER,fileId:OAT_FILE_ID},
  'oat-purple':{title:'OAT Purple',folder:'1JNXOy5TNjSQPQ-AlJkBq3j7yklXXbBj0',fileId:'1EFNxUHzhOXP3U2TLiuHpXx4SDBvYReyr'}
};
export function validateOatRoster(data,clinic='oat-fh'){
  validateClinicRoster(data);
  if(!Object.hasOwn(oatClinics,clinic))throw new Error('Unknown OAT clinic.');
  if(data.clinic!==clinic)throw new Error('The selected file is not the '+oatClinics[clinic].title+' roster.');
  validateClinicDays(data.clinicDays??[],data.patients);
  return data;
}
export function applyOatAction(roster,action) {
  if(action?.type!=='patient-phone')return finishAppointment(roster,action);
  if(typeof action.phone!=='string'||action.phone.length>80||!phoneLink(action.phone))throw new Error('Enter one valid phone number.');
  const next=structuredClone(roster);
  const patient=next.patients.find(p=>p.id===action.patientId);
  if(!patient||(patient.phone||'')!==action.expectedPhone)throw Object.assign(new Error('This patient’s phone changed. Reload the clinic roster before editing it.'),{status:409});
  patient.phone=action.phone.trim();
  return next;
}
export class OatRepository {
  constructor(adapter,clinic='oat-fh'){this.adapter=adapter;this.clinic=clinic;this.config=oatClinics[clinic];this.path='/api/'+clinic+'/roster';}
  finish(action){return this.save(action);}
  async save(action){
    await this.adapter.ensureConnected?.();
    const current=await this.load();
    const next=validateOatRoster(applyOatAction(current.roster,action),this.clinic);
    if(this.adapter.mode==='local')return this.adapter.request(this.path,{method:'POST',headers:{'Content-Type':'application/json','If-Match':current.etag},body:JSON.stringify(action)});
    const id=await this.locate();
    await this.adapter.request(`https://www.googleapis.com/upload/drive/v2/files/${id}?uploadType=media`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':current.etag},body:JSON.stringify(next,null,2)+'\n'});
    const saved=await this.load();
    if(JSON.stringify(saved.roster)!==JSON.stringify(next))throw new Error('OAT save could not be verified. Reload the clinic roster.');
    return saved;
  }
  async locate(){
    if(this.fileId)return this.fileId;
    const {folder,fileId,title}=this.config,filename=this.clinic+'-roster.json';
    const q=encodeURIComponent(`'${folder}' in parents and title = '${filename}' and trashed = false`);
    const result=await this.adapter.request(`${V2}?q=${q}&fields=items(id),nextPageToken`);
    if(result.items?.length===0&&!result.nextPageToken&&this.adapter.hostedAccess){
      // A per-file grant can expose the file without exposing the containing folder.
      let file;
      try{
        file=await this.adapter.request(V2+'/'+fileId+'?fields=id,title,labels(trashed),parents(id)');
      }catch(error){
        if([403,404].includes(error.status))throw Object.assign(new Error('Link the '+title+' roster to this TRIM account to load it on your computers.'),{code:'LINK_OAT'});
        throw error;
      }
      if(file.id===fileId&&file.title===filename&&!file.labels?.trashed&&(!file.parents?.length||file.parents.some(p=>p.id===folder)))return this.fileId=file.id;
    }
    if(result.nextPageToken||result.items?.length!==1)throw new Error('The clinic folder must contain one accessible '+filename+'. Check Drive sync and reload '+title+'.');
    return this.fileId=result.items[0].id;
  }
  async load(){
    if(this.adapter.mode==='local'){
      const result=await this.adapter.request(this.path);
      validateOatRoster(result.roster,this.clinic);return result;
    }
    const id=await this.locate();
    for(let attempt=0;attempt<3;attempt++){
      const before=await this.adapter.request(`${V2}/${id}?fields=id,etag`);
      const roster=validateOatRoster(await this.adapter.request(`${V2}/${id}?alt=media`),this.clinic);
      const after=await this.adapter.request(`${V2}/${id}?fields=id,etag`);
      if(before.etag&&before.etag===after.etag)return {roster,etag:after.etag};
    }
    throw new Error('The clinic roster changed while loading. Reload the patient list.');
  }
}
