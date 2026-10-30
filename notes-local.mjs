import {readFile,writeFile,mkdir,rename,open,unlink,copyFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {checkPath,CONTENT_PATH} from './public/notes-storage.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const conflict=message=>Object.assign(new Error(message),{status:409});
const patientPath=key=>{
  if(!/^phn:\d{10}$/.test(key))throw new Error('A patient record requires a ten-digit PHN.');
  return `patients/${key.slice(4)}.json`;
};
function checkPatient(key,record){
  patientPath(key);
  if(!record?.patient||record.patient.key!==key||record.patient.phn!==key.slice(4))throw new Error('Patient file and PHN identity do not match.');
}
export class LocalNotesStore{
  constructor(root,locks){this.root=root;this.locks=locks;}
  filename(name){checkPath(name);return path.join(this.root,...name.split('/'));}
  async read(filename){try{const raw=await readFile(filename,'utf8');return {data:JSON.parse(raw),etag:hash(raw)};}catch(e){if(e.code==='ENOENT')return {data:null,etag:'new'};throw e;}}
  async atomic(filename,data){await mkdir(path.dirname(filename),{recursive:true});const raw=JSON.stringify(data,null,2)+'\n',temp=filename+'.'+randomUUID()+'.tmp';await writeFile(temp,raw,{mode:0o600});await rename(temp,filename);if((await this.read(filename)).etag!==hash(raw))throw new Error('Clinical save did not verify.');}
  async locked(fn){
    await mkdir(this.locks,{recursive:true});
    const lock=path.join(this.locks,hash(path.resolve(this.root))+'.lock');let handle;
    // Reads share the transaction lock so browsers cannot observe half a save.
    for(let i=0;i<100;i++){
      try{handle=await open(lock,'wx');break;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,20));}
    }
    if(!handle)throw new Error('Another clinical save is running. Retry once it completes.');
    try{await this.recover();return await fn();}finally{await handle.close();await unlink(lock);}
  }
  async recover(){
    const journal=path.join(this.root,'.context-transaction.json'),pending=await this.read(journal);
    if(!pending.data)return;
    // Replay only exact before/after versions. Unexpected edits stop recovery.
    for(const change of pending.data.changes){
      const current=await this.read(this.filename(change.name));
      if(current.etag!==change.before&&!equal(current.data,change.data))throw conflict('A patient file changed during an interrupted save. Reconcile before continuing.');
    }
    for(const change of pending.data.changes){
      const filename=this.filename(change.name);
      if(!equal((await this.read(filename)).data,change.data))await this.atomic(filename,change.data);
    }
    await unlink(journal);
  }
  async context(){
    const index=(await this.read(this.filename('index.json'))).data;
    if(!index)return this.read(this.filename(CONTENT_PATH));
    const legacy=await this.read(this.filename(CONTENT_PATH));
    if(legacy.data&&(await this.read(path.join(this.root,'archive',`patient-context-${legacy.etag}.json`))).etag!==legacy.etag)throw conflict('The retired combined context was changed by another writer. Reconcile that file before continuing.');
    if(index.app!=='trim-notes'||index.kind!=='patient-index'||index.schema!==1||!index.context||!index.patients)throw new Error('Invalid patient index.');
    const patients={};
    for(const [key,ref]of Object.entries(index.patients)){
      if(ref.path!==patientPath(key)||ref.phn!==key.slice(4))throw new Error('Invalid patient index identity.');
      const record=(await this.read(this.filename(ref.path))).data;
      if(!record||record.app!=='trim-notes'||record.kind!=='patient-context'||record.schema!==1||record.datasetId!==index.context.datasetId)throw new Error('Missing or invalid indexed patient file. Nothing was overwritten.');
      checkPatient(key,record.context);patients[key]=record.context;
    }
    const data={...index.context,patients};
    return {data,etag:hash(JSON.stringify(data))};
  }
  async load(name){checkPath(name);return this.locked(()=>name===CONTENT_PATH?this.context():this.read(this.filename(name)));}
  async saveContext(data,etag){
    const current=await this.context(),indexed=(await this.read(this.filename('index.json'))).data;
    if(equal(current.data,data)&&indexed)return current;
    if(current.etag!==etag)throw conflict('Clinical record changed. Local edits were retained. Reconnect Notes before saving.');
    if(data?.app!=='trim-notes'||data.kind!=='context'||data.schema!==1||!data.datasetId||!data.patients)throw new Error('Invalid clinical context.');
    if(current.data&&current.data.datasetId!==data.datasetId)throw conflict('Clinical dataset changed. Nothing was overwritten.');
    for(const key of Object.keys(current.data?.patients||{}))if(!data.patients[key])throw conflict('An existing patient context is missing. Nothing was overwritten.');
    const {patients,...metadata}=data,index={app:'trim-notes',schema:1,kind:'patient-index',context:metadata,patients:{}},changes=[];
    for(const [key,context]of Object.entries(patients)){
      checkPatient(key,context);const name=patientPath(key);
      index.patients[key]={phn:context.patient.phn,name:context.patient.name,path:name};
      const record={app:'trim-notes',schema:1,kind:'patient-context',datasetId:data.datasetId,context},before=await this.read(this.filename(name));
      if(!indexed&&before.data&&!equal(before.data,record))throw conflict('An existing patient file needs reconciliation before migration.');
      if(!equal(before.data,record))changes.push({name,before:before.etag,data:record});
    }
    const beforeIndex=await this.read(this.filename('index.json'));
    if(!equal(beforeIndex.data,index))changes.push({name:'index.json',before:beforeIndex.etag,data:index});
    // Immutable migration backup, never another maintained context.
    const legacy=await this.read(this.filename(CONTENT_PATH));
    if(legacy.data){
      const backup=path.join(this.root,'archive',`patient-context-${legacy.etag}.json`);
      await mkdir(path.dirname(backup),{recursive:true});
      try{await copyFile(this.filename(CONTENT_PATH),backup,1);}catch(e){if(e.code!=='EEXIST')throw e;}
      if((await this.read(backup)).etag!==legacy.etag)throw new Error('Migration backup did not verify.');
    }
    await this.atomic(path.join(this.root,'.context-transaction.json'),{schema:1,changes});
    await this.recover();
    const saved=await this.context();if(!equal(saved.data,data))throw new Error('Patient migration did not verify.');
    if(legacy.data){
      if((await this.read(this.filename(CONTENT_PATH))).etag!==legacy.etag)throw conflict('Legacy context changed during migration; retained for reconciliation.');
      await unlink(this.filename(CONTENT_PATH));
    }
    return saved;
  }
  async save(name,data,etag){
    checkPath(name);
    return this.locked(async()=>{
      if(name===CONTENT_PATH)return this.saveContext(data,etag);
      if(name==='index.json'||name.startsWith('patients/'))throw new Error('Save patient records through the context transaction.');
      const filename=this.filename(name),current=await this.read(filename);
      if(equal(current.data,data))return current;
      if(current.etag!==etag)throw conflict('Clinical record changed. Local edits were retained.');
      await this.atomic(filename,data);return this.read(filename);
    });
  }
}
