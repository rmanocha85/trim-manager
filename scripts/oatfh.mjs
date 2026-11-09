// Physician-triggered local JSON writer. Email is sent separately through Outlook.
import {readFile,writeFile,access} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {OatStore} from '../oat-storage.mjs';import {prepareOatImport,setOatAva,recordOatRegistrationSent} from '../oat-import.mjs';
const [command,...raw]=process.argv.slice(2),args={};
for(let i=0;i<raw.length;i+=2){if(!raw[i]?.startsWith('--')||!raw[i+1])throw new Error('Use --key value arguments.');args[raw[i].slice(2)]=raw[i+1];}
if(!args.roster||!path.isAbsolute(args.roster))throw new Error('An absolute private --roster path is required.');
const store=new OatStore(args.roster),current=await store.load();let result;
if(command==='import'){
 if(!args.input||!args.result||!path.isAbsolute(args.result))throw new Error('Import needs --input and an absolute private --result file.');
 try{await access(args.result);throw new Error('This result already exists. Read its run state before retrying.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const input=JSON.parse(await readFile(args.input,'utf8'));if(!input.source?.pdfFile||!input.source?.emailFile)throw new Error('Retain the source PDF and email before import.');
 const pdf=await readFile(input.source.pdfFile),email=await readFile(input.source.emailFile);if(!email.length)throw new Error('The retained source email is empty.');
 input.source.pdfSha256=createHash('sha256').update(pdf).digest('hex');
 const prepared=prepareOatImport(current.roster,input),saved=await store.update(current.etag,()=>prepared.roster);
 result={clinicDate:input.clinicDate,source:input.source,rosterEtag:saved.etag,appointments:input.appointments.length,addedPatientIds:prepared.added,registrationNeeded:prepared.registrationNeeded,registrationEmailStatus:prepared.registrationNeeded.length?'pending':'not-needed'};
 await writeFile(args.result,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(`Saved ${result.appointments} schedule rows; ${prepared.added.length} new roster patients; ${prepared.registrationNeeded.length} need an Ava registration request.`);
}else if(command==='ava'){
 await store.update(current.etag,roster=>setOatAva(roster,args.phn,args.ava));console.log('Saved and verified the Ava number; the stable patient ID and schedule references were preserved.');
}else if(command==='sent'){
 if(!args.receipt||!args.recipient)throw new Error('Provide the verified Sent --receipt file and expected --recipient.');const receipt=JSON.parse(await readFile(args.receipt,'utf8'));
 await store.update(current.etag,roster=>recordOatRegistrationSent(roster,receipt,args.recipient));console.log('Recorded the verified registration email receipt.');
}else throw new Error('Use import, ava or sent.');
