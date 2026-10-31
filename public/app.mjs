import {refreshIdentities} from './patient-identity.mjs?v=20261031-compact1';
import {documentIntakeUI} from './intake-ui.mjs?v=20261031-compact1';
import {billingUI} from './billing-ui.mjs?v=20261031-compact1';
import {patientsUI} from './patients-ui.mjs?v=20261031-compact1';
import {Session} from './session.mjs';
import {laptopRuntime,localNotesPlaceholder,CLOUD_URL,LAPTOP_URL} from './runtime.mjs';

const $=id=>document.getElementById(id);
let billing,notes,patients,session,intake,section='billing';
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
  const history=value==='billing'&&lastTab.billing==='history';
  $('calendar').hidden=history||value==='settings'||value==='notes'&&!laptopRuntime();
  $('header-billing-date').hidden=history||['patients','settings'].includes(value)||value==='notes'&&!laptopRuntime();
  $('header-billing-date').querySelector('small').textContent=value==='notes'?'Visit date':'Billing for';
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
  if($('changes-dialog').open){const tools=document.querySelector('.patient-review-tools');if(tools)tools.hidden=!patients.state().dirty&&!patients.state().error;
    let overview=$('session-changes');
    if(!overview){overview=document.createElement('p');overview.id='session-changes';$('changes-title').after(overview);}
    overview.hidden=true;overview.textContent=states.map(s=>`${s.name}: ${s.error?'needs attention':s.dirty?'local changes pending':s.ready?'saved':'not connected'}`).join(' · ');
  }
  $('changes-discard').textContent='Discard local billing changes';
  $('session-status').textContent=session.message||(unfinished?'Patient form in progress. Finish Add patient or Save row to include it in the session.':'');
  document.querySelector('.shell').inert=session.saving;
  $('patients-workspace').inert=session.saving;
  document.querySelector('.app-sections').inert=session.saving;
  document.querySelector('.app-utility').inert=session.saving;
  $('lock').disabled=busy;
  if($('load-latest'))$('load-latest').disabled=busy||!billing.state().adapter||!navigator.onLine;
}
async function saveSession(){try{await session.save();billing.notify('');if(!session.state().some(s=>s.dirty||s.error||s.busy)&&!patients.state().draft&&$('changes-dialog').open)$('changes-dialog').close();}catch(e){if(patients.state().error)showSection('patients');billing.notify(e.message);}finally{status();}}
async function start(){
  patients=await patientsUI({host:$('patients-workspace'),onChange:status,onUpload:p=>{void intake.open(p).catch(e=>billing.notify(e.message));},onRoster:raw=>billing?.setRoster(raw),onSaved:async raw=>{if(notes?.ensureRoster)await notes.ensureRoster(raw);}});
  const laptop=laptopRuntime();
  notes=laptop?(await import('./notes-ui.mjs?v=20261031-compact1')).notesUI({state:()=>billing?.state()||{date:new Date().toISOString().slice(0,10),people:[]},reconcileBilling:(...args)=>billing.recordRoutine(...args),switchTab:tab=>billing.switchTab(tab),onStatus:status}):localNotesPlaceholder();
  billing=billingUI({patients,notes,onStatus:status,onNavigate:navigate,onPatientConflict:()=>showSection('patients'),onConnected:()=>{void intake.profiles();const wanted=new URLSearchParams(location.search).get('section');if(wanted==='notes')billing.switchTab('rounds');else showSection(section);status();},saveSession});
  intake=documentIntakeUI({state:()=>billing.state(),notes,onProfiles:()=>{refreshIdentities(document);refreshIdentities($('patients-workspace').shadowRoot); }});
  session=new Session([
    {name:'Roster',state:patients.state,save:patients.save},
    ...(laptop?[{name:'Notes',state:notes.status,save:notes.save}]:[]),
    {name:'Billing',state:billing.status,save:billing.save}
  ],status);
  const latest=document.createElement('button');latest.id='load-latest';latest.className='save-control';latest.textContent='Load latest changes';$('drive-connection').after(latest);
  latest.onclick=async()=>{try{session.message='';await billing.loadLatest();}catch(e){billing.notify(e.message);}finally{status();}};
  const patientReview=document.createElement('div');patientReview.className='actions patient-review-tools';patientReview.innerHTML='<button id="review-patient-changes">Review patient changes</button><button id="reload-patient-changes">Reload saved roster</button>';$('changes-list').before(patientReview);
  $('review-patient-changes').onclick=async()=>{$('changes-dialog').close();showSection('patients');session.message='';try{await patients.refresh(true);}catch(e){billing.notify(e.message);}status();};
  $('reload-patient-changes').onclick=async()=>{$('changes-dialog').close();session.message='';try{await patients.reload();}catch(e){billing.notify(e.message);}status();};
  if(!laptop)document.querySelector('[data-section="notes"]').title='Notes runs on your laptop';
  const switcher=document.createElement('button');switcher.id='switch-version';switcher.textContent=laptop?'Open cloud app':'Open laptop app';switcher.className='text-button';
  const switching=document.createElement('dialog');switching.id='switch-version-dialog';switching.innerHTML='<div class="dialog-body"><h2>Switch TRIM versions</h2><p id="switch-version-message"></p><a id="switch-version-link" target="_blank" rel="noopener">'+(laptop?'Open cloud TRIM ↗':'Open laptop TRIM ↗')+'</a><button id="switch-version-connect" hidden>Connect through Google</button><button id="switch-version-close">Close</button></div>';document.body.append(switching);document.querySelector('.header-actions').append(switcher);
  switcher.onclick=()=>{const dirty=session.state().some(s=>s.dirty||s.busy||s.error)||patients.state().draft,folder=laptop&&billing.state().adapter?.mode==='local';$('switch-version-message').textContent=dirty?'Save your session to Drive before switching. Your local drafts stay here.':folder?'This connection saves to the laptop’s Drive folder. Connect through Google and verify the saved version before switching.':'Your session is saved. Connect through Google in the other version to load the latest Drive records. Local drafts stay in this browser.';const link=$('switch-version-link');link.hidden=dirty||folder;link.href=laptop?CLOUD_URL:LAPTOP_URL;$('switch-version-connect').hidden=dirty||!folder;switching.showModal();};$('switch-version-close').onclick=()=>switching.close();$('switch-version-connect').onclick=()=>{switching.close();billing.chooseConnection();};
  if(!laptop)$('open-laptop-notes').onclick=e=>{if(session.state().some(s=>s.dirty||s.busy||s.error)||patients.state().draft){e.preventDefault();switcher.click();}};
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
