import {validateLedger} from './core.mjs?v=20261030-workspace3';

const API='https://www.googleapis.com/drive/v3/files';
const OWNER='trim-billing-backup-v1';
export async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function snapshot(ledger){
  validateLedger(ledger);
  const text=JSON.stringify(ledger),sha=await hash(text),dataset=await hash(ledger.datasetId);
  const date=ledger.updatedAt&&Number.isFinite(Date.parse(ledger.updatedAt))?new Date(ledger.updatedAt).toISOString():new Date().toISOString();
  return {text,sha,dataset,date,name:`TRIM-Billing_${date.replace(/:/g,'-')}_${dataset.slice(0,16)}_${sha}.json`};
}
export function cutoff(now=new Date()){
  const d=new Date(now),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-3);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString();
}
export function owned(file,dataset){return file.appProperties?.owner===OWNER&&file.appProperties?.dataset===dataset&&/^TRIM-Billing_.*_[a-f0-9]{64}\.json$/.test(file.name)&&file.name.endsWith(`_${file.appProperties.sha}.json`)&&Number.isFinite(Date.parse(file.appProperties.date));}
export async function validateSnapshot(text,dataset,sha){
  const l=validateLedger(JSON.parse(text));
  if(await hash(l.datasetId)!==dataset||sha&&await hash(text)!==sha)throw new Error('Backup identity or checksum does not match. Nothing restored.');return l;
}

export class LocalBackups {
  constructor(adapter){this.adapter=adapter;}
  list(dataset){return this.adapter.request('/api/backups?dataset='+encodeURIComponent(dataset));}
  async read(file){return (await this.adapter.request('/api/backups/file?name='+encodeURIComponent(file.name)+'&dataset='+encodeURIComponent(file.appProperties.dataset))).text;}
  ensure(value){return this.adapter.request('/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});}
  prune(dataset,keep){return this.adapter.request('/api/backups/prune',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataset,keep})});}
}

export class DriveBackups {
  constructor(adapter){this.adapter=adapter;}
  async request(url,options={}){
    const r=await fetch(url,{...options,signal:AbortSignal.timeout(30000),cache:'no-store',headers:{...options.headers,Authorization:`Bearer ${this.adapter.token}`}});
    if(!r.ok){const e=new Error(r.status===401?'Reconnect Google Drive, then retry backups.':`Backup request failed (${r.status}). Retry backups.`);e.status=r.status;throw e;}
    return r.status===204?null:r.json();
  }
  async listQuery(q){let files=[],pageToken;do{const r=await this.request(`${API}?q=${encodeURIComponent(q)}&pageSize=1000&fields=nextPageToken,files(id,name,appProperties,createdTime)${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}`);files.push(...(r.files||[]));pageToken=r.nextPageToken;}while(pageToken);return files;}
  async folder(parent,name){
    const found=await this.listQuery(`'${parent}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    if(found.length>1)throw new Error(`Multiple ${name} folders found. Backup folder needs review.`);
    return found[0]?.id||(await this.request(API+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[parent]})})).id;
  }
  async root(){
    if(this.rootId)return this.rootId;
    const existing=await this.listQuery(`trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='owner' and value='${OWNER}' } and appProperties has { key='source' and value='${this.adapter.fileId}' }`);
    if(existing.length){const id=existing.sort((a,b)=>a.id.localeCompare(b.id))[0].id;await this.assertPrivate(id);return this.rootId=id;}
    // Follow the billing file's actual parents; never assume a same-named public folder.
    let id=this.adapter.fileId;
    for(let depth=0;depth<8&&id;depth++){
      let f;try{f=await this.request(`${API}/${id}?fields=id,name,parents,permissions(role,type)`);}catch(e){if(e.status===404||e.status===403)break;throw e;}
      if(f.name==='TRIM AI'){
        if(!f.permissions?.length||f.permissions.some(p=>p.role!=='owner'))break;
        const target=await this.folder(await this.folder(id,'Backups'),'Billing');
        await this.assertPrivate(target);
        await this.request(`${API}/${target}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({appProperties:{owner:OWNER,source:this.adapter.fileId}})});return this.rootId=target;
      }
      id=f.parents?.length===1?f.parents[0]:null;
    }
    // drive.file can access app-created files but not necessarily their moved
    // parent folders. Use a private app-owned root folder without broader scopes.
    this.rootId=(await this.request(API+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'TRIM Billing Backups',mimeType:'application/vnd.google-apps.folder',appProperties:{owner:OWNER,source:this.adapter.fileId}})})).id;
    return this.rootId;
  }
  async assertPrivate(id){const f=await this.request(`${API}/${id}?fields=permissions(role,type)`);if(!f.permissions?.length||f.permissions.some(p=>p.role!=='owner'))throw new Error('Backup folder privacy needs review; billing saved, no backup uploaded.');}
  async list(dataset){
    const root=await this.root();
    // If two computers created folders simultaneously, read all app-owned roots.
    // Nothing is deleted or moved to reconcile these folders.
    const roots=await this.listQuery(`trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='owner' and value='${OWNER}' } and appProperties has { key='source' and value='${this.adapter.fileId}' }`);
    const files=[];for(const id of new Set([root,...roots.map(f=>f.id)]))files.push(...await this.listQuery(`'${id}' in parents and trashed = false`));
    return files.filter(f=>owned(f,dataset));
  }
  async read(f){
    const r=await fetch(`${API}/${f.id}?alt=media`,{cache:'no-store',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${this.adapter.token}`}});
    if(!r.ok)throw new Error('Could not read the backup. Retry backups.');const text=await r.text();await validateSnapshot(text,f.appProperties.dataset,f.appProperties.sha);return text;
  }
  async ensure(s){
    const existing=(await this.list(s.dataset)).find(f=>f.appProperties.sha===s.sha);
    if(existing){await this.read(existing);return existing;}
    const boundary='trim_backup_'+crypto.randomUUID();
    const metadata={name:s.name,mimeType:'application/json',parents:[await this.root()],appProperties:{owner:OWNER,dataset:s.dataset,sha:s.sha,date:s.date}};
    const body=`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${s.text}\r\n--${boundary}--`;
    const f=await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,appProperties,createdTime',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
    await this.read(f);return f;
  }
  async prune(dataset,keep,now=new Date()){
    for(const f of await this.list(dataset))if(f.appProperties.sha!==keep&&f.appProperties.date<cutoff(now)){
      // Only app-owned snapshots for this exact ledger, and recoverable Drive Trash.
      await this.request(`${API}/${f.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"trashed":true}'});
    }
  }
}

export async function writeLocal(directory,s){
  if(await directory.queryPermission({mode:'readwrite'})!=='granted')throw new Error('Allow laptop folder access to finish the independent backup.');
  let f;try{f=await directory.getFileHandle(s.name);const old=await (await f.getFile()).text();if(await hash(old)!==s.sha)throw new Error('Existing local backup differs. It has not been overwritten.');return;}catch(e){if(e.name!=='NotFoundError')throw e;}
  f=await directory.getFileHandle(s.name,{create:true});const stream=await f.createWritable();
  try{await stream.write(s.text);await stream.close();}catch(e){try{await stream.abort();}catch{}try{await directory.removeEntry(s.name);}catch{}throw e;}
  if(await hash(await (await f.getFile()).text())!==s.sha)throw new Error('Laptop backup verification failed. Retry backups.');
}
export async function pruneLocal(directory,dataset,keep,now=new Date()){
  const pattern=new RegExp(`^TRIM-Billing_(.+)_${dataset.slice(0,16)}_([a-f0-9]{64})\\.json$`);
  for await(const [name,handle] of directory.entries()){
    const m=name.match(pattern);if(!m||handle.kind!=='file'||m[2]===keep)continue;
    const date=m[1].replace(/T(\d{2})-(\d{2})-(\d{2})/,'T$1:$2:$3');
    if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString()>=cutoff(now))continue;
    // Verify identity and integrity before deleting any specifically named file.
    await validateSnapshot(await (await handle.getFile()).text(),dataset,m[2]);await directory.removeEntry(name);
  }
}

// Durable encrypted queue is separate from editing state. No network work in capture().
export class BackupManager {
  constructor({drive,load,save,directory,onStatus=()=>{}}){Object.assign(this,{drive,load,save,directory,onStatus});this.serial=Promise.resolve();this.running=false;this.stopped=false;this.localVerified=new Set();}
  async init(ledger){this.id=ledger.datasetId;this.dataset=await hash(this.id);this.key=this.id+':backup-queue';this.pending=(await this.load(this.key))?.pending||[];return this;}
  mutate(fn){const p=this.serial.then(async()=>{await fn();await this.save(this.key,{pending:this.pending});});this.serial=p.catch(()=>{});return p;}
  async capture(ledger){
    const s=await snapshot(ledger);if(s.dataset!==this.dataset)throw new Error('Wrong backup dataset.');
    await this.mutate(()=>{if(!this.pending.some(p=>p.sha===s.sha))this.pending.push(s);});
    this.kick();
  }
  kick(){if(this.stopped)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.run(),0);}
  stop(){this.stopped=true;clearTimeout(this.timer);}
  async run(){
    if(this.running||this.stopped)return;this.running=true;
    let success=false;
    try{
      this.onStatus('Backing up in background…');
      let latest;
      while(this.pending.length&&!this.stopped){
        const s=this.pending[0];await this.drive.ensure(s);latest=s;
        await this.mutate(()=>{this.pending=this.pending.filter(p=>p.sha!==s.sha);});
      }
      if(this.stopped)return;
      const all=(await this.drive.list(this.dataset)).sort((a,b)=>b.appProperties.date.localeCompare(a.appProperties.date));
      const keep=latest?.sha||all[0]?.appProperties.sha;
      if(!keep)throw new Error('No verified backup exists yet.');
      if(this.directory){
        if(await this.directory.queryPermission({mode:'readwrite'})!=='granted')throw new Error('Allow laptop folder access to finish the independent backup.');
        for(const f of all){if(this.stopped)return;if(f.appProperties.date<cutoff()&&f.appProperties.sha!==keep)continue;
          if(this.localVerified.has(f.appProperties.sha))continue;
          // Skip already verified local files without downloading the cloud body again.
          try{const h=await this.directory.getFileHandle(f.name);if(await hash(await (await h.getFile()).text())===f.appProperties.sha){this.localVerified.add(f.appProperties.sha);continue;}}catch(e){if(e.name!=='NotFoundError')throw e;}
          const text=await this.drive.read(f);await writeLocal(this.directory,{name:f.name,text,sha:f.appProperties.sha});this.localVerified.add(f.appProperties.sha);
        }
        await pruneLocal(this.directory,this.dataset,keep);
      }
      if(this.stopped)return;
      await this.drive.prune(this.dataset,keep);
      this.onStatus(this.directory?'Drive + laptop backups verified':'Drive backup verified · Laptop backup not enabled here');
      success=true;
    }catch(e){this.onStatus('Backup needs attention: '+e.message,true);}
    finally{this.running=false;if(success&&this.pending.length&&!this.stopped)this.kick();}
  }
}
