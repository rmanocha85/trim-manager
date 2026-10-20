import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {LocalNotesStore} from '../notes-local.mjs';
import {contextRecord,ensurePatientContexts} from '../public/notes-core.mjs';

export async function ensureRosterContext({rosterPath,billingPath,notesRoot}){
  const rosterText=await readFile(rosterPath,'utf8'),roster=JSON.parse(rosterText);
  const billing=JSON.parse(await readFile(billingPath,'utf8'));
  if(billing.app!=='trim-billing'||!billing.datasetId)throw new Error('A verified billing dataset is required to link Notes.');
  const store=new LocalNotesStore(notesRoot,path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMNotes','locks'));
  // Same transaction and identity rules as the app; preserve every existing clinical field.
  return store.locked(async()=>{
    const loaded=await store.context(),context=loaded.data||contextRecord(billing.datasetId);
    if(context.datasetId!==billing.datasetId)throw new Error('Notes dataset differs from billing; nothing created.');
    const created=ensurePatientContexts(context,roster);
    if(await readFile(rosterPath,'utf8')!==rosterText)throw new Error('Roster changed during initialization. Re-read and retry.');
    await store.saveContext(context,loaded.etag);
    const verified=await store.context();
    if(created&&JSON.stringify(verified.data)!==JSON.stringify(context))throw new Error('Patient-file readback differs.');
    return {created,patientFiles:Object.keys(context.patients).length,verified:true};
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [rosterPath,billingPath,notesRoot]=process.argv.slice(2);
  if(!rosterPath||!billingPath||!notesRoot)throw new Error('Supply roster, billing and Notes paths.');
  console.log(JSON.stringify(await ensureRosterContext({rosterPath,billingPath,notesRoot})));
}
