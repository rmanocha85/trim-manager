import {mkdir,readdir,readFile,writeFile,rename,open,unlink,stat,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {checkJobId,checkManifest,signatureMatches,identityMatches,reconciledFields,validateReconciliation,safeFileName,MAX_UPLOAD_BYTES} from './public/intake-core.mjs';
import {contextRecord,snapshotPatient} from './public/notes-core.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),fingerprint=c=>hash(JSON.stringify(c||null));
const mimeFor={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const active=new Set(['queued','waiting','identifying','processing','saved','ready','error','identity-review']);
const exists=async f=>{try{return await stat(f);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const stop=message=>Object.assign(new Error(message),{hold:true});
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export class DocumentIntake{
 constructor({root,notes,roster,ledger,ai,stableMs=5000,now=()=>Date.now(),lockRoot}){
  Object.assign(this,{root,notes,roster,ledger,ai,stableMs,now});this.incoming=path.join(root,'Incoming');this.jobs=path.join(root,'Intake jobs');this.held=path.join(root,'Intake held');
  this.lockRoot=lockRoot||path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMNotes','intake-locks');this.running=false;this.observed=new Map();this.service={lastScan:null,error:null};
 }
 file(id){return path.join(this.jobs,'intake-'+checkJobId(id)+'.json');}
 source(job,f){return f.held?path.join(this.held,job.id,f.file):path.join(this.incoming,f.file);}
 destination(job,f,i){return path.join(this.root,'extracted',job.archiveDay,job.id,i+'-'+(safeFileName(f.name)?f.name:f.file));}
 relative(file){return path.relative(this.root,file).split(path.sep).join('/');}
 async read(id){return checkManifest(JSON.parse(await readFile(this.file(id),'utf8')));}
 async write(job){checkManifest(job);await mkdir(this.jobs,{recursive:true});const file=this.file(job.id),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(job,null,2)+'\n',{mode:0o600});await rename(temp,file);return this.read(job.id);}
 async patient(job){const roster=await this.roster(),ledger=await this.ledger();if(ledger.datasetId!==job.datasetId)throw stop('The document belongs to a different workspace.');const matches=[...(roster.patients||[]),...(roster.otherPatients||[])].filter(p=>String(p.phn||'').replace(/\D/g,'')===job.phn);if(matches.length!==1)throw stop('The source PHN must match exactly one saved roster patient.');return snapshotPatient({...matches[0],phn:job.phn,key:'phn:'+job.phn},roster.units);}
 async submit({job,documents}){
  checkManifest(job);await this.patient(job);if(!Array.isArray(documents)||documents.length!==job.files.length)throw new Error('Missing upload content.');
  const buffers=documents.map((data,i)=>{if(typeof data!=='string'||!/^data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+$/.test(data))throw new Error('Invalid upload encoding.');const b=Buffer.from(data.split(',')[1],'base64'),f=job.files[i];if(b.length!==f.size||hash(b)!==f.sha256||!signatureMatches(b,f.mime))throw new Error('File contents did not match the upload.');return b;});
  try{const old=await this.read(job.id);if(old.phn!==job.phn||old.datasetId!==job.datasetId||JSON.stringify(old.files.map(({held,...f})=>f))!==JSON.stringify(job.files))throw new Error('Upload retry differs from the original.');return old;}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(this.incoming,{recursive:true});
  for(let i=0;i<buffers.length;i++){const file=path.join(this.incoming,job.files[i].file);try{await writeFile(file,buffers[i],{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}if(hash(await readFile(file))!==job.files[i].sha256)throw new Error('Uploaded original could not be verified.');}
  // Caller-supplied status, proposal and paths cannot bypass analysis.
  const saved=await this.write({app:job.app,schema:job.schema,id:job.id,phn:job.phn,datasetId:job.datasetId,model:job.model,files:job.files.map(({name,mime,size,sha256,file})=>({name,mime,size,sha256,file})),status:'queued',createdAt:new Date().toISOString(),message:'Queued for automatic import.'});void this.tick();return saved;
 }
 async list(phn){if(phn&&!/^\d{10}$/.test(phn))throw new Error('Invalid patient PHN.');let names;try{names=await readdir(this.jobs);}catch(e){if(e.code==='ENOENT')return [];throw e;}const jobs=[];for(const name of names.filter(n=>/^intake-[a-f0-9-]+\.json$/.test(n))){try{const j=await this.read(name.slice(7,-5));if(!phn||j.phn===phn)jobs.push(j);}catch{this.service.error='An intake job could not be read: '+name;}}
  return jobs.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
 }
 async moveVerified(from,to,sha){
  if(path.resolve(from)===path.resolve(to))return;
  if(await exists(to)){if(hash(await readFile(to))!==sha)throw stop('Archive destination differs from the source. Original retained.');if(await exists(from)){if(hash(await readFile(from))!==sha)throw stop('The original changed after processing.');await unlink(from);}return;}
  if(hash(await readFile(from))!==sha)throw stop('The source changed before archival. Original retained.');await mkdir(path.dirname(to),{recursive:true});await rename(from,to);if(hash(await readFile(to))!==sha)throw stop('Archive verification failed. Source evidence retained for review.');
 }
 async migrate(){
  for(const folder of [this.incoming,this.held]){let names;try{names=await readdir(folder);}catch(e){if(e.code==='ENOENT')continue;throw e;}
   for(const name of names.filter(n=>/^intake-[a-f0-9-]+\.json$/.test(n))){const file=path.join(folder,name);try{const job=checkManifest(JSON.parse(await readFile(file,'utf8')));if(!await exists(this.file(job.id)))await this.write({...job,status:folder===this.held?'held':job.status==='accepted'?'saved':'queued',message:folder===this.held?'Needs attention: previous upload source was not available. Restore the original and retry.':'Legacy upload queued for automatic reconciliation.'});
     await this.moveVerified(file,path.join(this.held,'legacy-manifests',name),hash(await readFile(file)));
    }catch(e){this.service.error='An old intake manifest needs attention: '+name+' ('+e.message+')';}
   }
  }
 }
 async discover(){
  const jobs=await this.list(),claimed=new Set(jobs.filter(j=>j.status!=='accepted').flatMap(j=>j.files.filter(f=>!f.held).map(f=>f.file.toLowerCase()))),names=await readdir(this.incoming),live=new Set(names);
  for(const name of this.observed.keys())if(!live.has(name))this.observed.delete(name);
  for(const name of names){if(claimed.has(name.toLowerCase())||/^intake-.*\.json$/.test(name))continue;const file=path.join(this.incoming,name),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())continue;
   const mark=info.size+':'+info.mtimeMs,seen=this.observed.get(name);if(!seen||seen.mark!==mark){this.observed.set(name,{mark,since:this.now()});continue;}if(this.now()-seen.since<this.stableMs)continue;
   // Drive can sync uploaded originals before their manifest.
   if(/^[a-f0-9-]{36}-\d+\.(pdf|png|jpg|webp)$/i.test(name)&&this.now()-seen.since<15*60*1000)continue;
   const mime=mimeFor[path.extname(name).toLowerCase()];if(!mime||!safeFileName(name)||!info.size||info.size>MAX_UPLOAD_BYTES){this.service.error='Incoming document needs attention (unsupported type, empty file, or larger than 10 MB): '+name;continue;}
   const bytes=await readFile(file),after=await stat(file);if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)continue;
   const {datasetId}=await this.ledger();await this.write({app:'trim-document-intake',schema:2,id:randomUUID(),phn:null,datasetId,status:'queued',createdAt:new Date().toISOString(),message:'New document queued for automatic import.',files:[{name,file:name,mime,size:bytes.length,sha256:hash(bytes)}]});this.observed.delete(name);
  }
 }
 async tick(){
  if(this.running)return;this.running=true;let handle;const lock=path.join(this.lockRoot,hash(path.resolve(this.root))+'.lock');
  try{await mkdir(this.lockRoot,{recursive:true});try{handle=await open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid}));}catch(e){if(e.code!=='EEXIST')throw e;let owner;try{owner=JSON.parse(await readFile(lock,'utf8'));}catch{}let alive=false;if(owner?.pid){try{process.kill(owner.pid,0);alive=true;}catch(e){alive=e.code==='EPERM';}}if(!alive&&(owner?.pid||this.now()-(await stat(lock)).mtimeMs>60000))await unlink(lock);return;}
   this.service.error=null;await mkdir(this.incoming,{recursive:true});await this.migrate();await this.discover();this.service.lastScan=new Date().toISOString();
   for(const job of await this.list())if(active.has(job.status)&&(!job.retryAfter||job.retryAfter<=this.now()))await this.process(job.id);
  }catch(e){this.service.error=e.message;}finally{if(handle){await handle.close();await unlink(lock).catch(()=>{});}this.running=false;}
 }
 async hold(job,message){
  job={...job,status:'held',message:'Needs attention: '+message,retryAfter:null};await this.write(job);
  for(let i=0;i<job.files.length;i++){const f=job.files[i];if(f.held)continue;const from=this.source(job,f),to=path.join(this.held,job.id,f.file);if(await exists(from)){try{await this.moveVerified(from,to,f.sha256);job.files[i]={...f,held:true};await this.write(job);}catch(e){job.message+=' Source retained: '+e.message;await this.write(job);}}}
  return job;
 }
 async loadContext(job){const loaded=await this.notes.load('patient-context.json');if(loaded.data&&loaded.data.datasetId!==job.datasetId)throw stop('Patient notes belong to a different workspace.');return loaded;}
 async process(id){
  let job=await this.read(id);if(!active.has(job.status))return;
  try{
   job.archiveDay||=day();if(!/^\d{4}-\d{2}-\d{2}$/.test(job.archiveDay))throw stop('Invalid archive date.');await this.write(job);
   let loaded=await this.loadContext(job),current=job.phn?loaded.data?.patients?.['phn:'+job.phn]:null;
   // A committed receipt recovers a crash before job status or archival was saved.
   if(current?.sourceDocuments?.some(s=>s.intakeId===id)||(job.status==='saved'&&job.duplicate&&job.files.every(f=>current?.sourceDocuments?.some(s=>s.sha256===f.sha256)))){await this.archive(job);return;}
   const documents=[];for(const f of job.files){let b;try{b=await readFile(this.source(job,f));}catch(e){if(e.code==='ENOENT'){const missingSince=job.missingSince??this.now();if(this.now()-missingSince<15*60*1000){await this.write({...job,missingSince,status:'waiting',retryAfter:this.now()+15000,message:'Waiting for the original file to finish syncing from Drive.'});return;}throw stop('Original file is missing. Restore it, allow Drive to sync, then retry.');}throw e;}if(hash(b)!==f.sha256||b.length!==f.size||!signatureMatches(b,f.mime))throw stop('Original file is incomplete, changed, or not a supported PDF/image.');documents.push({name:f.name,mime:f.mime,dataUrl:'data:'+f.mime+';base64,'+b.toString('base64')});}
   const status=await this.ai.status();if(!status.planEnabled){await this.write({...job,status:'waiting',message:'Waiting for the laptop’s ChatGPT connection. Connect it in Settings; intake resumes automatically.',retryAfter:null});return;}
   const models=await this.ai.models(),model=models.find(m=>m.id===job.model)?.id||models[0]?.id;if(!model)throw new Error('No AI model is available.');
   if(!job.phn){await this.write({...job,status:'identifying',message:'Reading the source PHN…'});const identity=await this.ai.identifyDocuments({model,documents}),phns=[...new Set(identity?.documentPhns?.flat()||[])];if(phns.length!==1||!/^\d{10}$/.test(phns[0])||!identityMatches(identity,phns[0],job.files.length))throw stop('The source PHN is missing, unreadable, or belongs to more than one patient.');job={...job,phn:phns[0]};await this.write(job);}
   const patient=await this.patient(job);loaded=await this.loadContext(job);current=loaded.data?.patients?.[patient.key]||null;
   const known=new Set(current?.sourceDocuments?.map(s=>s.sha256).filter(Boolean)||[]);
   for(const [key,c]of Object.entries(loaded.data?.patients||{}))if(key!==patient.key&&c.sourceDocuments?.some(s=>job.files.some(f=>f.sha256===s.sha256)))throw stop('This exact document is already associated with a different patient.');
   if(job.files.every(f=>known.has(f.sha256))){await this.archive({...job,duplicate:true});return;}
   const seenHashes=new Set(known),indices=[];job.files.forEach((f,i)=>{if(!seenHashes.has(f.sha256)){indices.push(i);seenHashes.add(f.sha256);}});
   job={...job,status:'processing',message:'Reconciling with the saved patient profile…',startedAt:new Date().toISOString(),baseFingerprint:fingerprint(current)};await this.write(job);
   const proposal=validateReconciliation(await this.ai.analyzeDocuments({model,patient,context:current,documents:indices.map(i=>documents[i])}));
   if(!identityMatches(proposal,job.phn,indices.length))throw stop('Every source must contain the selected patient’s exact PHN.');
   if(proposal.blockingIssues?.length)throw stop(proposal.blockingIssues.join(' '));
   job={...job,proposal};await this.write(job);
   const now=new Date().toISOString(),fields=reconciledFields(current||{},proposal,now);
   const verification=await this.ai.verifyDocuments({model,patient,context:current,proposal:{...proposal,reconciledFields:fields},documents:indices.map(i=>documents[i])});
   if(verification?.safeToSave!==true||!Array.isArray(verification.issues)||verification.issues.length)throw stop('Extraction check did not pass. '+(verification?.issues?.filter(x=>typeof x==='string').join(' ')||'Source reconciliation needs review.'));
   job={...job,verification};await this.write(job);
   for(let attempt=0;attempt<4;attempt++){
    const latest=await this.loadContext(job),data=latest.data||contextRecord(job.datasetId),record=data.patients[patient.key]||null;
    if(fingerprint(record)!==job.baseFingerprint)throw stop('The patient profile changed during analysis. Retry against the newer profile.');
    data.patients[patient.key]={...record,...fields,patient:record?.patient||patient,sourceDocuments:[...(record?.sourceDocuments||[]),...indices.map(i=>({intakeId:id,path:this.relative(this.source(job,job.files[i])),originalName:job.files[i].name,retained:true,sha256:job.files[i].sha256,importedAt:now}))],importStatus:{...(typeof record?.importStatus==='object'?record.importStatus:{}),importedAt:now,clinicalReviewStatus:'pending',sourceDates:[...new Set([...(record?.importStatus?.sourceDates||[]),...proposal.sourceDates])],intakeId:id},updatedAt:now};
    try{await this.notes.save('patient-context.json',data,latest.etag);}catch(e){if(e.status===409&&attempt<3)continue;throw e;}
    const verified=await this.loadContext(job);if(fingerprint(verified.data?.patients?.[patient.key])!==fingerprint(data.patients[patient.key]))throw stop('Patient profile read-back differed. Source retained for recovery.');break;
   }
   job={...job,status:'saved',message:'Patient profile saved; verifying archival…'};await this.write(job);await this.archive(job);
  }catch(e){if(e.hold){await this.hold(job,e.message);}else{const attempts=(job.attempts||0)+1;if(attempts>=5)await this.hold({...job,attempts},e.message);else await this.write({...job,attempts,status:'waiting',retryAfter:this.now()+Math.min(300000,15000*2**(attempts-1)),message:'Temporary processing problem; retrying automatically. '+e.message});}}
 }
 async archive(job){
  await this.patient(job);let loaded=await this.loadContext(job),record=loaded.data?.patients?.['phn:'+job.phn];
  if(!record||!job.files.every(f=>record.sourceDocuments?.some(s=>s.sha256===f.sha256)))throw stop('No verified patient import receipt exists; original retained.');
  job={...job,status:'saved',archiveDay:job.archiveDay||day(),message:'Patient profile saved; verifying archival…'};await this.write(job);
  for(let i=0;i<job.files.length;i++){const f=job.files[i];await this.moveVerified(this.source(job,f),this.destination(job,f,i),f.sha256);}
  for(let attempt=0;attempt<5;attempt++){loaded=await this.loadContext(job);record=loaded.data.patients['phn:'+job.phn];let changed=false;record.sourceDocuments=record.sourceDocuments.map(s=>{const i=job.files.findIndex(f=>f.sha256===s.sha256);if(s.intakeId!==job.id||i<0)return s;const retainedPath=this.relative(this.destination(job,job.files[i],i));if(s.path===retainedPath)return s;changed=true;return {...s,path:retainedPath,retained:true};});if(!changed)break;try{await this.notes.save('patient-context.json',loaded.data,loaded.etag);break;}catch(e){if(e.status===409&&attempt<4)continue;throw e;}}
  const verified=await this.loadContext(job);for(const s of verified.data.patients['phn:'+job.phn].sourceDocuments||[])if(s.intakeId===job.id&&!s.path.startsWith('extracted/'))throw new Error('Archive references still need verification.');
  return this.write({...job,status:'accepted',completedAt:new Date().toISOString(),retryAfter:null,attempts:0,message:job.duplicate?'Already imported; duplicate source archived.':'Saved and archived. Patient context is pending clinical review.'});
 }
 async retry(id){const job=await this.read(id);if(job.status==='accepted')return job;if(this.running)throw new Error('Wait for the current import to finish, then retry.');const next=await this.write({...job,status:'queued',attempts:0,retryAfter:null,message:'Queued for automatic import.'});void this.tick();return next;}
 async accept(id){const job=await this.read(id);if(job.status==='accepted')return job;return this.retry(id);}
}
