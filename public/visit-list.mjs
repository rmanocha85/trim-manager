import {hasActiveIssue} from './patients-core.mjs';
export function visitList(roster,scope='all'){
  const units=new Map((roster.units||[]).map(u=>[u.id,u.name]));
  const source=scope==='patients'?roster.patients:scope==='otherPatients'?roster.otherPatients:[...roster.patients||[],...roster.otherPatients||[]];
  const seen=new Map();
  for(const p of source||[]){
    const unit=units.get(p.unit)||p.unit||'',active=hasActiveIssue(p),adp=/^adp$/i.test(String(unit).trim())||/^adp$/i.test(String(p.unit).trim());
    if(!active&&!adp)continue;
    const digits=String(p.phn||'').replace(/\D/g,''),key=digits.length===10?'phn:'+digits:p.ava?'ava:'+p.ava:'id:'+p.id;
    const existing=seen.get(key),note=active?String(p.activeIssue.description||'').trim():'';
    if(existing){existing.active ||= active;if(note&&!existing.notes.includes(note))existing.notes.push(note);continue;}
    seen.set(key,{name:p.name||'Name not recorded',location:[unit,p.room&&'room '+p.room].filter(Boolean).join(' · ')||'Location not recorded',active,notes:note?[note]:[]});
  }
  const rows=[...seen.values()].sort((a,b)=>Number(b.active)-Number(a.active)||a.location.localeCompare(b.location,undefined,{numeric:true})||a.name.localeCompare(b.name));
  const label=scope==='patients'?'My Patients':scope==='otherPatients'?'Other Patients':'All patients';
  const text='TRIM — Active issues + ADP ('+label+')\n'+(rows.length?rows.map(p=>'• '+p.name+' — '+p.location+(p.notes.length?'\n  '+p.notes.join('\n  '):'')).join('\n\n'):'No patients in this list.');
  return {rows,text};
}
