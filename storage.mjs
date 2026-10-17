import {readFile,writeFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {blankLedger,validateLedger,assertImmutable} from './public/core.mjs';
export const digest = data => createHash('sha256').update(data).digest('hex');
export class Conflict extends Error {constructor(message='Billing changed elsewhere. Your draft is safe; reload and reconcile before saving.') {super(message);this.status=409;}}
export class BillingStore {
  constructor(path,lockPath,writerId){this.path=path;this.lockPath=lockPath;this.writerId=writerId;this.initial=blankLedger(digest(path).slice(0,32));}
  async load(){try {const raw=await readFile(this.path,'utf8');return {ledger:validateLedger(JSON.parse(raw)),etag:digest(raw)};}catch(e){if(e.code==='ENOENT')return {ledger:structuredClone(this.initial),etag:'new'};throw e;}}
  async save(next,expected,{restore=false}={}){
    validateLedger(next);await mkdir(dirname(this.lockPath),{recursive:true});
    let lock;try{lock=await open(this.lockPath,'wx');}catch(e){if(e.code==='EEXIST')throw new Conflict('Another save is running, or a previous process stopped during saving. Retry; if this persists, close the app and inspect its local lock.');throw e;}
    const temp=`${this.path}.${randomUUID()}.tmp`;
    try {
      const current=await this.load();if(current.etag!==expected)throw new Conflict();
      if(current.ledger.localWriter&&current.ledger.localWriter!==this.writerId) throw new Conflict('This file belongs to another local preview computer. Do not use two Drive-sync previews to edit it. Use verified cloud mode instead.');
      if(restore){if(next.datasetId!==current.ledger.datasetId)throw new Error('Wrong recovery dataset.');}else assertImmutable(current.ledger,next);
      const ledger={...next,revision:current.ledger.revision+1,localWriter:this.writerId,updatedAt:new Date().toISOString()};
      const raw=JSON.stringify(ledger,null,2);await mkdir(dirname(this.path),{recursive:true});
      const f=await open(temp,'wx');try{await f.writeFile(raw);await f.sync();}finally{await f.close();}
      const recheck=await this.load();if(recheck.etag!==current.etag)throw new Conflict();
      await rename(temp,this.path);
      const verified=await this.load();if(verified.etag!==digest(raw))throw new Conflict('Read-back differs from saved data. Stop editing and reconcile.');
      return verified;
    } finally {await unlink(temp).catch(()=>{});await lock.close();await unlink(this.lockPath).catch(()=>{});}
  }
}
