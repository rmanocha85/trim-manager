import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {handler, APP_ORIGIN, REDIRECT} from '../drive-renewal/service.mjs';

test('hosted exchange, renewal, isolation, expiry, revocation and lock',async t=>{
  const records=new Map(), ownerEmail='doctor@example.test', binding=randomBytes(32).toString('base64url');
  let email=ownerEmail, issued=0, failure='', time=Date.now();
  const store={create:async(id,value)=>records.set(id,value),get:async id=>records.get(id),remove:async id=>records.delete(id),
    rotate:async(id,old,next)=>{assert.equal(records.get(id).refreshToken,old);records.get(id).refreshToken=next;}};
  const googleFetch=async(url,options)=>{
    if(url.includes('/about?'))return Response.json({user:{emailAddress:email}});
    if(failure) return Response.json({error:failure},{status:400});
    const first=options.body.get('grant_type')==='authorization_code';
    if(first){assert.equal(options.body.get('redirect_uri'),REDIRECT);assert.equal(options.body.get('code_verifier'),binding);}
    else assert.match(options.body.get('refresh_token'),/^private-/);
    return Response.json({access_token:'short-'+(++issued),expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file',refresh_token:'private-'+issued});
  };
  const server=createServer(handler({store,clientSecret:'test',ownerEmail,googleFetch,now:()=>time}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  let cookie='';
  const post=(path,extra={},body={})=>fetch(url+path,{method:'POST',headers:{Origin:APP_ORIGIN,Cookie:cookie,'X-TRIM-Binding':binding,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  const exchange=async()=>{const r=await post('/exchange',{},{code:'test-code',verifier:binding});assert.equal(r.status,200);
    const header=r.headers.get('set-cookie');assert.match(header,/Secure; HttpOnly; SameSite=None; Partitioned/);cookie=header.split(';')[0];
    const result=await r.json();assert.deepEqual(Object.keys(result).sort(),['access_token','email','expires_in']);assert.equal(result.email,ownerEmail);};
  assert.equal((await post('/exchange',{origin:'https://unrelated.example'})).status,403);
  assert.equal((await post('/renew')).status,401);
  email='other@example.test';assert.equal((await post('/exchange',{},{code:'x',verifier:binding})).status,403);assert.equal(records.size,0);
  email=ownerEmail;await exchange();const first=issued;
  assert.equal((await post('/renew',{'X-TRIM-Binding':randomBytes(32).toString('base64url')})).status,401);
  assert.equal(issued,first);assert.equal((await (await post('/renew')).json()).access_token,'short-'+(first+1));
  failure='temporarily_unavailable';assert.equal((await post('/renew')).status,503);assert.equal(records.size,1);
  failure='invalid_grant';assert.equal((await post('/renew')).status,401);assert.equal(records.size,0);
  failure='';await exchange();assert.equal((await post('/logout')).status,200);assert.equal((await post('/renew')).status,401);
  await exchange();time+=31*86400000;assert.equal((await post('/renew')).status,401);
});
