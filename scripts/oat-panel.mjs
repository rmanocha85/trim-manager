// Reconcile a complete Ava clinic panel. Schedule imports never archive patients.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {OatStore} from '../oat-storage.mjs';
import {validateOatRoster} from '../public/oat-roster-repository.mjs';
import {validClinicDate} from '../public/oat-schedule.mjs';
import {phoneLink} from '../public/clinic-contacts.mjs';

function readRows(text){
  const lines=[]; let row=[],field='',quoted=false,closed=false;
  for(const ch of text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')){
    if(ch==='"'&&!quoted&&closed){field+='"';quoted=true;closed=false;continue;}
    if(ch==='"'&&quoted){quoted=false;closed=true;continue;}
    if(ch==='"'&&!field&&!closed){quoted=true;continue;}
    if(!quoted&&(ch===','||ch==='\n')){
      row.push(field);field='';closed=false;
      if(ch==='\n'){if(row.some(x=>x.trim()))lines.push(row);row=[];}
    }else{if(!quoted&&(closed||ch==='"'))throw Error('Malformed CSV field.');field+=ch;}
  }
  if(quoted)throw Error('Incomplete CSV.');
  row.push(field);if(row.some(x=>x.trim()))lines.push(row);
  return lines;
}

export function panelSource(buffer,filename,clinic){
  const prefix={'oat-fh':/^OAT (?:FH|Fraser Health)[ _-]/i,'oat-purple':/^OAT Purple[ _-]/i}[clinic];
  if(!prefix?.test(path.basename(filename)))throw Error('The export filename does not identify the selected clinic.');
  const [headers,...rows]=readRows(buffer.toString('utf8'));
  if(!headers||!rows.length||!['ID','Name','DOB'].every(h=>headers.includes(h))||new Set(headers).size!==headers.length)throw Error('A complete, non-empty Ava panel export with ID, Name and DOB is required.');
  const seen=new Set();
  const patients=rows.map((cells,i)=>{
    if(cells.length!==headers.length)throw Error('Incomplete CSV row '+(i+2));
    const row=Object.fromEntries(headers.map((k,j)=>[k,cells[j].trim()]));
    const phn=row.ID.replace(/[\s-]/g,''),name=row.Name,dob=row.DOB,ava=row['Ava ID']||null,phone=row.Phone||null;
    if(!/^\d{10}$/.test(phn)||seen.has(phn)||!name||!validClinicDate(dob)||ava&&!/^\d{6,10}$/.test(ava)||phone&&!phoneLink(phone))throw Error('Invalid or duplicate identity or invalid phone at CSV row '+(i+2)+'.');
    seen.add(phn);return {phn,name,dob,ava,phone,...(row.Age?{ageAtExport:row.Age}:{})};
  });
  return {patients,file:path.basename(filename),sha256:createHash('sha256').update(buffer).digest('hex')};
}
const nameKey=s=>s.toLowerCase().normalize('NFKC').replace(/[\s,.'’-]+/g,' ').trim();
export function reconcilePanel(original,clinic,source,asOf,prior=null){
  validateOatRoster(original,clinic);
  if(!validClinicDate(asOf)||original.panel?.asOf>asOf)throw Error('Invalid or older panel date.');
  const next=structuredClone(original),byPhn=new Map(next.patients.map(p=>[p.phn,p])),active=new Set(),ordered=[];
  function match(row){
    const p=byPhn.get(row.phn);
    if(p&&(p.dob&&p.dob!==row.dob||p.ava&&row.ava&&p.ava!==row.ava||nameKey(p.name)!==nameKey(row.name)))throw Error('A matched PHN has conflicting demographics. Review the source before applying.');
    if(!p&&next.patients.some(q=>(row.ava&&row.ava===q.ava)||(q.dob===row.dob&&nameKey(q.name)===nameKey(row.name))))throw Error('A possible identity match has a different or missing PHN. Review before applying.');
    return p;
  }
  function add(row,status){const p={...row,id:clinic+'-'+randomUUID(),status};byPhn.set(p.phn,p);next.patients.push(p);return p;}
  function status(p,value){if(p.status!==value){p.statusHistory=[...(p.statusHistory||[]),{from:p.status,to:value,date:asOf,source:source.file}];p.status=value;}}
  for(const row of source.patients){
    const p=match(row)||add(row,'active');status(p,'active');
    p.name=row.name;p.dob=row.dob;if(row.ava)p.ava=row.ava;if(row.phone)p.phone=row.phone;if(row.ageAtExport)p.ageAtExport=row.ageAtExport;
    active.add(p.id);ordered.push(p);
  }
  if(prior)for(const row of prior.patients){
    const p=match(row);
    if(!p){const old=add(row,'history');old.lastListedSource=prior.file;}
    else if(row.ava&&!p.ava)p.ava=row.ava;
  }
  for(const p of next.patients)if(!active.has(p.id)){status(p,'history');ordered.push(p);}
  next.patients=ordered;
  next.panel={asOf,file:source.file,sha256:source.sha256,recordCount:source.patients.length};
  return validateOatRoster(next,clinic);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [mode,clinic,rosterPath,csv,asOf,priorCsv]=process.argv.slice(2);
  if(!['preview','apply'].includes(mode)||!path.isAbsolute(rosterPath||'.')||path.basename(rosterPath)!==clinic+'-roster.json')throw Error('Use: preview|apply clinic absolute-roster.json complete-panel.csv YYYY-MM-DD [earlier-panel.csv]');
  const load=async f=>panelSource(await readFile(f),f,clinic);
  const store=new OatStore(rosterPath,clinic),current=await store.load();
  const source=await load(csv),prior=priorCsv?await load(priorCsv):null;
  const next=reconcilePanel(current.roster,clinic,source,asOf,prior);
  const before=new Map(current.roster.patients.map(p=>[p.id,p.status]));
  const counts={active:next.patients.filter(p=>p.status==='active').length,history:next.patients.filter(p=>p.status==='history').length,addedActive:next.patients.filter(p=>p.status==='active'&&!before.has(p.id)).length,movedToHistory:next.patients.filter(p=>p.status==='history'&&before.get(p.id)==='active').length,reactivated:next.patients.filter(p=>p.status==='active'&&before.get(p.id)==='history').length,activePhones:next.patients.filter(p=>p.status==='active'&&p.phone).length,activeCharts:next.patients.filter(p=>p.status==='active'&&p.ava).length};
  if(mode==='apply'&&JSON.stringify(next)!==JSON.stringify(current.roster)){
    next.updatedAt=new Date().toISOString();const saved=await store.update(current.etag,()=>next);
    if(JSON.stringify(saved.roster)!==JSON.stringify(next))throw Error('Readback differs.');
  }
  console.log(clinic,mode,counts);
}
