import {DriveNotesRepository} from './notes-storage.mjs?v=20261030-workspace2';
import {saveRecovery,loadRecovery} from './recovery.mjs';
import {checkManifest} from './intake-core.mjs?v=20261030-workspace2';
const V3='https://www.googleapis.com/drive/v3/files';
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
export class DriveIntake{
 constructor(adapter){this.adapter=adapter;this.repo=new DriveNotesRepository(adapter);}
 async folder(create=false){const root=await this.repo.root(create);return root?this.repo.folder(root,'Incoming',create):null;}
 async matches(parent,name){const files=await this.repo.list(`'${parent}' in parents and name = '${name}'`);if(files.length>1)throw new Error('Duplicate upload files need reconciliation.');return files[0];}
 async put(parent,name,mime,bytes){
  const expected=await digest(bytes),existing=await this.matches(parent,name);let id=existing?.id;
  if(!id){
   const key='intake-create:'+parent+':'+name;id=await loadRecovery(key);if(!id){id=(await this.adapter.request(V3+'/generateIds?count=1&space=drive&type=files')).ids?.[0];if(!id)throw new Error('Could not reserve a Drive file.');await saveRecovery(key,id);}
   const boundary='trim_'+crypto.randomUUID(),meta={id,name,mimeType:mime,parents:[parent]};
   const body=new Blob([`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,bytes,`\r\n--${boundary}--`]);
   try{await this.adapter.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});}catch(e){if(e.status!==409)throw e;}
  }
  const verified=await this.adapter.bytes(V3+'/'+id+'?alt=media');if(await digest(verified)!==expected)throw new Error('Drive upload read-back did not match. Keep this dialog open to retry.');return id;
 }
 async submit({job,documents}){
  checkManifest(job);const parent=await this.folder(true),manifestName='intake-'+job.id+'.json',previous=await this.matches(parent,manifestName);
  if(previous){const old=await this.adapter.request(V3+'/'+previous.id+'?alt=media');checkManifest(old);if(old.phn!==job.phn||old.datasetId!==job.datasetId||JSON.stringify(old.files)!==JSON.stringify(job.files))throw new Error('Upload retry differs from the original.');return old;}
  for(let i=0;i<job.files.length;i++){const f=job.files[i],bytes=Uint8Array.from(atob(documents[i].split(',')[1]),c=>c.charCodeAt(0));await this.put(parent,f.file,f.mime,bytes);}
  const saved={...job,status:'queued',createdAt:new Date().toISOString(),message:'Uploaded to Drive. Analysis starts when the laptop service receives these files.'};
  await this.put(parent,manifestName,'application/json',new TextEncoder().encode(JSON.stringify(saved,null,2)+'\n'));return saved;
 }
 async list(phn){
  const parent=await this.folder();if(!parent)return [];let page='',files=[];
  do{const q=encodeURIComponent(`'${parent}' in parents and trashed = false and name contains 'intake-' and mimeType = 'application/json'`),r=await this.adapter.request(V3+'?q='+q+'&fields=files(id,name),nextPageToken&pageSize=100'+(page?'&pageToken='+encodeURIComponent(page):''));files.push(...r.files||[]);page=r.nextPageToken||'';}while(page);
  const jobs=[];for(let i=0;i<files.length;i+=6){await Promise.all(files.slice(i,i+6).filter(f=>/^intake-[a-f0-9-]+\.json$/.test(f.name)).map(async f=>{const j=checkManifest(await this.adapter.request(V3+'/'+f.id+'?alt=media'));if(j.phn===phn)jobs.push(j);}));}return jobs.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
 }
}
