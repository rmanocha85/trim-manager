import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveAdapter} from '../public/adapters.mjs';
test('Drive retries a temporary read without sign-in and never retries an ambiguous write',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
 globalThis.fetch=async()=>{calls++;if(calls===1)throw new TypeError('network');return new Response('{"ok":true}');};
 const a=new DriveAdapter('synthetic');a.token='test';
 assert.deepEqual(await a.request('https://www.googleapis.com/test'),{ok:true});assert.equal(calls,2);assert.ok(!a.authExpired);
 calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('network');};
 await assert.rejects(()=>a.request('https://www.googleapis.com/test',{method:'PUT'}),/temporarily unreachable/);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('expiry and permission errors stay distinct; only known expiry renews access, retaining account/scope',async()=>{
 const oldFetch=globalThis.fetch,oldGoogle=globalThis.google;let prompts=0,config,fail=0;
 try{
 const a=new DriveAdapter('synthetic');a.token='valid';a.accountEmail='sample@example.test';a.patientRecords=true;
 globalThis.google={accounts:{oauth2:{initTokenClient:c=>{config=c;return {requestAccessToken:()=>{prompts++;setTimeout(()=>c.callback({access_token:'renewed',expires_in:3600}),0);}};}}}};
 globalThis.fetch=async()=>fail?new Response('{}',{status:fail}):new Response('{"user":{"emailAddress":"sample@example.test"}}');
 await a.ensureConnected();assert.equal(prompts,0);
 fail=403;await assert.rejects(()=>a.request('url'),e=>e.status===403);await a.ensureConnected();assert.equal(prompts,0);
 fail=401;await assert.rejects(()=>a.bytes('url'),e=>e.status===401);assert.equal(a.needsRenewal(),true);
 fail=0;await Promise.all([a.ensureConnected(),a.ensureConnected()]);assert.equal(prompts,1);assert.equal(config.scope,'https://www.googleapis.com/auth/drive');assert.equal(config.login_hint,'sample@example.test');assert.equal(config.prompt,'');assert.equal(a.needsRenewal(),false);assert.ok(a.expiresAt>Date.now());
 a.expiresAt=Date.now()+30000;await a.ensureConnected();assert.equal(prompts,2);
 a.expiresAt=1;globalThis.fetch=async()=>new Response('{"user":{"emailAddress":"wrong@example.test"}}');await assert.rejects(()=>a.ensureConnected(),/different account/);assert.equal(a.token,null);
 }finally{globalThis.fetch=oldFetch;globalThis.google=oldGoogle;}
});
