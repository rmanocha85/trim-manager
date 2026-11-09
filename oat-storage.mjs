import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';import path from 'node:path';
import {validateOatRoster} from './public/oat-roster-repository.mjs';
export class OatStore {
  constructor(filename){this.filename=filename;}
  async load(){
    const text=await readFile(this.filename,'utf8');
    return {roster:validateOatRoster(JSON.parse(text)),etag:createHash('sha256').update(text).digest('hex')};
  }
  async update(expected,mutator){
    const hash=value=>createHash('sha256').update(value).digest('hex');
    if(!expected)throw new Error('A verified OAT revision is required.');
    const lockPath=path.join(os.tmpdir(),'trim-oat-locks',hash(path.resolve(this.filename))+'.lock');
    await mkdir(path.dirname(lockPath),{recursive:true});let lock;
    try{lock=await open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('Another OAT update is running. Reload before retrying.');throw error;}
    const temporary=this.filename+'.'+randomUUID()+'.tmp';
    try{
      const current=await this.load();if(current.etag!==expected)throw new Error('OAT changed elsewhere. Reload before retrying.');
      const next=validateOatRoster(await mutator(structuredClone(current.roster)));
      const text=JSON.stringify(next,null,2)+'\n',file=await open(temporary,'wx');try{await file.writeFile(text);await file.sync();}finally{await file.close();}
      if((await this.load()).etag!==expected)throw new Error('OAT changed during preparation. Nothing replaced.');
      await rename(temporary,this.filename);const saved=await this.load();if(saved.etag!==hash(text))throw new Error('OAT readback differed. Reload before continuing.');return saved;
    }finally{await unlink(temporary).catch(()=>{});await lock.close();await unlink(lockPath).catch(()=>{});}
  }
}
