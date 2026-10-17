import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {checkPath} from './public/notes-storage.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
export class LocalNotesStore{
  constructor(root,locks){this.root=root;this.locks=locks;}
  filename(name){checkPath(name);return path.join(this.root,...name.split('/'));}
  async load(name){try{const raw=await readFile(this.filename(name),'utf8');return {data:JSON.parse(raw),etag:hash(raw)};}catch(e){if(e.code==='ENOENT')return {data:null,etag:'new'};throw e;}}
  async save(name,data,etag){
    const filename=this.filename(name);await mkdir(this.locks,{recursive:true});const lock=path.join(this.locks,hash(filename)+'.lock');let handle;
    try{handle=await open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Another clinical save is running. Retry once it completes.');throw e;}
    try{
      const current=await this.load(name);if(JSON.stringify(current.data)===JSON.stringify(data))return current;
      if(current.etag!==etag)throw Object.assign(new Error('Clinical record changed. Local edits were retained.'),{status:409});
      await mkdir(path.dirname(filename),{recursive:true});const raw=JSON.stringify(data,null,2)+'\n',temp=filename+'.'+randomUUID()+'.tmp';await writeFile(temp,raw,{mode:0o600});await rename(temp,filename);const saved=await this.load(name);if(saved.etag!==hash(raw))throw new Error('Clinical save did not verify.');return saved;
    }finally{await handle.close();await unlink(lock);}
  }
}
