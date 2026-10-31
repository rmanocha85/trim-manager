import {normalizeMost,latestDocumentedMost} from './most-designations.mjs';
// A display projection only. The individual patient context remains authoritative.
export function profileDisplay(context){
 const summary=String(context?.summaryMarkdown||''),lines=summary.split(/\r?\n/);
 const evidence=lines.filter(l=>!/^[#\s]*$/.test(l)&&!/^#+\s/.test(l)&&(/\bMOST\b/i.test(l)||/\b(?:DNA?\s*CPR|DNR)\s+[CM][123]\b/i.test(l)));
 const candidate=latestDocumentedMost(evidence),confirmed=context?.currentMost;
 const confirmationStatus=confirmed?.source==='physician'&&/^\d{4}-\d{2}-\d{2}$/.test(confirmed.confirmedOn||'')?normalizeMost(confirmed.designation):'';
 const designation=confirmationStatus||candidate.designation;
 const pending=!confirmationStatus&&(candidate.pending||evidence.some(l=>/review|conflict|reconcil|propos|possible|pending|unfilled|blank|unclear|not supplied/i.test(l)));
 const confirmation=confirmationStatus?'Physician confirmed '+confirmationStatus+' on '+confirmed.confirmedOn+'.':'';
 const review=pending?'Pending review.'+(candidate.ambiguous?' The latest designation cannot be established from the conflicting undated entries.':''):'';
 const dob=context?.patient?.dateOfBirth||context?.dateOfBirth||summary.match(/\b(?:DOB|Date of birth)\s*:\s*(\d{4}-\d{2}-\d{2})\b/i)?.[1]||'';
 return {dateOfBirth:dob,mostStatus:designation,mostEvidence:[confirmation,review,...evidence].filter(Boolean).join('\n'),sourceUpdatedAt:context?.updatedAt||''};
}
let profiles={};
export function setProfileDisplay(value){profiles=value?.patients||{};}
export function withProfile(p){const c=profiles[String(p.phn||'').replace(/\D/g,'')]||{};const roster=normalizeMost(p.mostStatus);return {...p,dateOfBirth:p.dateOfBirth||p.dob||c.dateOfBirth||'',mostStatus:roster||normalizeMost(c.mostStatus),mostEvidence:[p.mostStatus?'Roster entry: '+p.mostStatus:'',p.mostStatus&&!roster?'Pending review: roster designation is incomplete.':'',c.mostEvidence].filter(Boolean).join('\n')};}
