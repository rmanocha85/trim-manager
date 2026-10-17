import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {NOTE_INSTRUCTIONS,parseGenerated} from './public/notes-core.mjs';
const AUTH='https://auth.openai.com',API='https://api.openai.com/v1';
const scope='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const opaque=()=>randomBytes(32).toString('base64url');
const terminalRefresh=new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
export function apiError(status,body){
  const code=String(body?.error?.code||body?.error?.type||body?.error||body?.detail?.code||'request_failed').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,90);
  const message=code.includes('usage_limit')?'ChatGPT plan usage limit reached. Open Manage usage; your notes are retained.':code.includes('not_eligible')||code.includes('usage_unavailable')?'ChatGPT plan use is unavailable for this account or application. No API billing has been enabled.':`ChatGPT request failed (${status}, ${code}). Your existing notes are retained.`;
  return Object.assign(new Error(message),{status:status>=400&&status<=599?status:502,code});
}
function dpapi(text,decrypt=false){return new Promise((resolve,reject)=>{
  const script=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',v=>out+=v);p.stderr.resume();p.on('error',()=>reject(new Error('Windows credential protection unavailable.')));p.on('close',code=>code?reject(new Error('Windows credential protection failed.')):resolve(out.trim()));p.stdin.end(text);
});}
export class ProtectedAuthStore{
  constructor(directory=path.join(process.env.LOCALAPPDATA||os.homedir(),'TRIMNotes','auth')){this.directory=directory;this.file=path.join(directory,'chatgpt.credentials');}
  async load(){try{const raw=await readFile(this.file,'utf8');return JSON.parse(process.platform==='win32'?Buffer.from(await dpapi(raw,true),'base64').toString('utf8'):raw);}catch(e){if(e.code==='ENOENT')return null;throw new Error('Saved ChatGPT connection could not be opened.');}}
  async save(value){await mkdir(this.directory,{recursive:true,mode:0o700});const raw=JSON.stringify(value),protectedValue=process.platform==='win32'?await dpapi(Buffer.from(raw).toString('base64')):raw;const temp=this.file+'.'+randomUUID()+'.tmp';await writeFile(temp,protectedValue,{mode:0o600});await rename(temp,this.file);}
}
export class ChatGPTConnection{
  constructor({store=new ProtectedAuthStore(),fetchImpl=fetch,verifyToken=null}={}){Object.assign(this,{store,fetch:fetchImpl,verifyToken});this.pending=null;this.refreshing=null;this.lastError=null;this.aborters=new Set();}
  async load(){if(!this.state){this.loading||=this.store.load().then(s=>this.state=s||{hostId:'urn:uuid:'+randomUUID()}).finally(()=>{this.loading=null;});await this.loading;}return this.state;}
  async discovery(){if(!this.metadata){const r=await this.fetch(AUTH+'/.well-known/openid-configuration');if(!r.ok)throw new Error('ChatGPT sign-in discovery is unavailable.');const m=await r.json();if(m.issuer!==AUTH)throw new Error('Unexpected ChatGPT identity provider.');for(const k of ['authorization_endpoint','token_endpoint','jwks_uri'])if(new URL(m[k]).origin!==AUTH)throw new Error('Unexpected ChatGPT authentication endpoint.');this.metadata=m;}return this.metadata;}
  async status(){const s=await this.load();return {connected:Boolean(s.accessToken),planEnabled:Boolean(s.accessToken&&s.scopes?.includes('chatgpt.tokens.use.direct')),email:s.email||'',pending:Boolean(this.pending||this.signingIn),error:this.lastError};}
  async begin(origin){
    if(this.signingIn)throw new Error('The current ChatGPT sign-in is completing.');
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Open the app using its 127.0.0.1 shortcut to connect ChatGPT.');
    const s=await this.load(),m=await this.discovery();await this.store.save(s);
    const pending={state:opaque(),nonce:opaque(),verifier:opaque(),redirect:origin+'/auth/callback',createdAt:Date.now(),clientId:s.clientId||null,subject:s.subject||null};this.pending=pending;this.lastError=null;
    const u=new URL(m.authorization_endpoint),q={client_id:s.clientId||'dynamic_agent_client',ext_agent_host_id:s.hostId,response_type:'code',redirect_uri:pending.redirect,scope,resource:API,state:pending.state,nonce:pending.nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(pending.verifier).digest('base64url')};
    if(!s.clientId)q.agent_name_hint='TRIM Billing and Notes';if(s.email)q.login_hint=s.email;
    for(const [k,v]of Object.entries(q))u.searchParams.set(k,v);return {url:u.href};
  }
  async callback(params){
    const p=this.pending;if(!p||Date.now()-p.createdAt>600000||params.get('state')!==p.state)throw new Error('Sign-in expired or did not match this app. Start again.');this.pending=null;
    const complete=async()=>{
    try{
      if(params.has('error'))throw new Error('ChatGPT sign-in was declined or is unavailable.');
      const id=params.get('client_id')||p.clientId;if(!id||id==='dynamic_agent_client'||(p.clientId&&id!==p.clientId)||!params.get('code'))throw new Error('ChatGPT registration did not return the expected client.');
      const m=await this.discovery(),r=await this.fetch(m.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:id,code:params.get('code'),code_verifier:p.verifier,redirect_uri:p.redirect,resource:API})});
      const tokens=await r.json();if(!r.ok)throw apiError(r.status,tokens);
      const claims=this.verifyToken?await this.verifyToken(tokens.id_token,id,p.nonce):await this.validateJWT(tokens.id_token,id,p.nonce);
      if(p.subject&&claims.sub!==p.subject)throw new Error('This sign-in belongs to another account. Existing credentials were preserved.');
      if(!tokens.access_token||!tokens.refresh_token)throw new Error('ChatGPT did not return a renewable connection.');
      const next={...await this.load(),clientId:id,subject:claims.sub,email:claims.email||'',accessToken:tokens.access_token,refreshToken:tokens.refresh_token,scopes:String(tokens.scope||'').split(' '),expiresAt:Date.now()+Number(tokens.expires_in||3600)*1000};
      await this.store.save(next);this.state=next;this.lastError=null;return this.status();
    }catch(e){this.lastError=e.message;throw e;}
    };this.signingIn=complete().finally(()=>{this.signingIn=null;});return this.signingIn;
  }
  async validateJWT(token,id,nonce){const m=await this.discovery();this.jwks||=createRemoteJWKSet(new URL(m.jwks_uri));const {payload}=await jwtVerify(token,this.jwks,{issuer:m.issuer,audience:id,requiredClaims:['sub','exp','iat'],clockTolerance:5,algorithms:['RS256','PS256','ES256']});if(payload.nonce!==nonce||typeof payload.sub!=='string'||!payload.sub)throw new Error('ChatGPT identity validation failed.');return payload;}
  async access(){
    const s=await this.load();if(!s.accessToken||!s.scopes?.includes('chatgpt.tokens.use.direct'))throw new Error('Connect ChatGPT and authorize plan usage first.');
    if(s.expiresAt>Date.now()+60000)return s.accessToken;
    if(!this.refreshing)this.refreshing=this.refresh().finally(()=>{this.refreshing=null;});return this.refreshing;
  }
  async refresh(){
    const s=await this.load(),m=await this.discovery(),r=await this.fetch(m.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:s.clientId,refresh_token:s.refreshToken,resource:API})});const t=await r.json();
    if(!r.ok){const e=apiError(r.status,t);if(terminalRefresh.has(e.code)){const next={...s};delete next.accessToken;delete next.refreshToken;await this.store.save(next);this.state=next;}throw e;}
    if(!t.access_token||!t.refresh_token)throw new Error('ChatGPT renewal was incomplete. Reconnect.');
    const next={...s,accessToken:t.access_token,refreshToken:t.refresh_token,scopes:t.scope?String(t.scope).split(' '):s.scopes,expiresAt:Date.now()+Number(t.expires_in||3600)*1000};await this.store.save(next);this.state=next;
    if(!next.scopes.includes('chatgpt.tokens.use.direct'))throw new Error('ChatGPT plan permission is no longer enabled.');return next.accessToken;
  }
  async logout(){this.pending=null;if(this.signingIn)await this.signingIn.catch(()=>{});if(this.refreshing)await this.refreshing.catch(()=>{});for(const controller of this.aborters)controller.abort();const s=await this.load();let revoked=false;
    try{const m=await this.discovery();if(s.refreshToken&&m.revocation_endpoint&&new URL(m.revocation_endpoint).origin===AUTH){const r=await this.fetch(m.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:s.refreshToken,token_type_hint:'refresh_token',client_id:s.clientId})});revoked=r.ok;}}catch{}
    const next={...s};delete next.accessToken;delete next.refreshToken;delete next.expiresAt;await this.store.save(next);this.state=next;this.pending=null;this.lastError=null;return {revoked,message:revoked?'Disconnected from ChatGPT.':'Disconnected locally. Remote revocation was not confirmed; manage the connection in ChatGPT settings.'};
  }
  async models(){const token=await this.access(),r=await this.fetch(API+'/models',{headers:{Authorization:'Bearer '+token}}),body=await r.json();if(!r.ok)throw apiError(r.status,body);if(!Array.isArray(body.models))throw new Error('ChatGPT returned an unsupported model catalog.');return body.models.filter(m=>m.visibility==='list'&&m.slug&&m.display_name).map(m=>({id:m.slug,name:m.display_name}));}
  async generate({model,context,images=[]}){
    if(!model||!context||images.length>6)throw new Error('Choose a model and valid visit input.');
    const token=await this.access(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);this.aborters.add(controller);
    try{
      const content=[{type:'input_text',text:JSON.stringify(context)}];
      for(const image of images){if(typeof image!=='string'||image.length>3000000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))throw new Error('Unsupported source image.');content.push({type:'input_image',image_url:image});}
      const r=await this.fetch(API+'/responses',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:NOTE_INSTRUCTIONS,input:[{role:'user',content}],store:false,stream:true})});
      if(!r.ok){let b={};try{b=await r.json();}catch{}throw apiError(r.status,b);}
      return parseGenerated(await readCompletedStream(r.body));
    }finally{clearTimeout(timer);this.aborters.delete(controller);}
  }
}
export async function readCompletedStream(body){
  let buffer='',text='',complete=false;const decoder=new TextDecoder();
  function event(block){const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')return;let e;try{e=JSON.parse(data);}catch{throw new Error('Malformed AI stream.');}
    if(e.type==='response.output_text.delta')text+=e.delta||'';
    if(e.type==='response.completed'){if(e.response?.status&&e.response.status!=='completed')throw new Error('AI response was incomplete.');complete=true;const full=e.response?.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');if(full)text=full;}
    if(['response.failed','response.incomplete','error'].includes(e.type))throw apiError(502,e.response||e);
  }
  for await(const chunk of body){buffer=(buffer+decoder.decode(chunk,{stream:true})).replace(/\r\n/g,'\n');let split;while((split=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,split));buffer=buffer.slice(split+2);}if(text.length>100000||buffer.length>2000000)throw new Error('AI response exceeded the note limit.');}
  buffer+=decoder.decode();if(buffer.trim())event(buffer);if(!complete)throw new Error('AI connection ended before completion. Your existing note is unchanged.');return text;
}
