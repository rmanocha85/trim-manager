// Apply a physician-authorized, verified extraction batch. Extraction is a separate step.
// The prepared file is temporary clinical data, never committed to this repository.
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LocalNotesStore} from '../notes-local.mjs';
import {contextRecord,snapshotPatient} from '../public/notes-core.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function importPatientContext({root,rosterPath,preparedPath,datasetId,commit=false}){
  const rosterRaw=await readFile(rosterPath),roster=JSON.parse(rosterRaw),prepared=JSON.parse(await readFile(preparedPath,'utf8'));
  const store=new LocalNotesStore(root,path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMNotes','locks'));
  const before=await store.load('patient-context.json'),context=structuredClone(before.data||contextRecord(datasetId));
  if(context.datasetId!==datasetId)throw new Error('Dataset mismatch.');
  const all=[...roster.patients,...(roster.otherPatients||[]),...(roster.removedPatients||[])];
  const phn=p=>String(p.phn||'').replace(/\D/g,'');
  const identify=id=>{
    if(!/^\d{10}$/.test(id))throw new Error('Invalid PHN.');
    const matches=all.filter(p=>phn(p)===id);
    if(matches.length!==1)throw new Error('PHN must match exactly one roster patient.');
    return snapshotPatient({...matches[0],phn:id,key:'phn:'+id},roster.units);
  };
  // Create empty records for the current physician panel; preserve former/other contexts.
  for(const p of roster.patients){
    const patient=identify(phn(p));
    context.patients[patient.key]||={patient,summaryMarkdown:''};
  }
  const sourceFiles=[],keys=new Set(),changedKeys=new Set(),now=new Date().toISOString();
  for(const update of prepared){
    const patient=identify(update.phn),key=patient.key;
    if(keys.has(key))throw new Error('Duplicate patient in import batch.');keys.add(key);
    const current=context.patients[key],known=new Set((current.sourceDocuments||[]).map(s=>s.sha256));
    if(update.sources.every(s=>known.has(s.sha256)))continue;
    changedKeys.add(key);
    if(current.summaryMarkdown?.trim())throw new Error('Existing summary needs explicit reconciliation before replacement.');
    const sourceNames=[];
    for(const source of update.sources){
      if(!/^[a-f0-9]{64}$/.test(source.sha256)||source.path!==`sources/${source.sha256}${path.extname(source.originalName).toLowerCase()}`)throw new Error('Invalid source hash/path.');
      if(path.basename(source.originalName)!==source.originalName)throw new Error('Invalid incoming filename.');
      const filename=path.resolve(root,'Incoming',source.originalName);
      if(path.dirname(filename)!==path.resolve(root,'Incoming'))throw new Error('Source escaped incoming folder.');
      const raw=await readFile(filename);if(hash(raw)!==source.sha256)throw new Error('Incoming source changed after extraction.');
      sourceFiles.push({filename,destination:path.join(root,source.path),raw,sha256:source.sha256,key});
      sourceNames.push(source);
    }
    const next={...current,patient,summaryMarkdown:update.summaryMarkdown,followUp:update.followUp||[],reviewIssues:update.reviewIssues||[],sourceDocuments:[...(current.sourceDocuments||[]),...sourceNames],importStatus:{importedAt:now,clinicalReviewStatus:'pending',sourceDates:[update.medicationSnapshot.sourceDate,...(update.labs||[]).map(l=>l.date)]},updatedAt:now};
    if(current.medicationSnapshot)next.medicationHistory=[...(current.medicationHistory||[]),current.medicationSnapshot];
    next.medicationSnapshot=update.medicationSnapshot;
    if(update.labs)next.labs=[...(current.labs||[]),...update.labs];
    context.patients[key]=next;
  }
  const result={patientFiles:Object.keys(context.patients).length,updatedPatients:changedKeys.size,sourceFiles:sourceFiles.length,existingContexts:Object.keys(before.data?.patients||{}).length};
  if(!commit)return result;
  if(hash(await readFile(rosterPath))!==hash(rosterRaw))throw new Error('Roster changed; rerun matching.');
  // Retain byte-for-byte originals before clearing Incoming.
  await mkdir(path.join(root,'sources'),{recursive:true});
  for(const source of sourceFiles){
    try{await writeFile(source.destination,source.raw,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    if(hash(await readFile(source.destination))!==source.sha256)throw new Error('Retained source did not verify.');
  }
  await store.save('patient-context.json',context,before.etag);
  const saved=(await store.load('patient-context.json')).data;
  if(JSON.stringify(saved)!==JSON.stringify(context))throw new Error('Imported context read-back differs.');
  for(const [key,value]of Object.entries(before.data?.patients||{})){
    if(!changedKeys.has(key)&&JSON.stringify(saved.patients[key])!==JSON.stringify(value))throw new Error('An existing patient was changed unexpectedly.');
  }
  // No removal until identity, content, full record read-back and source retention verify.
  for(const source of sourceFiles){
    if(!saved.patients[source.key].sourceDocuments.some(s=>s.sha256===source.sha256))throw new Error('Source not referenced by saved patient.');
    if(hash(await readFile(source.filename))!==source.sha256||hash(await readFile(source.destination))!==source.sha256)throw new Error('Source changed before cleanup; retained in Incoming.');
    await unlink(source.filename);
  }
  return {...result,verified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [root,rosterPath,preparedPath,datasetId,flag]=process.argv.slice(2);
  console.log(JSON.stringify(await importPatientContext({root,rosterPath,preparedPath,datasetId,commit:flag==='--commit'})));
}
