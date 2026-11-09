import {validateClinicRoster} from './clinic-roster-repository.mjs';
import {validateClinicDays} from './oat-schedule.mjs';
const V2='https://www.googleapis.com/drive/v2/files';
const FOLDER='1d90SEhco30YL0AAE20gt11pzFBjOOJUn';
export function validateOatRoster(data){
  validateClinicRoster(data);
  if(data.clinic!=='oat-fh')throw new Error('The selected file is not the OAT Fraser Health roster.');
  validateClinicDays(data.clinicDays??[],data.patients);
  return data;
}
// Read the canonical private JSON only. Never create, upload or cache patient records.
export class OatRepository {
  constructor(adapter){this.adapter=adapter;}
  async locate(){
    if(this.fileId)return this.fileId;
    const q=encodeURIComponent(`'${FOLDER}' in parents and title = 'oat-fh-roster.json' and trashed = false`);
    const result=await this.adapter.request(`${V2}?q=${q}&fields=items(id),nextPageToken`);
    if(result.nextPageToken||result.items?.length!==1)throw new Error('The OAT AI folder must contain one accessible oat-fh-roster.json. Check Drive sync and patient-record access, then reload OAT FH.');
    return this.fileId=result.items[0].id;
  }
  async load(){
    if(this.adapter.mode==='local'){
      const result=await this.adapter.request('/api/oat-fh/roster');
      validateOatRoster(result.roster);return result;
    }
    const id=await this.locate();
    for(let attempt=0;attempt<3;attempt++){
      const before=await this.adapter.request(`${V2}/${id}?fields=id,etag`);
      const roster=validateOatRoster(await this.adapter.request(`${V2}/${id}?alt=media`));
      const after=await this.adapter.request(`${V2}/${id}?fields=id,etag`);
      if(before.etag&&before.etag===after.etag)return {roster,etag:after.etag};
    }
    throw new Error('OAT FH changed while loading. Reload the patient list.');
  }
}
