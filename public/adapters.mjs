import {blankLedger,validateLedger,normalizeRoster,assertImmutable} from './core.mjs?v=20261030-workspace3';
const CLIENT='1078252705311-p24iq4gls53251o1o95hb2fbtb7uv53n.apps.googleusercontent.com';
const ROSTER='1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3';
const ACCOUNT_KEY='trim:drive-account';
export function preferredDriveAccount(){
  try{return globalThis.localStorage?.getItem(ACCOUNT_KEY)||'';}catch{return '';}
}
export class LocalAdapter {
  mode='local';label='Laptop Drive folder';
  async connect(){const r=await fetch('/api/connect',{method:'POST',headers:{'X-Trim-Local':'1'}});const j=await r.json();if(!r.ok)throw new Error(j.error);this.csrf=j.csrf;}
  async request(url,options={}){const r=await fetch(url,{...options,headers:{...options.headers,'X-Trim-Session':this.csrf}});const j=await r.json();if(!r.ok){const e=new Error(j.error);e.status=r.status;throw e;}return j;}
  roster(){return this.request('/api/roster');}
  load(){return this.request('/api/billing');}
  async verify(etag){const current=await this.load();if(current.etag!==etag){const e=new Error('Billing changed elsewhere. Reload and reconcile your saved draft.');e.status=409;throw e;}}
  save(ledger,etag){return this.request('/api/billing',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(ledger)});}
  restoreBackup(ledger,etag){return this.request('/api/billing/restore',{method:'POST',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(ledger)});}
}
export class DriveAdapter {
  mode='cloud';label='Google Drive';
  constructor(fileId,{rosterId=ROSTER}={}){this.fileId=fileId?.trim();this.rosterId=rosterId;if(this.fileId===ROSTER||this.fileId===rosterId)throw new Error('The original roster can never be used as the billing file.');}
  async connect({selectAccount=false,patientRecords=false}={}){
    if(!globalThis.google?.accounts?.oauth2) await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=resolve;s.onerror=()=>reject(new Error('Google sign-in could not load.'));document.head.append(s);});
    const previous=this.accountEmail;
    const hint=selectAccount?'':previous||preferredDriveAccount();
    const token=await new Promise((resolve,reject)=>google.accounts.oauth2.initTokenClient({
      client_id:CLIENT,scope:patientRecords?'https://www.googleapis.com/auth/drive':'https://www.googleapis.com/auth/drive.file',
      prompt:hint?'':'select_account',...(hint?{login_hint:hint}:{}),
      callback:r=>{if(r.error||!r.access_token)return reject(new Error(r.error||'Google did not return a connection.'));resolve(r.access_token);},
      error_callback:()=>reject(new Error('Google sign-in was cancelled or blocked. Try again, or choose “Use another account”.'))
    }).requestAccessToken());
    this.token=token;
    let email='';
    try{
      const about=await this.request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
      email=String(about.user?.emailAddress||'').trim();
    }catch{
      // Account metadata is optional on a first connection. On renewal, verify
      // the account before allowing any pending workspace writes.
    }
    if(previous&&previous.toLowerCase()!==email.toLowerCase()){
      this.token=null;
      throw new Error(email?'Google opened a different account. Reconnect with the account already used by this workspace. Your local changes are retained.':'Could not verify your Google account. Reconnect before saving; your local changes are retained.');
    }
    this.accountEmail=email;
  }
  rememberAccount(){
    // Call only after the roster and billing workspace have connected successfully.
    try{if(this.accountEmail)globalThis.localStorage?.setItem(ACCOUNT_KEY,this.accountEmail);else globalThis.localStorage?.removeItem(ACCOUNT_KEY);}catch{}
  }
  async request(url,options={}) {const r=await fetch(url,{...options,cache:'no-store',headers:{...options.headers,Authorization:`Bearer ${this.token}`}});if(!r.ok){const e=new Error(r.status===412?'Billing changed elsewhere. Reload and reconcile your saved draft.':r.status===401?'Google connection expired. Your draft stays on this device. Reconnect to save.':`Google Drive request failed (${r.status}).`);e.status=r.status===412?409:r.status;throw e;}return r.json();}
  async bytes(url){const r=await fetch(url,{cache:'no-store',headers:{Authorization:'Bearer '+this.token}});if(!r.ok)throw new Error('Drive source verification failed ('+r.status+').');return new Uint8Array(await r.arrayBuffer());}
  async roster(){return normalizeRoster(await this.request(`https://www.googleapis.com/drive/v3/files/${this.rosterId}?alt=media`));}
  async locate(){
    if(this.fileId)return;
    const q=encodeURIComponent("title = 'trim-billing-data-v1.json' and trashed = false");
    const result=await this.request(`https://www.googleapis.com/drive/v2/files?q=${q}&fields=items(id,title),nextPageToken`);
    if(!result.nextPageToken&&result.items?.length===0){const e=new Error('No billing file found. For first-time setup, create a private empty billing file below. If you have already entered billing elsewhere, stop and import it instead.');e.code='MISSING_BILLING';throw e;}
    if(result.nextPageToken||result.items?.length!==1)throw new Error('Provide the separate billing JSON file ID. Multiple accessible billing files were found; nothing was created or overwritten.');
    this.fileId=result.items[0].id;if(this.fileId===ROSTER||this.fileId===this.rosterId)throw new Error('Choose the billing file, not the roster.');
  }
  async createEmpty(){
    // Explicit first-time setup only. Verify roster access before any Drive write.
    await this.roster();
    try {await this.locate();return await this.load();}catch(e){if(e.code!=='MISSING_BILLING')throw e;}
    const key='trim-billing:pending-create-id';
    this.pendingCreateId ||= globalThis.localStorage?.getItem(key);
    if(!this.pendingCreateId){const ids=await this.request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');this.pendingCreateId=ids.ids?.[0];if(!this.pendingCreateId)throw new Error('Could not reserve a billing file ID.');globalThis.localStorage?.setItem(key,this.pendingCreateId);}
    const boundary=`trim_${crypto.randomUUID()}`;
    const metadata={id:this.pendingCreateId,name:'trim-billing-data-v1.json',mimeType:'application/json',description:'Private TRIM billing data. Do not share publicly.'};
    const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(blankLedger())}\r\n--${boundary}--`;
    try{await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});}
    catch(e){if(e.status!==409)throw e; /* same reserved ID already exists after an interrupted request */}
    this.fileId=this.pendingCreateId;
    const saved=await this.load();globalThis.localStorage?.removeItem(key);return saved;
  }
  async load(){
    await this.locate();
    // v2 exposes the resource ETag in JSON, avoiding reliance on exposed CORS headers.
    for(let attempt=0;attempt<2;attempt++) {
      const before=await this.request(`https://www.googleapis.com/drive/v2/files/${this.fileId}?fields=id,etag`);
      const ledger=validateLedger(await this.request(`https://www.googleapis.com/drive/v2/files/${this.fileId}?alt=media`));
      const after=await this.request(`https://www.googleapis.com/drive/v2/files/${this.fileId}?fields=id,etag`);
      if(before.etag&&before.etag===after.etag){this.current=structuredClone(ledger);return {ledger,etag:after.etag};}
    }
    throw new Error('Could not obtain a stable Drive revision. Saving is disabled.');
  }
  async verify(etag){if(!this.fileId||!etag)throw new Error('Connect a billing file first.');const meta=await this.request(`https://www.googleapis.com/drive/v2/files/${this.fileId}?fields=id,etag`);if(!meta.etag||meta.etag!==etag){const e=new Error('Billing changed elsewhere. Reload and reconcile your saved draft.');e.status=409;throw e;}}
  async save(ledger,etag){
    if(!this.fileId||this.fileId===ROSTER||this.fileId===this.rosterId||!etag||etag==='new')throw new Error('A separate billing file with a valid Drive revision is required.');
    validateLedger(ledger);assertImmutable(this.current,ledger);
    const next={...ledger,revision:this.current.revision+1,updatedAt:new Date().toISOString()};
    await this.request(`https://www.googleapis.com/upload/drive/v2/files/${this.fileId}?uploadType=media`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(next)});
    const verified=await this.load();if(JSON.stringify(verified.ledger)!==JSON.stringify(next)){const e=new Error('Drive read-back did not match. Stop editing and reconcile.');e.status=409;throw e;}return verified;
  }
  // Explicit full-file recovery only: the UI first verifies a safety backup and
  // obtains confirmation. Ordinary saves retain all assertImmutable checks.
  async restoreBackup(ledger,etag){
    validateLedger(ledger);
    if(!this.fileId||this.fileId===ROSTER||this.fileId===this.rosterId||!etag||ledger.datasetId!==this.current?.datasetId)throw new Error('Wrong recovery target.');
    const next={...ledger,revision:this.current.revision+1,updatedAt:new Date().toISOString()};
    await this.request(`https://www.googleapis.com/upload/drive/v2/files/${this.fileId}?uploadType=media`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(next)});
    const verified=await this.load();if(JSON.stringify(verified.ledger)!==JSON.stringify(next))throw new Error('Restored file could not be verified. Reload before further changes.');return verified;
  }
}
