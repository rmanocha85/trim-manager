import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalNotesStore} from '../notes-local.mjs';
import {legacyMost} from '../public/profile-display.mjs';
import {normalizeMost} from '../public/most-designations.mjs';
import {snapshotPatient} from '../public/notes-core.mjs';
import {refreshProfileDisplay} from '../profile-display-local.mjs';
const base=path.join(os.homedir(),'My Drive','02. TRIM','TRIM AI'),root=path.join(base,'Working records','Routine notes');
const store=new LocalNotesStore(root,path.join(process.env.LOCALAPPDATA,'TRIMNotes','locks'));
const json=async p=>JSON.parse(await readFile(path.join(base,p),'utf8'));
const roster=await json('Data/Roster/trim-patients-data.json'),ledger=await json('Data/Billing/trim-billing-data-v1.json');
const loaded=await store.load('patient-context.json'),data=structuredClone(loaded.data);
if(data.datasetId!==ledger.datasetId)throw Error('Workspace mismatch');
const byKey=new Map();
for(const p of [...roster.patients,...roster.otherPatients]){
 const phn=String(p.phn||'').replace(/\D/g,'');if(!/^\d{10}$/.test(phn))continue;
 const key='phn:'+phn;if(byKey.has(key))throw Error('Duplicate roster identity');byKey.set(key,p);
 if(!data.patients[key]&&normalizeMost(p.mostStatus))data.patients[key]={patient:snapshotPatient({...p,phn,key},roster.units),summaryMarkdown:''};
}
const apply=process.argv.includes('--apply');
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let changed=0;
for(const [key,c] of Object.entries(data.patients)){
 if(Object.hasOwn(c,'mostStatus'))continue;
 const prior=legacyMost(c),manual=normalizeMost(byKey.get(key)?.mostStatus);
 if(manual&&prior.mostStatus&&manual!==prior.mostStatus)throw Error('Conflicting roster and profile values need review.');
 c.mostStatus=prior.mostStatus||manual||null;
 if(!c.mostStatus&&prior.mostEvidence.includes('latest designation cannot be established'))c.mostReview={reason:'Review MOST against the saved history.',knownThrough:day,sources:[]};
 if(c.mostStatus)c.mostSource={source:c.currentMost?.source==='physician'?'Physician confirmation':prior.mostStatus?'Saved patient history':'Saved roster entry',sourceDate:c.currentMost?.source==='physician'?c.currentMost.confirmedOn||null:null,knownThrough:day,evidence:prior.mostStatus?prior.mostEvidence.replace(/^Pending review\.\s*/,''):manual};
 changed++;
}
const count=rows=>rows.filter(p=>data.patients['phn:'+String(p.phn).replace(/\D/g,'')]?.mostStatus).length;
const result={changed,own:count(roster.patients),other:count(roster.otherPatients),totalOwn:roster.patients.length,totalOther:roster.otherPatients.length};
if(apply){
 if(changed)await store.save('patient-context.json',data,loaded.etag);
 const saved=await store.load('patient-context.json');if(JSON.stringify(saved.data)!==JSON.stringify(data))throw Error('Patient files did not verify');
 const display=await refreshProfileDisplay(store,root);
 for(const c of Object.values(saved.data.patients)){const d=display.patients[c.patient.phn];if(!d||d.mostStatus!==(c.mostStatus||'')||!d.structuredMost)throw Error('Projection did not match');}
 result.verified=true;
}
console.log(result);
