import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {ChatGPTConnection,ProtectedAuthStore,readCompletedStream} from '../notes-auth.mjs';
const metadata={issuer:'https://auth.openai.com',authorization_endpoint:'https://auth.openai.com/api/accounts/authorize',token_endpoint:'https://auth.openai.com/api/accounts/oauth/token',jwks_uri:'https://auth.openai.com/.well-known/jwks.json',revocation_endpoint:'https://auth.openai.com/revoke'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function store(initial=null){let data=initial;return {load:async()=>structuredClone(data),save:async v=>{data=structuredClone(v);},get:()=>data};}
const signedIn=()=>({hostId:'urn:uuid:test',clientId:'issued',subject:'one',accessToken:'access',refreshToken:'refresh',scopes:['chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000});
function stream(events,crlf=false){const text=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('').replace(/\n/g,crlf?'\r\n':'\n');return new ReadableStream({start(c){for(const char of text)c.enqueue(new TextEncoder().encode(char));c.close();}});}
test('SIWC uses loopback PKCE state nonce and issued client, never browser credentials',async()=>{
  const saved=store(),requests=[];const connection=new ChatGPTConnection({store:saved,fetchImpl:async(url,o)=>{requests.push([url,o]);return response(o?{id_token:'id',access_token:'access',refresh_token:'refresh',scope:'openid chatgpt.tokens.use.direct',expires_in:3600}:metadata);},verifyToken:async(token,id,nonce)=>{assert.equal(token,'id');assert.equal(id,'issued');assert.ok(nonce);return {sub:'one',email:'synthetic@example.invalid'};}});
  const {url}=await connection.begin('http://127.0.0.1:4317'),u=new URL(url);assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(u.searchParams.get('redirect_uri'),'http://127.0.0.1:4317/auth/callback');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  await assert.rejects(connection.callback(new URLSearchParams({state:'wrong',code:'test',client_id:'issued'})),/match/);
  await connection.callback(new URLSearchParams({state:u.searchParams.get('state'),code:'test',client_id:'issued'}));assert.equal(saved.get().clientId,'issued');assert.equal((await connection.status()).planEnabled,true);assert.ok(!JSON.stringify(await connection.status()).includes('refreshToken'));assert.equal(requests[1][1].body.get('resource'),'https://api.openai.com/v1');
});
test('SIWC identity validation failure and unexpected client never save tokens',async()=>{
  const saved=store();const connection=new ChatGPTConnection({store:saved,fetchImpl:async(url,o)=>response(o?{id_token:'bad',access_token:'access',refresh_token:'refresh'}:metadata),verifyToken:async()=>{throw new Error('Wrong nonce');}});const u=new URL((await connection.begin('http://127.0.0.1:4317')).url);await assert.rejects(connection.callback(new URLSearchParams({state:u.searchParams.get('state'),code:'code',client_id:'issued'})),/nonce/);assert.ok(!saved.get().accessToken);
});
test('refresh is serialized and rotates credentials, terminal failure clears but transient retains',async()=>{
  for(const mode of ['success','terminal','transient']){const initial={...signedIn(),expiresAt:0},saved=store(initial);let calls=0;const c=new ChatGPTConnection({store:saved,fetchImpl:async(url,o)=>{if(!o)return response(metadata);calls++;await new Promise(r=>setTimeout(r,10));return mode==='success'?response({access_token:'next',refresh_token:'rotated',expires_in:3600}):response({error:mode==='terminal'?'invalid_grant':'temporarily_unavailable'},mode==='terminal'?400:503);}});const results=await Promise.allSettled([c.access(),c.access()]);assert.equal(calls,1);if(mode==='success'){assert.equal(results[0].value,'next');assert.equal(saved.get().refreshToken,'rotated');}else{assert.equal(results[0].status,'rejected');assert.equal(Boolean(saved.get().accessToken),mode==='transient');}}
});
test('identity-only sign-in is insufficient for inference; model catalog uses SIWC format',async()=>{
  const c=new ChatGPTConnection({store:store({...signedIn(),scopes:['openid']}),fetchImpl:async()=>{throw new Error('Unexpected network call');}});await assert.rejects(c.models(),/authorize/);assert.equal((await c.status()).planEnabled,false);
  const active=new ChatGPTConnection({store:store(signedIn()),fetchImpl:async()=>response({models:[{visibility:'hidden',slug:'hidden',display_name:'Hidden'},{visibility:'list',slug:'chosen',display_name:'Chosen'}]})});assert.deepEqual(await active.models(),[{id:'chosen',name:'Chosen'}]);
});
test('SSE requires completion, rejects late quota errors and handles split CRLF',async()=>{
  const delta={type:'response.output_text.delta',delta:'abc'},completed={type:'response.completed',response:{status:'completed'}};
  assert.equal(await readCompletedStream(stream([delta,completed],true)),'abc');await assert.rejects(readCompletedStream(stream([delta])),/before completion/);await assert.rejects(readCompletedStream(stream([delta,completed,{type:'error',error:{code:'usage_limit_reached'}}])),/usage limit/);await assert.rejects(readCompletedStream(stream([{type:'response.incomplete'}])),/failed/);
});
test('generation sends only supported Responses fields; unfinished output does not succeed',async()=>{
  let sent;const text=JSON.stringify({assessment:'Routine note',summaryMarkdown:'Summary'}),c=new ChatGPTConnection({store:store(signedIn()),fetchImpl:async(url,o)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(o.body);return new Response(stream([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed'}}]));}});assert.equal((await c.generate({model:'chosen',context:{today:{input:'Synthetic'}}})).assessment,'Routine note');assert.deepEqual(Object.keys(sent).sort(),['input','instructions','model','store','stream']);assert.equal(sent.store,false);assert.equal(sent.stream,true);
});
test('real JWT validation rejects wrong nonce, audience, issuer and expired identity',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey),c=new ChatGPTConnection({store:store(),fetchImpl:async()=>response(metadata)});c.jwks=createLocalJWKSet({keys:[{...jwk,kid:'synthetic',alg:'RS256'}]});
  const token=({nonce='nonce',aud='issued',issuer=metadata.issuer,expiry='5m'}={})=>new SignJWT({sub:'synthetic',nonce}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  assert.equal((await c.validateJWT(await token(),'issued','nonce')).sub,'synthetic');for(const change of [{nonce:'wrong'},{aud:'wrong'},{issuer:'https://example.invalid'},{expiry:'-1m'}])await assert.rejects(c.validateJWT(await token(change),'issued','nonce'));
});
test('Windows credential store encrypts synthetic tokens and reads them back',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'trim-auth-test-'));try{const s=new ProtectedAuthStore(dir),data={accessToken:'SYNTHETIC-SECRET',hostId:'synthetic'};await s.save(data);assert.deepEqual(await s.load(),data);if(process.platform==='win32')assert.ok(!(await readFile(s.file,'utf8')).includes(data.accessToken));}finally{await rm(dir,{recursive:true,force:true});}
});
