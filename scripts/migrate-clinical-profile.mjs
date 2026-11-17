// Migrate only indexed working profiles. Dry run by default. No source documents are changed.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {LocalNotesStore} from '../notes-local.mjs';
import {refreshProfileDisplay} from '../profile-display-local.mjs';
import {organizePatient,clinicalLabs} from '../public/clinical-profile.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const normalized=line=>line.trim().replace(/^[-*•]\s+/,'').replace(/\s+/g,' ');
function verifyText(before,after) {
  const text=[after.summaryMarkdown,after.medicalHistory.text,...after.allergies.entries.map(e=>e.text)].map(normalized).join('\n');
  for(const line of (before.summaryMarkdown||'').split(/\r?\n/)) {
    if(/^\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*:?\s*$|(?:DOB|date of birth)(?: source| reconciliation)?:)/i.test(line))continue;
    for(const sentence of normalized(line).split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      if(sentence && !text.includes(sentence))throw new Error('Migration would lose clinical wording.');
    }
  }
}
export async function migrateProfiles({base,locks,apply=false}) {
  const root=path.join(base,'Working records','Routine notes'),store=new LocalNotesStore(root,locks);
  const json=async name=>JSON.parse(await readFile(path.join(base,name),'utf8'));
  const roster=await json('Data/Roster/trim-patients-data.json'),ledger=await json('Data/Billing/trim-billing-data-v1.json');
  const loaded=await store.load('patient-context.json'),data=structuredClone(loaded.data);
  if(!data?.datasetId||data.datasetId!==ledger.datasetId)throw new Error('Clinical workspace mismatch.');
  const rosterRows=[...roster.patients,...(roster.otherPatients||[]),...(roster.removedPatients||[])];
  const byKey=new Map();
  for(const row of rosterRows) {
    const phn=String(row.phn||'').replace(/\D/g,'');
    if(!/^\d{10}$/.test(phn))continue;
    if(byKey.has('phn:'+phn))throw new Error('Duplicate roster identity.');
    byKey.set('phn:'+phn,row);
  }
  const files=await readdir(path.join(root,'patients'));
  const names=files.filter(name=>name.endsWith('.json')).sort();
  if(!equal(names,Object.keys(data.patients).map(key=>key.slice(4)+'.json').sort()))throw new Error('Patient files and index differ.');
  const report={profiles:names.length,changed:0,medicalHistory:0,allergies:{},birthDates:0,recoveredBirthDates:0,labEntries:0,individualLabEntries:0,undatedLabEntries:0};
  for(const [key,before] of Object.entries(data.patients)) {
    const rosterPatient=byKey.get(key);
    if(rosterPatient && before.patient.ava && rosterPatient.ava && String(before.patient.ava)!==String(rosterPatient.ava))throw new Error('Roster Ava and patient file identity conflict.');
    const after=organizePatient(before,rosterPatient||{});
    if(!equal(after,organizePatient(after,rosterPatient||{}))) throw new Error('Patient migration must be idempotent.');
    verifyText(before,after);
    for(const line of (before.summaryMarkdown||'').split(/\r?\n/)) {
      const source=line.match(/^\s*(?:DOB|Date of birth) (?:source|reconciliation)\s*:\s*(.+?)\s*$/i);
      if(source&&!after.patient.dateOfBirthSource?.includes(source[1]))throw new Error('DOB source wording was lost.');
    }
    for(const [field,value] of Object.entries(before)) {
      if(!['patient','summaryMarkdown','medicalHistory','allergies','dateOfBirth','dateOfBirthSource','dob'].includes(field)&&!equal(value,after[field]))throw new Error('Unrelated clinical field changed.');
    }
    for(const [field,value] of Object.entries(before.patient))if(!['dateOfBirth','dateOfBirthSource','dob'].includes(field)&&!equal(value,after.patient[field]))throw new Error('Patient identity changed.');
    if(after.patient.dateOfBirth)report.birthDates++;
    if(!before.patient.dateOfBirth&&after.patient.dateOfBirth)report.recoveredBirthDates++;
    if(after.medicalHistory.status==='documented')report.medicalHistory++;
    report.allergies[after.allergies.status]=(report.allergies[after.allergies.status]||0)+1;
    const labs=before.labs||[],view=clinicalLabs(labs);
    for(const [i,lab] of labs.entries()) {
      report.labEntries++;if(lab.test!=null)report.individualLabEntries++;if(!lab.date)report.undatedLabEntries++;
      if(view[i].date!==(lab.date||null)||!view[i].results.length||
        (lab.test!=null&&![lab.test,lab.value,lab.unit,lab.note,lab.dateBasis,lab.datePrecision].filter(v=>v!=null&&v!=='').every(v=>view[i].results.some(item=>String(item).includes(String(v)))))||
        (Array.isArray(lab.results)&&!lab.results.every(v=>view[i].results.some(result=>equal(result,v)))))throw new Error('Lab projection did not preserve the source result.');
    }
    if(!equal(before,after))report.changed++;
    data.patients[key]=after;
  }
  if(apply) {
    if(report.changed) {
      const raw=JSON.stringify(loaded.data,null,2)+'\n',archive=path.join(root,'archive');
      const backup=path.join(archive,'patient-profiles-before-sections-'+createHash('sha256').update(raw).digest('hex').slice(0,16)+'.json');
      await mkdir(archive,{recursive:true});
      try{await writeFile(backup,raw,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
      if(await readFile(backup,'utf8')!==raw)throw new Error('Private recovery copy failed verification.');
      await store.save('patient-context.json',data,loaded.etag);
    }
    const saved=await store.load('patient-context.json');
    if(!equal(saved.data,data))throw new Error('Saved patient records failed read-back.');
    const display=await refreshProfileDisplay(store,root);
    for(const c of Object.values(saved.data.patients)) {
      const d=display.patients[c.patient.phn];
      if(!d?.structuredDob||d.dateOfBirth!==(c.patient.dateOfBirth||'')||d.mostStatus!==(c.mostStatus||''))throw new Error('Patient display failed read-back.');
    }
    report.verified=true;
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const base=path.join(os.homedir(),'My Drive','02. TRIM','TRIM AI'),locks=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMNotes','locks');
  console.log(JSON.stringify(await migrateProfiles({base,locks,apply:process.argv.includes('--apply')}),null,2));
}
