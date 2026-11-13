import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Use the completed source receipt, never the reconciled summary: a lab-only
// import can preserve old history without supplying any new history itself.
export function isHistoryDocument(proposal){
 if(typeof proposal?.historyDocument==='boolean')return proposal.historyDocument;
 const summary=String(proposal?.sourceSummary||'').replace(/\bno (?:new )?(?:past medical history|medical history|patient history) (?:was )?(?:provided|included|supplied|available)\b/gi,'');
 return /\b(?:past medical history|medical history|patient history|typed history|admission (?:note|history|assessment)|discharge summary|consult(?:ation)? (?:note|report|history))\b/i.test(summary);
}
export async function savedHistoryImport(context,datasetId,root){
 const matches=[];
 for(const source of context?.sourceDocuments||[]){
  if(!source.retained||!source.path?.startsWith('extracted/')||!Number.isFinite(Date.parse(source.importedAt))||!/^[a-f0-9-]{36}$/.test(source.intakeId||''))continue;
  let job;try{job=JSON.parse(await readFile(path.join(root,'Intake jobs','intake-'+source.intakeId+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)continue;throw e;}
  if(job.id!==source.intakeId||job.status!=='accepted'||job.datasetId!==datasetId||job.phn!==context.patient?.phn||!job.files?.some(f=>f.sha256===source.sha256)||!isHistoryDocument(job.proposal))continue;
  matches.push({importedAt:source.importedAt,sourceName:source.originalName||'Patient history',intakeId:source.intakeId});
 }
 return matches.sort((a,b)=>b.importedAt.localeCompare(a.importedAt))[0]||null;
}
