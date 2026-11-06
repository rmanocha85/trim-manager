import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {createHash,randomUUID} from 'node:crypto';
import {validateClinicRoster,applyMaidAction} from './public/clinic-roster-repository.mjs';
const hash=t=>createHash('sha256').update(t).digest('hex');
export class MaidStore{
 constructor(filename){this.filename=filename;this.lock=path.join(os.tmpdir(),'trim-maid-locks',hash(path.resolve(filename))+'.lock');}
 async load(){const text=await readFile(this.filename,'utf8');return {roster:validateClinicRoster(JSON.parse(text)),etag:hash(text)};}
 async mutate(action,expected){
  if(!expected)throw Object.assign(new Error('A verified MAID revision is required.'),{status:409});
  await mkdir(path.dirname(this.lock),{recursive:true});let lock;
  try{lock=await open(this.lock,'wx');}catch(e){if(e.code==='EEXIST')throw Object.assign(new Error('Another MAID update is running. Reload and retry.'),{status:409});throw e;}
  const tmp=this.filename+'.'+randomUUID()+'.tmp';
  try{
   const current=await this.load();if(current.etag!==expected)throw Object.assign(new Error('MAID changed elsewhere. Reload before trying again.'),{status:409});
   const next=applyMaidAction(current.roster,action);if(next===current.roster)return current;
   const text=JSON.stringify(next,null,2)+'\n';const f=await open(tmp,'wx');try{await f.writeFile(text);await f.sync();}finally{await f.close();}
   if((await this.load()).etag!==expected)throw Object.assign(new Error('MAID changed during saving. Reload before trying again.'),{status:409});
   await rename(tmp,this.filename);const saved=await this.load();if(saved.etag!==hash(text))throw new Error('MAID save readback did not match. Reload before continuing.');return saved;
  }finally{await unlink(tmp).catch(()=>{});await lock.close();await unlink(this.lock).catch(()=>{});}
 }
}
