import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {OatStore} from '../oat-storage.mjs';
import {OatRepository} from '../public/oat-roster-repository.mjs';
const sample=()=>({schemaVersion:1,clinic:'oat-fh',patients:[{id:'two',name:'Zulu Synthetic',ava:'123457',phn:'0000000002',status:'active'},{id:'one',name:'Alpha Synthetic',ava:'123456',phn:'0000000001',status:'active'}]});
test('OAT local reader preserves the file and supplied order; corrupt or wrong-clinic data fails closed',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'oat-store-'));
  try{
    const file=path.join(dir,'oat.json'),original=JSON.stringify(sample());await writeFile(file,original);
    const store=new OatStore(file),loaded=await store.load();assert.deepEqual(loaded.roster,sample());assert.ok(loaded.etag);
    const repo=new OatRepository({mode:'local',request:async url=>{assert.equal(url,'/api/oat-fh/roster');return store.load();}});
    assert.deepEqual((await repo.load()).roster.patients.map(p=>p.ava),['123457','123456']);assert.equal(await readFile(file,'utf8'),original);
    await writeFile(file,JSON.stringify({...sample(),clinic:'maid'}));await assert.rejects(()=>store.load(),/not the OAT/);
    await writeFile(file,'broken');await assert.rejects(()=>store.load());assert.equal(await readFile(file,'utf8'),'broken');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('OAT cloud lookup is scoped to its canonical folder and only reads a stable revision',async()=>{
  let metadata=0;const calls=[];
  const repo=new OatRepository({mode:'cloud',request:async(url,options)=>{
    calls.push(url);assert.equal(options,undefined);
    if(url.includes('?q=')){const q=new URL(url).searchParams.get('q');assert.match(q,/'1d90SEhco30YL0AAE20gt11pzFBjOOJUn' in parents/);assert.match(q,/title = 'oat-fh-roster.json'/);return {items:[{id:'synthetic-oat'}]};}
    assert.match(url,/\/synthetic-oat\?/);
    if(url.includes('alt=media'))return sample();
    return {etag:++metadata===1?'old':'current'};
  }});
  assert.equal((await repo.load()).etag,'current');assert.equal(metadata,4);assert.equal(calls.filter(u=>u.includes('?q=')).length,1);
});
test('missing, duplicate, inaccessible or changing OAT cloud rosters never become an empty list',async()=>{
  for(const listing of [{items:[]},{items:[{id:'a'},{id:'b'}]},{items:[{id:'a'}],nextPageToken:'more'}]){
    await assert.rejects(()=>new OatRepository({mode:'cloud',request:async()=>listing}).load(),/one accessible/);
  }
  await assert.rejects(()=>new OatRepository({mode:'cloud',request:async()=>{throw Object.assign(new Error('denied'),{status:403});}}).load(),e=>e.status===403);
  let version=0;await assert.rejects(()=>new OatRepository({mode:'cloud',request:async url=>url.includes('?q=')?{items:[{id:'a'}]}:url.includes('alt=media')?sample():{etag:String(++version)}}).load(),/changed while loading/);
});
