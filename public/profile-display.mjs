import {normalizeMost,latestDocumentedMost} from './most-designations.mjs?v=20261116-most2';
// A display projection only. The individual patient context remains authoritative.
export function legacyMost(context){
 const summary=String(context?.summaryMarkdown||''),lines=summary.split(/\r?\n/);
 let goalsSection=false;
 const evidence=[];
 for(const line of lines){
   const heading=line.match(/^\s*#{1,6}\s+(.+)/);
   if(heading)goalsSection=/^(?:MOST\b|goals\b|code status\b|resuscitation\b|advance care planning\b)/i.test(heading[1]);
   const explicit=/\bMOST\b|\b(?:DNA?\s*CPR|DNR|CPR)\s+[CM][123]\b/i.test(line);
   const goalsCode=goalsSection&&/\b[CM][123]\b/i.test(line)&&!/\b(?:vertebra|cervical|fracture|stenosis|spinal)\w*\b/i.test(line);
   if((explicit||goalsCode)&&(!heading||/\b[CM][123]\b/i.test(line)))evidence.push(line);
 }
 const candidate=latestDocumentedMost(evidence),confirmed=context?.currentMost;
 const confirmationStatus=confirmed?.source==='physician'&&/^\d{4}-\d{2}-\d{2}$/.test(confirmed.confirmedOn||'')?normalizeMost(confirmed.designation):'';
 const designation=confirmationStatus||candidate.designation;
 const pending=!confirmationStatus&&(candidate.pending||evidence.some(l=>/review|conflict|reconcil|propos|possible|pending|unfilled|blank|unclear|not supplied/i.test(l)));
 const confirmation=confirmationStatus?'Physician confirmed '+confirmationStatus+' on '+confirmed.confirmedOn+'.':'';
 const review=pending?'Pending review.'+(candidate.ambiguous?' The latest designation cannot be established from the conflicting undated entries.':''):'';
 return {mostStatus:designation,mostEvidence:[confirmation,review,...evidence].filter(Boolean).join('\n')};
}
export function profileDisplay(context,historyImport=null){
 const summary=String(context?.summaryMarkdown||'');
 const dob=context?.patient?.dateOfBirth||context?.dateOfBirth||summary.match(/\b(?:DOB|Date of birth)\s*:\s*(\d{4}-\d{2}-\d{2})\b/i)?.[1]||'';
 return {dateOfBirth:dob,structuredMost:Object.hasOwn(context||{},'mostStatus'),mostStatus:normalizeMost(context?.mostStatus),mostEvidence:context?.mostSource?.evidence||'',mostReview:context?.mostReview?.reason||'',sourceUpdatedAt:context?.updatedAt||'',historyImport};
}
let profiles={};
export function setProfileDisplay(value){profiles=value?.patients||{};}
export function withProfile(p){const c=profiles[String(p.phn||'').replace(/\D/g,'')]||{};const roster=normalizeMost(p.mostStatus);return {...p,historyImport:c.historyImport||null,dateOfBirth:p.dateOfBirth||p.dob||c.dateOfBirth||'',structuredMost:c.structuredMost===true,mostStatus:c.structuredMost?normalizeMost(c.mostStatus):roster||normalizeMost(c.mostStatus),mostReview:c.mostReview||'',mostEvidence:[p.mostStatus?'Roster entry: '+p.mostStatus:'',p.mostStatus&&!roster?'Pending review: roster designation is incomplete.':'',c.mostEvidence].filter(Boolean).join('\n')};}
