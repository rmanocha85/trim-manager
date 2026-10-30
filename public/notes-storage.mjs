import {saveRecovery,loadRecovery} from './recovery.mjs';
export const CONTENT_PATH='patient-context.json';
export const dayPath=date=>`visits/${date}.json`;
export const sourcePath=id=>`sources/${id}.json`;
export const handoffPath=date=>`handoffs/${date}.json`;
const V3='https://www.googleapis.com/drive/v3/files';
const V2='https://www.googleapis.com/drive/v2/files';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export class LocalNotesRepository{
  constructor(api){this.api=api;this.mode='local';}
  load(name){return this.api('/api/notes/document?name='+encodeURIComponent(name));}
  save(name,data,etag){return this.api('/api/notes/document?name='+encodeURIComponent(name),{method:'PUT',headers:{'If-Match':etag||'new'},body:JSON.stringify(data)});}
}
export class DriveNotesRepository{
  constructor(adapter,rootId=''){this.adapter=adapter;this.rootId=rootId;this.mode='cloud';this.files=new Map();this.folders=new Map();}
  request(url,options){return this.adapter.request(url,options);}
  async list(q){const r=await this.request(V3+'?q='+encodeURIComponent(q+' and trashed = false')+'&fields=files(id,name,parents),nextPageToken&pageSize=100');if(r.nextPageToken)throw new Error('Too many matching clinical folders/files; select the exact Notes folder.');return r.files||[];}
  async privateFolder(id){const f=await this.request(V3+'/'+id+'?fields=id,mimeType,permissions(role,type)');if(f.mimeType!=='application/vnd.google-apps.folder'||!f.permissions?.length||f.permissions.some(p=>p.role!=='owner'))throw new Error('Choose your private Routine notes folder. Folder sharing was not changed.');}
  async root(create=false){
    if(this.rootId){await this.privateFolder(this.rootId);return this.rootId;}
    let id=this.adapter.fileId;
    for(let i=0;i<8&&id;i++){
      let f;try{f=await this.request(V3+'/'+id+'?fields=id,name,parents');}catch(e){if([403,404].includes(e.status))break;throw e;}
      if(f.name==='TRIM AI'){
        await this.privateFolder(id);let parent=await this.folder(id,'Working records',create);if(!parent)return null;parent=await this.folder(parent,'Routine notes',create);if(parent){await this.privateFolder(parent);this.rootId=parent;}return parent;
      }id=f.parents?.length===1?f.parents[0]:null;
    }
    throw new Error('Select the private TRIM AI / Working records / Routine notes Drive folder in Notes settings. The current Google permission cannot locate its parents.');
  }
  async folder(parent,name,create){const key=parent+'/'+name;if(this.folders.has(key))return this.folders.get(key);const files=await this.list(`'${parent}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder'`);if(files.length>1)throw new Error('Duplicate clinical folders need reconciliation.');let id=files[0]?.id;if(!id&&create){await this.privateFolder(parent);id=(await this.request(V3+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[parent]})})).id;}if(id){await this.privateFolder(id);this.folders.set(key,id);}return id;}
  async locate(name,create=false){
    checkPath(name);let parent=await this.root(create);if(!parent)return null;const parts=name.split('/');if(parts.length===2){parent=await this.folder(parent,parts.shift(),create);if(!parent)return null;}
    await this.privateFolder(parent);const filename=parts[0],matches=await this.list(`'${parent}' in parents and name = '${filename}'`);if(matches.length>1)throw new Error('Duplicate clinical files need reconciliation; nothing overwritten.');return {id:matches[0]?.id,parent,filename};
  }
  async load(name){const f=await this.locate(name);if(!f?.id)return {data:null,etag:'new'};for(let n=0;n<2;n++){const before=await this.request(V2+'/'+f.id+'?fields=id,etag'),data=await this.request(V2+'/'+f.id+'?alt=media'),after=await this.request(V2+'/'+f.id+'?fields=id,etag');if(before.etag&&before.etag===after.etag)return {data,etag:after.etag,id:f.id};}throw new Error('Clinical file changed during reading. Reconnect before saving.');}
  async save(name,data,etag){
    const f=await this.locate(name,true),current=await this.load(name);
    if(equal(current.data,data))return current;
    if(current.etag!==etag)throw Object.assign(new Error('Notes changed on Drive. Your local work is retained. Reconcile before saving.'),{status:409});
    if(f.id){await this.request('https://www.googleapis.com/upload/drive/v2/files/'+f.id+'?uploadType=media',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(data)});}
    else{
      // Reserve and retain an ID before upload, so an uncertain response is retryable.
      const key='notes-create:'+this.rootId+':'+name;let pending=await loadRecovery(key);
      if(!pending){pending=(await this.request(V3+'/generateIds?count=1&space=drive&type=files')).ids?.[0];if(!pending)throw new Error('Could not reserve a clinical file ID.');await saveRecovery(key,pending);}
      const boundary='notes_'+crypto.randomUUID(),meta={id:pending,name:f.filename,mimeType:'application/json',parents:[f.parent]};
      const body=`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
      try{await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});}catch(e){if(e.status!==409)throw e;}
    }
    const verified=await this.load(name);if(!equal(verified.data,data))throw new Error('Clinical save could not be verified. Local work retained.');return verified;
  }
}
export function checkPath(name){if(!/^(patient-context\.json|patient-display\.json|index\.json|patients\/\d{10}\.json|visits\/\d{4}-\d{2}-\d{2}\.json|handoffs\/\d{4}-\d{2}-\d{2}\.json|sources\/[a-zA-Z0-9-]{1,80}\.json)$/.test(name||''))throw new Error('Invalid clinical document path.');return name;}
