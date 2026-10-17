import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {snapshot,validateSnapshot,cutoff} from './public/backups.mjs';
const pattern=/^TRIM-Billing_(.+)_([a-f0-9]{16})_([a-f0-9]{64})\.json$/;
export class LocalBackupStore {
  constructor(directory){this.directory=path.resolve(directory);}
  filename(name){if(!pattern.test(name||'')||path.basename(name)!==name)throw new Error('Invalid backup filename.');return path.join(this.directory,name);}
  async read(name,dataset){const text=await readFile(this.filename(name),'utf8');await validateSnapshot(text,dataset,pattern.exec(name)[3]);return text;}
  async list(dataset){
    if(!/^[a-f0-9]{64}$/.test(dataset||''))throw new Error('Invalid backup dataset.');
    let names;try{names=await readdir(this.directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const result=[];
    for(const name of names){const m=pattern.exec(name);if(!m||m[2]!==dataset.slice(0,16))continue;
      const text=await this.read(name,dataset),ledger=JSON.parse(text),s=await snapshot(ledger);
      const date=m[1].replace(/T(\d{2})-(\d{2})-(\d{2})/,'T$1:$2:$3');
      if(!Number.isFinite(Date.parse(date))||(ledger.updatedAt&&s.date!==date))throw new Error('Backup date does not match its contents.');
      result.push({id:name,name,appProperties:{owner:'trim-billing-backup-v1',dataset,sha:s.sha,date}});
    }return result;
  }
  async ensure(value){
    const ledger=JSON.parse(value.text),s=await snapshot(ledger);
    if(!ledger.updatedAt&&Number.isFinite(Date.parse(value.date))){s.date=new Date(value.date).toISOString();s.name=`TRIM-Billing_${s.date.replace(/:/g,'-')}_${s.dataset.slice(0,16)}_${s.sha}.json`;}
    if(['name','dataset','sha','date'].some(k=>s[k]!==value[k]))throw new Error('Backup contents do not match the requested snapshot.');
    const existing=(await this.list(s.dataset)).find(f=>f.appProperties.sha===s.sha);
    if(existing)return existing;
    await mkdir(this.directory,{recursive:true});
    try{await writeFile(this.filename(s.name),s.text,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
    await this.read(s.name,s.dataset);
    return {id:s.name,name:s.name,appProperties:{owner:'trim-billing-backup-v1',dataset:s.dataset,sha:s.sha,date:s.date}};
  }
  async prune(dataset,keep){
    const all=await this.list(dataset);if(!all.some(f=>f.appProperties.sha===keep))throw new Error('Verify the current backup before retention cleanup.');
    for(const f of all)if(f.appProperties.sha!==keep&&f.appProperties.date<cutoff())await unlink(this.filename(f.name));
  }
}
