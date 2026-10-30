import {mkdir,readdir,readFile,writeFile,rename,open,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {checkJobId,checkManifest,signatureMatches,parseIntake,identityMatches} from './public/intake-core.mjs';
import {contextRecord,snapshotPatient} from './public/notes-core.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),fingerprint=c=>hash(JSON.stringify(c||null));
export class DocumentIntake{
 constructor({root,notes,roster,ledger,ai}){Object.assign(this,{root,notes,roster,ledger,ai});this.incoming=path.join(root,'Incoming');this.running=false;}
 file(id){return path.join(this.incoming,'intake-'+checkJobId(id)+'.json');}
 async read(id){return checkManifest(JSON.parse(await readFile(this.file(id),'utf8')));}
 async write(job){checkManifest(job);await mkdir(this.incoming,{recursive:true});const file=this.file(job.id),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(job,null,2)+'\n',{mode:0o600});await rename(temp,file);return this.read(job.id);}
 async patient(job){const roster=await this.roster(),ledger=await this.ledger();if(ledger.datasetId!==job.datasetId)throw new Error('Upload belongs to a different billing workspace.');const matches=[...(roster.patients||[]),...(roster.otherPatients||[])].filter(p=>String(p.phn||'').replace(/\D/g,'')===job.phn);if(matches.length!==1)throw new Error('The PHN must match exactly one saved roster patient. Save the patient first.');return snapshotPatient({...matches[0],phn:job.phn,key:'phn:'+job.phn},roster.units);}
 async submit({job,documents}){
  checkManifest(job);await this.patient(job);if(!Array.isArray(documents)||documents.length!==job.files.length)throw new Error('Missing upload content.');
  const buffers=documents.map((data,i)=>{if(typeof data!=='string'||!/^data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+$/.test(data))throw new Error('Invalid upload encoding.');const b=Buffer.from(data.split(',')[1],'base64'),f=job.files[i];if(b.length!==f.size||hash(b)!==f.sha256||!signatureMatches(b,f.mime))throw new Error('File contents did not match the upload.');return b;});
  try{const old=await this.read(job.id);if(old.phn!==job.phn||old.datasetId!==job.datasetId||JSON.stringify(old.files)!==JSON.stringify(job.files))throw new Error('Upload retry differs from the original.');return old;}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(this.incoming,{recursive:true});
  for(let i=0;i<buffers.length;i++){const file=path.join(this.incoming,job.files[i].file);try{await writeFile(file,buffers[i],{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}if(hash(await readFile(file))!==job.files[i].sha256)throw new Error('Uploaded original could not be verified.');}
  const saved=await this.write({...job,status:'queued',createdAt:new Date().toISOString(),message:'Waiting for local AI analysis.'});void this.tick();return saved;
 }
 async list(phn){if(!/^\d{10}$/.test(phn||''))throw new Error('Invalid patient PHN.');let names;try{names=await readdir(this.incoming);}catch(e){if(e.code==='ENOENT')return [];throw e;}const jobs=[];for(const name of names.filter(n=>/^intake-[a-f0-9-]+\.json$/.test(n))){try{const j=await this.read(name.slice(7,-5));if(j.phn===phn)jobs.push(j);}catch{}}return jobs.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));}
 async tick(){
  if(this.running)return;this.running=true;
  try{let names;try{names=await readdir(this.incoming);}catch(e){if(e.code==='ENOENT')return;throw e;}
   for(const name of names.filter(n=>/^intake-[a-f0-9-]+\.json$/.test(n))){let job;try{job=await this.read(name.slice(7,-5));}catch{continue;}if(!['queued','waiting','processing'].includes(job.status))continue;await this.process(job.id);}
  }finally{this.running=false;}
 }
 async process(id){
  const lock=this.file(id)+'.lock';let handle;
  try{handle=await open(lock,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const info=await stat(lock);if(Date.now()-info.mtimeMs>30*60*1000)await unlink(lock);return;}
  let job;
  try{
   job=await this.read(id);if(!['queued','waiting','processing'].includes(job.status))return;
   const patient=await this.patient(job),status=await this.ai.status();
   if(!status.planEnabled){await this.write({...job,status:'waiting',message:'Saved. Open the laptop app and connect ChatGPT in Settings to analyze.'});return;}
   const models=await this.ai.models(),model=models.find(m=>m.id===job.model)?.id||models[0]?.id;if(!model)throw new Error('No AI model is available. Connect ChatGPT and retry.');
   const documents=[];for(const f of job.files){const b=await readFile(path.join(this.incoming,f.file));if(hash(b)!==f.sha256||b.length!==f.size||!signatureMatches(b,f.mime))throw new Error('Original file is missing, incomplete, or changed. Wait for Drive sync, then retry.');documents.push({name:f.name,mime:f.mime,dataUrl:`data:${f.mime};base64,${b.toString('base64')}`});}
   const loaded=await this.notes.load('patient-context.json'),context=loaded.data?.patients?.[patient.key]||null;if(loaded.data&&loaded.data.datasetId!==job.datasetId)throw new Error('Patient notes belong to a different workspace.');
   job={...job,status:'processing',message:'Analyzing documents…',startedAt:new Date().toISOString()};await this.write(job);
   const proposal=parseIntake(await this.ai.analyzeDocuments({model,patient,context,documents}));
   job={...job,proposal,baseFingerprint:fingerprint(context),status:identityMatches(proposal,job.phn,job.files.length)?'ready':'identity-review',message:identityMatches(proposal,job.phn,job.files.length)?'Analysis ready for your review.':'Source PHN is missing or does not match. Check the original before importing.',completedAt:new Date().toISOString()};
   await this.write(job);
  }catch(e){if(job)await this.write({...job,status:'error',message:e.message});}
  finally{await handle.close();await unlink(lock);}
 }
 async retry(id){const job=await this.read(id);if(!['error','waiting','identity-review','ready'].includes(job.status))throw new Error('This upload is already queued, processing, or complete.');const next=await this.write({...job,status:'queued',message:'Queued for analysis.'});void this.tick();return next;}
 async accept(id){
  const job=await this.read(id),patient=await this.patient(job);if(job.status==='accepted')return job;if(job.status!=='ready'||!identityMatches(parseIntake(job.proposal),job.phn,job.files.length))throw new Error('Review and resolve the source identity first.');
  const loaded=await this.notes.load('patient-context.json'),data=loaded.data||contextRecord(job.datasetId),current=data.patients[patient.key];
  if(current?.sourceDocuments?.some(s=>s.intakeId===id)){return this.write({...job,status:'accepted',message:'Saved to the patient profile for clinical review.'});}
  if(data.datasetId!==job.datasetId||fingerprint(current)!==job.baseFingerprint)throw Object.assign(new Error('Patient context changed since analysis. Retry analysis against the latest profile.'),{status:409});
  data.patients[patient.key]={...current,patient:current?.patient||patient,summaryMarkdown:job.proposal.summaryMarkdown,reviewIssues:[...(current?.reviewIssues||[]),...job.proposal.reviewIssues],sourceDocuments:[...(current?.sourceDocuments||[]),...job.files.map(f=>({intakeId:id,path:'Incoming/'+f.file,originalName:f.name,retained:true,sha256:f.sha256,importedAt:new Date().toISOString()}))],importStatus:{...(typeof current?.importStatus==='object'?current.importStatus:{}),importedAt:new Date().toISOString(),clinicalReviewStatus:'pending',intakeId:id},updatedAt:new Date().toISOString()};
  await this.notes.save('patient-context.json',data,loaded.etag);const verified=await this.notes.load('patient-context.json');if(JSON.stringify(verified.data.patients[patient.key])!==JSON.stringify(data.patients[patient.key]))throw new Error('Patient profile read-back failed. Originals retained.');
  return this.write({...job,status:'accepted',message:'Saved to the patient profile for clinical review. Originals retained.'});
 }
}
