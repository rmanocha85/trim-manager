import {blankLedger,validateLedger,normalizeRoster,assertImmutable} from './core.mjs?v=20261031-compact1';
import {hostedBilling,HostedBillingAccess} from './hosted-billing-access.mjs';
const CLIENT='1078252705311-p24iq4gls53251o1o95hb2fbtb7uv53n.apps.googleusercontent.com';
const ROSTER='1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3';
const ACCOUNT_KEY='trim:drive-account';
export function preferredDriveAccount(){
  try{return globalThis.localStorage?.getItem(ACCOUNT_KEY)||'';}catch{return '';}
}
export class LocalAdapter {
  mode='local';label='Laptop Drive folder';
  async ensureConnected(){if(!this.csrf)await this.connect();}
  async connect(){const r=await fetch('/api/connect',{method:'POST',headers:{'X-Trim-Local':'1'}});const j=await r.json();if(!r.ok)throw new Error(j.error);this.csrf=j.csrf;}
  async request(url,options={}){const r=await fetch(url,{...options,headers:{...options.headers,'X-Trim-Session':this.csrf}});const j=await r.json();if(!r.ok){if(r.status===401)this.csrf=null;const e=new Error(j.error);e.status=r.status;throw e;}return j;}
  roster(){return this.request('/api/roster');}
  load(){return this.request('/api/billing');}
  async verify(etag){const current=await this.load();if(current.etag!==etag){const e=new Error('Billing changed elsewhere. Reload and reconcile your saved draft.');e.status=409;throw e;}}
  save(ledger,etag){return this.request('/api/billing',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(ledger)});}
  restoreBackup(ledger,etag){return this.request('/api/billing/restore',{method:'POST',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(ledger)});}
}
export class DriveAdapter {
  mode='cloud';label='Google Drive';
  constructor(fileId,{rosterId=ROSTER}={}){this.fileId=fileId?.trim();this.rosterId=rosterId;if(this.fileId===ROSTER||this.fileId===rosterId)throw new Error('The original roster can never be used as the billing file.');}
  connect(options={}){
    if(this.connecting)return this.connecting;
    const pending=this.connectToken(options);this.connecting=pending;
    return pending.finally(()=>{if(this.connecting===pending)this.connecting=null;});
  }
  needsRenewal(){return !this.token||this.authExpired||Boolean(this.expiresAt&&Date.now()>=this.expiresAt-60000);}
  async ensureConnected(){if(this.connecting)await this.connecting;else if(this.needsRenewal())await this.connect();}
  async connectToken({selectAccount=false,patientRecords=this.patientRecords||false,interactive=true}={}){
    if (!patientRecords && hostedBilling()) {
      this.hostedAccess ??= new HostedBillingAccess();
      let token;
      if (selectAccount || !this.hostedAccess.saved) {
        if (!interactive) throw Object.assign(Error('Connect your TRIM billing account again.'), {status:401});
        token = await this.hostedAccess.authorize({hint:this.accountEmail || preferredDriveAccount(),selectAccount});
      } else {
        token = await this.hostedAccess.renew();
      }
      if (this.accountEmail && this.accountEmail.toLowerCase() !== token.email.toLowerCase()) {
        throw Error('Google opened a different billing account. Your local changes are retained.');
      }
      this.accountEmail = token.email;
      this.token = token.access_token;
      this.expiresAt = Date.now() + token.expires_in * 1000;
      this.authExpired = false;
      return;
    }
    if(!globalThis.google?.accounts?.oauth2) await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=resolve;s.onerror=()=>reject(new Error('Google sign-in could not load.'));document.head.append(s);});
    const previous=this.accountEmail;
    const hint=selectAccount?'':previous||preferredDriveAccount();
    const token=await new Promise((resolve,reject)=>google.accounts.oauth2.initTokenClient({
      client_id:CLIENT,scope:patientRecords?'https://www.googleapis.com/auth/drive':'https://www.googleapis.com/auth/drive.file',
      prompt:hint?'':'select_account',...(hint?{login_hint:hint}:{}),
      callback:r=>{if(r.error||!r.access_token)return reject(new Error(r.error||'Google did not return a connection.'));resolve(r);},
      error_callback:()=>reject(new Error('Google sign-in was cancelled or blocked. Try again, or choose “Use another account”.'))
    }).requestAccessToken());
    let email='';
    try{
      const about=await (await this.response('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{},token.access_token)).json();
      email=String(about.user?.emailAddress||'').trim();
    }catch{
      // Account metadata is optional on a first connection. On renewal, verify
      // the account before allowing any pending workspace writes.
    }
    if(previous&&previous.toLowerCase()!==email.toLowerCase()){
      this.token=null;
      throw new Error(email?'Google opened a different account. Reconnect with the account already used by this workspace. Your local changes are retained.':'Could not verify your Google account. Reconnect before saving; your local changes are retained.');
    }
    this.token=token.access_token;this.expiresAt=Number(token.expires_in)>0?Date.now()+Number(token.expires_in)*1000:null;this.authExpired=false;this.patientRecords=patientRecords;
    this.accountEmail=email;
  }
  rememberAccount(){
    // Call only after the roster and billing workspace have connected successfully.
    try{if(this.accountEmail)globalThis.localStorage?.setItem(ACCOUNT_KEY,this.accountEmail);else globalThis.localStorage?.removeItem(ACCOUNT_KEY);}catch{}
  }
  async response(url,options={},accessToken){
    if (accessToken === undefined && this.hostedAccess) {
      if (this.needsRenewal()) {
        // Background reads may renew a session, but only a user action may open consent.
        if (!this.hostedAccess.saved) throw Object.assign(Error('Click Save or Refresh to reconnect Google.'),{status:401});
        await this.ensureConnected();
      }
      const used = this.token;
      try { return await this.fetchResponse(url,options,used); }
      catch (error) {
        const read = ['GET','HEAD'].includes((options.method || 'GET').toUpperCase());
        if (error.status !== 401 || !read || !this.hostedAccess.saved) throw error;
        if (this.token === used) await this.ensureConnected();
        return this.fetchResponse(url,options,this.token);
      }
    }
    return this.fetchResponse(url,options,accessToken ?? this.token);
  }
  async fetchResponse(url,options,accessToken){
    // Retry reads only. An interrupted write may already have succeeded.
    const read=['GET','HEAD'].includes((options.method||'GET').toUpperCase());
    for(let attempt=0;attempt<(read?2:1);attempt++){
      let r;
      try{r=await fetch(url,{...options,cache:'no-store',headers:{...options.headers,Authorization:`Bearer ${accessToken}`}});}
      catch(error){if(error.name==='AbortError')throw error;if(read&&attempt===0&&globalThis.navigator?.onLine!==false){await new Promise(resolve=>setTimeout(resolve,250));continue;}throw Object.assign(new Error('Drive is temporarily unreachable. Your work is retained. Retry when the connection returns.'),{code:'NETWORK'});}
      if(r.ok)return r;
      if(read&&attempt===0&&[429,500,502,503,504].includes(r.status)){await new Promise(resolve=>setTimeout(resolve,250));continue;}
      if(r.status===401&&accessToken===this.token)this.authExpired=true;
      const e=new Error(r.status===412?'Drive changed elsewhere. Reload and reconcile your saved draft.':r.status===401?'Google access expired. Click Save or Refresh from Drive to renew it. Your draft stays on this device.':r.status===403?'Google Drive access denied. Check this account’s file permission.':`Google Drive request failed (${r.status}). Retry without signing in again.`);e.status=r.status===412?409:r.status;throw e;
    }
  }
  async request(url,options={}){return (await this.response(url,options)).json();}
  async bytes(url){return new Uint8Array(await (await this.response(url)).arrayBuffer());}
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
