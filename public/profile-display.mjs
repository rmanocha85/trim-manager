// A display projection only. The individual patient context remains authoritative.
export function profileDisplay(context){
 const summary=String(context?.summaryMarkdown||''),lines=summary.split(/\r?\n/);
 const evidence=lines.filter(l=>!/^[#\s]*$/.test(l)&&!/^#+\s/.test(l)&&(/\bMOST\b/.test(l)||/\b(?:DNA?CPR|DNR)\s+[CM][123]\b/.test(l)));
 const tokens=evidence.flatMap(l=>[...l.matchAll(/\b(?:(DNACPR|DNR|CPR)\s+)?([CM][123])\b/g)].map(m=>m[1]?m[1]+' '+m[2]:m[2]));
 const statuses=[...new Set(tokens.map(t=>t.replace(/^DNR /,'DNACPR ')))];
 // Never pick an apparent latest order from narrative chronology or a proposed change.
 const review=statuses.length>1||evidence.some(l=>/conflict|reconcil|propos|considered|discussed|possible|planned|pending|unfilled|blank|unclear/i.test(l));
 const dob=context?.patient?.dateOfBirth||context?.dateOfBirth||summary.match(/\b(?:DOB|Date of birth)\s*:\s*(\d{4}-\d{2}-\d{2})\b/i)?.[1]||'';
 return {dateOfBirth:dob,mostStatus:review?'Review':statuses[0]||'',mostEvidence:evidence.join('\n'),sourceUpdatedAt:context?.updatedAt||''};
}
let profiles={};
export function setProfileDisplay(value){profiles=value?.patients||{};}
export function withProfile(p){const c=profiles[String(p.phn||'').replace(/\D/g,'')]||{};return {...p,dateOfBirth:p.dateOfBirth||p.dob||c.dateOfBirth||'',mostStatus:p.mostStatus||c.mostStatus||'',mostEvidence:p.mostStatus?'Roster entry':c.mostEvidence||''};}
