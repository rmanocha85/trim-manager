import {checkJobId,safeFileName,MAX_UPLOAD_BYTES} from './intake-core.mjs?v=20261111-roster1';
export const incomingMime=name=>({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain'}[String(name).split('.').at(-1).toLowerCase()]);
export const appUploadName=name=>/^[a-f0-9-]{36}-\d+\.(pdf|png|jpg|webp|txt)$/i.test(name)||/^intake-.*\.json$/.test(name);
export function checkIncomingRequest(r){
 checkJobId(r?.id);
 if(r.app!=='trim-incoming-request'||r.schema!==1||typeof r.datasetId!=='string'||!r.datasetId||!Number.isFinite(Date.parse(r.createdAt))||!Array.isArray(r.files)||r.files.length>500||!Array.isArray(r.issues)||r.issues.some(x=>typeof x!=='string'||x.length>1000)||!Array.isArray(r.retryJobs)||r.retryJobs.length>100)throw new Error('Invalid Incoming request.');
 const names=new Set();for(const f of r.files){if(!safeFileName(f.name)||!incomingMime(f.name)||appUploadName(f.name)||!Number.isInteger(f.size)||f.size<1||f.size>MAX_UPLOAD_BYTES||!/^[a-f0-9]{64}$/.test(f.sha256)||names.has(f.name.toLowerCase()))throw new Error('Invalid or duplicate Incoming source.');names.add(f.name.toLowerCase());}
 r.retryJobs.forEach(checkJobId);return r;
}
export const incomingLabel=status=>({queued:'Waiting for laptop / Drive sync',waiting:'Waiting for Drive sync or ChatGPT',processing:'Processing',completed:'Completed',attention:'Needs attention'}[status]||'Waiting for laptop / Drive sync');
export function requestView(request,result){
 checkIncomingRequest(request);
 const valid=result?.app==='trim-incoming-result'&&result.id===request.id&&result.datasetId===request.datasetId&&['waiting','processing','completed','attention'].includes(result.status);
 return {...request,status:valid?result.status:'queued',message:valid?String(result.message||''):'Request saved. Waiting for the laptop background service and Drive sync.',items:valid&&Array.isArray(result.items)?result.items:[]};
}
