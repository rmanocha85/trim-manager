import {hasActiveIssue} from './patients-core.mjs';

// Physician-confirmed nursing assignments, November 20, 2026.
export const NURSING_FLOORS=Object.freeze({CEDAR:1,CHERRY:1,FERN:2,HATZIC:2,DEWDNEY:2,DEROCHE:2,SILVER:3,STAVE:3});
const unitName=value=>String(value||'').trim().toUpperCase();
export function messageName(value){
  const name=String(value||'').trim();
  const comma=name.indexOf(',');
  return comma<0?name:[name.slice(comma+1).trim(),name.slice(0,comma).trim()].filter(Boolean).join(' ');
}
export function nurseText(rows){
  if(!rows.length)return '';
  return 'Hey, could you update me on these patients?\n\n'+rows.map(p=>`${p.name} (${p.unit}, Floor ${p.floor})${p.issue?' - '+p.issue:''} - Could you provide a clinical update?`).join('\n\n')+'\n\nThanks!\n- Dr Manocha';
}
export function individualNurseText(patient){
  const issue=hasActiveIssue(patient)?patient.activeIssue.description.trim():'';
  return messageName(patient.name)+(issue?' - '+issue:'')+' - Could you provide a clinical update?';
}
export function nurseMessages(roster,scope='all'){
  const units=new Map((roster.units||[]).map(u=>[u.id,unitName(u.name)]));
  const source=scope==='patients'?roster.patients:scope==='otherPatients'?roster.otherPatients:[...roster.patients||[],...roster.otherPatients||[]];
  const people=new Map();
  for(const [index,p] of (source||[]).entries()){
    const digits=String(p.phn||'').replace(/\D/g,'');
    const key=digits.length===10?'phn:'+digits:p.ava?'ava:'+p.ava:p.id!=null?'id:'+p.id:'row:'+index;
    const unit=units.get(p.unit)||unitName(p.unit),knownId=unitName(p.unit);
    const conflictingUnit=Boolean(NURSING_FLOORS[knownId]&&NURSING_FLOORS[unit]&&knownId!==unit);
    const entry=people.get(key)||{name:messageName(p.name)||'Name not recorded',locations:new Set(),issues:new Set(),active:false,conflictingUnit:false};
    if(hasActiveIssue(p))entry.issues.add(p.activeIssue.description.trim());
    entry.active ||= hasActiveIssue(p);entry.conflictingUnit ||= conflictingUnit;entry.locations.add(unit);
    people.set(key,entry);
  }
  const groups=[{id:'floors-1-3',label:'Floors 1 + 3',rows:[]},{id:'floor-2',label:'Floor 2',rows:[]}],unassigned=[];
  for(const entry of people.values()){
    if(!entry.active)continue;
    const [unit]=entry.locations,floor=NURSING_FLOORS[unit];
    if(entry.conflictingUnit||entry.locations.size!==1||!floor){
      unassigned.push({name:entry.name,location:[...entry.locations].map(u=>u||'Not recorded').join(' / '),reason:entry.conflictingUnit||entry.locations.size>1?'Conflicting unit records':'Nursing floor not assigned'});continue;
    }
    groups[floor===2?1:0].rows.push({name:entry.name,unit,floor,issue:[...entry.issues].join('; ')});
  }
  for(const group of groups){group.rows.sort((a,b)=>a.floor-b.floor||a.unit.localeCompare(b.unit)||a.name.localeCompare(b.name));group.text=nurseText(group.rows);}
  unassigned.sort((a,b)=>a.name.localeCompare(b.name));
  return {groups,unassigned,total:groups.reduce((n,g)=>n+g.rows.length,0)+unassigned.length};
}
