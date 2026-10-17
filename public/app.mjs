import {billingUI} from './billing-ui.mjs';
import {notesUI} from './notes-ui.mjs';
import {patientsUI} from './patients-ui.mjs';
import {Session} from './session.mjs';

const $=id=>document.getElementById(id);
let billing,notes,patients,session,section='billing';
const lastTab={billing:'billing',notes:'rounds',settings:'settings'};
function showSection(value){
  section=value;
  $('patients-workspace').hidden=value!=='patients';
  document.querySelector('.shell').hidden=value==='patients';
  document.querySelectorAll('[data-section]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.section===value)));
  document.querySelectorAll('.sidebar .nav').forEach(b=>{
    const group=['rounds','notes'].includes(b.dataset.tab)?'notes':b.dataset.tab==='settings'?'settings':'billing';
    b.hidden=group!==value;
  });
  $('calendar').hidden=value==='settings';
  $('header-billing-date').hidden=['patients','settings'].includes(value);
  $('header-billing-date').querySelector('small').textContent=value==='notes'?'Visit date':'Billing for';
  document.querySelector('.version').hidden=value!=='billing';
}
function navigate(tab){
  const group=['rounds','notes'].includes(tab)?'notes':tab==='settings'?'settings':'billing';
  lastTab[group]=tab;showSection(group);
}
function status(){
  if(!session||!billing)return;
  const states=session.state(),pending=states.filter(s=>s.dirty),errors=states.filter(s=>s.error),busy=session.saving||states.some(s=>s.busy);
  const unfinished=patients?.state().draft;
  if(pending.length&&!session.saving&&session.message&&!session.message.includes('Remaining changes'))session.message='';
  $('local-changes').textContent=errors.length?'! '+errors.map(s=>s.name).join(', ')+' need attention':pending.length?'● '+pending.map(s=>s.name).join(', ')+' pending':busy?'◌ Saving locally…':unfinished?'● Patient form in progress':'✓ No local changes';
  $('local-changes').dataset.state=errors.length?'error':pending.length||unfinished?'pending':'ok';
  $('sync').textContent=session.saving?'◌ Saving session…':'Save to Drive';
  $('sync').disabled=busy||!pending.length;
  $('sync').dataset.state=session.saving?'busy':pending.length?'pending':'quiet';
  $('changes-save').disabled=$('sync').disabled;
  $('changes-save').textContent='Save to Drive';
  $('saved-time').textContent=pending.length?'Not yet saved to Drive':billing.state().adapter?.mode==='local'?'Drive folder · cloud sync unverified':'Matches last Drive save';
  $('save-status').textContent=pending.length?'Saved locally · pending Save to Drive':busy?'Saving locally…':'Saved · '+$('saved-time').textContent;
  if($('changes-dialog').open){
    let overview=$('session-changes');
    if(!overview){overview=document.createElement('p');overview.id='session-changes';$('changes-title').after(overview);}
    overview.textContent=states.map(s=>`${s.name}: ${s.error?'needs attention':s.dirty?'local changes pending':s.ready?'saved':'not connected'}`).join(' · ');
  }
  $('changes-discard').textContent='Discard local billing changes';
  $('session-status').textContent=session.message||(unfinished?'Patient form in progress. Finish Add patient or Save row to include it in the session.':'');
  document.querySelector('.shell').inert=session.saving;
  $('patients-workspace').inert=session.saving;
  document.querySelector('.app-sections').inert=session.saving;
  $('lock').disabled=busy;
}
async function saveSession(){try{await session.save();billing.notify('');}catch(e){billing.notify(e.message);}finally{status();}}
async function start(){
  patients=await patientsUI({host:$('patients-workspace'),onChange:status,onRoster:raw=>billing?.setRoster(raw)});
  notes=notesUI({state:()=>billing?.state()||{date:new Date().toISOString().slice(0,10),people:[]},reconcileBilling:(...args)=>billing.recordRoutine(...args),switchTab:tab=>billing.switchTab(tab),onStatus:status});
  billing=billingUI({patients,notes,onStatus:status,onNavigate:navigate,onConnected:()=>{showSection(section);status();},saveSession});
  session=new Session([
    {name:'Patients',state:patients.state,save:patients.save},
    {name:'Notes',state:notes.status,save:notes.save},
    {name:'Billing',state:billing.status,save:billing.save}
  ],status);
  document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{
    session.message='';
    if(b.dataset.section==='patients')showSection('patients');else billing.switchTab(lastTab[b.dataset.section]);
    status();
  });
  $('patients-print-close').onclick=()=>$('patients-print-dialog').close();
  $('patients-print').onclick=()=>{$('patients-print-frame').contentWindow.focus();$('patients-print-frame').contentWindow.print();};
  window.addEventListener('beforeunload',e=>{if(patients.hasChanges()){e.preventDefault();e.returnValue='';}});
  showSection('billing');billing.start();
}
start().catch(e=>{$('gate').hidden=false;$('workspace').hidden=true;$('gate').querySelector('h1').textContent='TRIM could not start';const p=document.createElement('p');p.textContent=e.message;$('gate').querySelector('.gate-card').append(p);});
