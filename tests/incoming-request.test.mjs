import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {checkIncomingRequest,requestView} from '../public/incoming-request.mjs';
const request=()=>({app:'trim-incoming-request',schema:1,id:randomUUID(),datasetId:'synthetic',createdAt:new Date().toISOString(),files:[{name:'document.pdf',size:20,sha256:'a'.repeat(64)}],issues:[],retryJobs:[]});
test('Incoming requests reject traversal, duplicate filenames, invalid hashes and reserved app sources',()=>{
 for(const change of [{name:'../document.pdf'},{name:'C:\\document.pdf'},{sha256:'unknown'},{size:0},{name:randomUUID()+'-0.pdf'}]){const r=request();Object.assign(r.files[0],change);assert.throws(()=>checkIncomingRequest(r));}
 const r=request();r.files.push({...r.files[0],name:'DOCUMENT.PDF'});assert.throws(()=>checkIncomingRequest(r),/duplicate/);
});
test('results cannot be mistaken for another request or workspace',()=>{
 const r=request(),result={app:'trim-incoming-result',id:r.id,datasetId:r.datasetId,status:'completed',message:'Done',items:[]};assert.equal(requestView(r,result).status,'completed');assert.equal(requestView(r,{...result,id:randomUUID()}).status,'queued');assert.equal(requestView(r,{...result,datasetId:'other'}).status,'queued');
});
