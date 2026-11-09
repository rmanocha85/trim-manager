import {refreshIdentities} from './patient-identity.mjs?v=20261105-flags1';
import {documentIntakeUI} from './intake-ui.mjs?v=20261108-oat1';
import {billingUI} from './billing-ui.mjs?v=20261107-workflow1';
import {patientsUI} from './patients-ui.mjs?v=20261107-workflow1';
import {Session,saveIndicator} from './session.mjs?v=20261107-workflow1';
import {clinicRosterUI} from './clinic-roster.mjs?v=20261108-oat1';
import {MaidRepository} from './clinic-roster-repository.mjs?v=20261108-planning1';
import {OatRepository} from './oat-roster-repository.mjs?v=20261108-oat1';
import {laptopRuntime,localNotesPlaceholder,CLOUD_URL,LAPTOP_URL} from './runtime.mjs';

const $=id=>document.getElementById(id);
let billing,notes,patients,session,intake,maidRoster,maidRepository,maidSnapshot,maidPending,maidLoad=0,section='billing';
let oatRoster,oatRepository,oatPending,oatLoad=0;
async function refreshOat(){
  const adapter=intake?.recordsConnection?.()||billing?.state().adapter;
  if(!adapter){oatRoster.error('Connect your workspace, then reload OAT FH.');return;}
  if(oatPending?.adapter===adapter)return oatPending.promise;
  const preserve=oatRepository?.adapter===adapter,version=++oatLoad,repository=new OatRepository(adapter);
  oatRepository=repository;oatRoster.loading({preserve});
  const pending={adapter};oatPending=pending;
  pending.promise=(async()=>{
    let timeout;
    try{
      const data=await Promise.race([repository.load(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('OAT FH took too long to load. Check your connection and reload OAT FH.')),30000);})]);
      if(version===oatLoad)oatRoster.setPatients(data.roster.patients);
    }catch(error){
      if(version===oatLoad){
        const needsAccess=adapter.mode==='cloud'&&[401,403,404].includes(error.status);
        if(adapter.mode==='cloud')intake?.offerConnection?.();
        oatRoster.error(needsAccess?'Connect patient records to load or renew access to the OAT FH roster, then reload OAT FH. You can also use the laptop app.':error.message);
      }
    }finally{clearTimeout(timeout);if(oatPending===pending)oatPending=null;}
  })();
  return pending.promise;
}
function refreshClinics(){return Promise.all([refreshMaid(),refreshOat()]);}
async function refreshMaid(){
  if(maidRoster?.state().busy)return;
  const adapter=intake?.recordsConnection?.()||billing?.state().adapter;
  if(!adapter){maidRoster.error('Connect your workspace, then reload MAID.');return;}
  if(maidPending?.adapter===adapter)return maidPending.promise;
  const preserve=maidRepository?.adapter===adapter,version=++maidLoad,repository=new MaidRepository(adapter);
  maidSnapshot=null;maidRepository=repository;
  maidRoster.loading({preserve});
  const pending={adapter};maidPending=pending;
  pending.promise=(async()=>{
    let timeout;
    try{const data=await Promise.race([repository.load(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('MAID took too long to load. Check your connection and reload MAID.')),30000);})]);if(version===maidLoad){maidSnapshot=data;maidRoster.setPatients(data.roster.patients);}}
    catch(error){if(version===maidLoad){const needsAccess=adapter.mode==='cloud'&&[401,403,404].includes(error.status);if(needsAccess)intake?.offerConnection?.();maidRoster.error(needsAccess?'Connect patient records to load or renew access to the existing MAID roster, then reload MAID. You can also use the laptop app.':error.message);}}
    finally{clearTimeout(timeout);if(maidPending===pending)maidPending=null;}
  })();
  return pending.promise;
}
const lastTab={billing:'billing',notes:'rounds',settings:'settings'};
function showSection(value){
  section=value;
  const clinic=['maid','oat-fh'].includes(value);
  $('patients-workspace').hidden=value!=='patients';
  $('maid-workspace').hidden=value!=='maid';
  $('oat-fh-workspace').hidden=value!=='oat-fh';
  document.querySelector('.shell').hidden=value==='patients'||clinic;
  document.querySelectorAll('[data-section]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.section===value)));
  document.querySelectorAll('.sidebar .nav').forEach(b=>{
    const group=['rounds','notes'].includes(b.dataset.tab)?'notes':b.dataset.tab==='settings'?'settings':'billing';
    b.hidden=group!==value;
  });
  const history=value==='billing'&&lastTab.billing==='history';
  $('calendar').hidden=history||value==='settings'||value==='notes'&&!laptopRuntime();
  $('header-billing-date').hidden=history||clinic||['patients','settings'].includes(value)||value==='notes'&&!laptopRuntime();
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
  const connection=billing.connectionStatus();
  if(session.lastError&&!busy&&!pending.length&&!errors.length&&connection.connected){session.lastError='';session.message='';}
  const indicator=saveIndicator({states,session,unfinished,connection});
  $('local-changes').textContent=indicator.label;
  $('local-changes').dataset.state=indicator.state;
  $('local-changes').title=indicator.detail;
  $('sync').textContent=session.saving?'Saving…':session.lastError?'Retry save':'Save to Drive';
  $('sync').disabled=busy||!pending.length;
  $('sync').dataset.state=session.saving?'busy':pending.length?'pending':'quiet';
  $('changes-save').disabled=$('sync').disabled;
  $('changes-save').textContent=$('sync').textContent;
  $('saved-time').textContent=indicator.time;
  $('save-status').textContent=indicator.label;
  if($('changes-dialog').open){const tools=document.querySelector('.patient-review-tools');if(tools)tools.hidden=!patients.state().dirty&&!patients.state().error;
    let overview=$('session-changes');
    if(!overview){overview=document.createElement('p');overview.id='session-changes';$('changes-title').after(overview);}
    overview.hidden=true;overview.textContent=states.map(s=>`${s.name}: ${s.error?'needs attention':s.dirty?'local changes pending':s.ready?'saved':'not connected'}`).join(' · ');
  }
  $('changes-discard').textContent='Discard local billing changes';
  $('session-status').textContent=session.message||indicator.detail;
  document.querySelector('.shell').inert=session.saving;
  $('patients-workspace').inert=session.saving;
  document.querySelector('.app-sections').inert=session.saving;
  document.querySelector('.app-utility').inert=session.saving;
  $('lock').disabled=busy;
  if($('load-latest'))$('load-latest').disabled=busy||!billing.state().adapter||!navigator.onLine;
}
async function saveSession(){try{await session.save();billing.notify('');if(!session.state().some(s=>s.dirty||s.error||s.busy)&&!patients.state().draft&&$('changes-dialog').open)$('changes-dialog').close();}catch(e){if(patients.state().error)showSection('patients');session.lastError=e.message;if(!session.message)session.message=e.message;billing.notify('');}finally{status();}}
async function start(){
  maidRoster=clinicRosterUI({host:$('maid-workspace'),kind:'maid',onChange:status,onReload:refreshMaid,onAction:async action=>{
    if(!maidSnapshot||!maidRepository)throw new Error('Reload MAID before editing.');
    const saved=await maidRepository.mutate(action,maidSnapshot);maidSnapshot=saved;
    return {patients:saved.roster.patients,local:maidRepository.adapter.mode==='local'};
  }});
  oatRoster=clinicRosterUI({host:$('oat-fh-workspace'),kind:'oat-fh',onReload:refreshOat});
  patients=await patientsUI({host:$('patients-workspace'),onChange:status,onFocus:p=>{if(notes?.openFocus)void notes.openFocus('phn:'+String(p.phn).replace(/\D/g,'')).catch(e=>billing.notify(e.message));else billing.notify('Open the laptop app to edit routine focus.');},onUpload:p=>{void intake.open(p).catch(e=>billing.notify(e.message));},onRoster:raw=>billing?.setRoster(raw),onSaved:async raw=>{if(notes?.ensureRoster)await notes.ensureRoster(raw);}});
  const laptop=laptopRuntime();
  notes=laptop?(await import('./notes-ui.mjs?v=20261108-units1')).notesUI({state:()=>billing?.state()||{date:new Date().toISOString().slice(0,10),people:[]},reconcileBilling:(...args)=>billing.recordRoutine(...args),switchTab:tab=>billing.switchTab(tab),onStatus:status}):localNotesPlaceholder();
  billing=billingUI({patients,notes,onStatus:status,onNavigate:navigate,onPatientConflict:()=>showSection('patients'),onConnected:()=>{void refreshClinics();void intake.profiles();const wanted=new URLSearchParams(location.search).get('section');if(wanted==='notes')billing.switchTab('rounds');else showSection(['maid','oat-fh'].includes(wanted)?wanted:section);status();},saveSession});
  intake=documentIntakeUI({state:()=>billing.state(),notes,onRecordsConnected:refreshClinics,onProfiles:()=>{refreshIdentities(document);refreshIdentities($('patients-workspace').shadowRoot); }});
  session=new Session([
    {name:'Roster',state:patients.state,save:patients.save},
    {name:'MAID',state:maidRoster.state,save:async()=>{}},
    ...(laptop?[{name:'Notes',state:notes.status,save:notes.save}]:[]),
    {name:'Billing',state:billing.status,save:billing.save}
  ],status);
  const latest=document.createElement('button');latest.id='load-latest';latest.className='save-control';latest.textContent='Load latest changes';$('drive-connection').after(latest);
  latest.onclick=async()=>{try{session.message='';await billing.loadLatest();await refreshClinics();if(!session.state().some(s=>s.dirty||s.error)){session.lastError='';session.message='';}}catch(e){billing.notify(e.message);}finally{status();}};
  const patientReview=document.createElement('div');patientReview.className='actions patient-review-tools';patientReview.innerHTML='<button id="review-patient-changes">Review patient changes</button><button id="reload-patient-changes">Reload saved roster</button>';$('changes-list').before(patientReview);
  $('review-patient-changes').onclick=async()=>{$('changes-dialog').close();showSection('patients');session.message='';try{await patients.refresh(true);}catch(e){billing.notify(e.message);}status();};
  $('reload-patient-changes').onclick=async()=>{$('changes-dialog').close();session.message='';try{await patients.reload();if(!session.state().some(s=>s.dirty||s.error)){session.lastError='';session.message='';}}catch(e){billing.notify(e.message);}status();};
  if(!laptop)document.querySelector('[data-section="notes"]').title='Notes runs on your laptop';
  const switcher=document.createElement('button');switcher.id='switch-version';switcher.textContent=laptop?'Open cloud app':'Open laptop app';switcher.className='text-button';
  const switching=document.createElement('dialog');switching.id='switch-version-dialog';switching.innerHTML='<div class="dialog-body"><h2>Switch TRIM versions</h2><p id="switch-version-message"></p><a id="switch-version-link" target="_blank" rel="noopener">'+(laptop?'Open cloud TRIM ↗':'Open laptop TRIM ↗')+'</a><button id="switch-version-connect" hidden>Connect through Google</button><button id="switch-version-close">Close</button></div>';document.body.append(switching);document.querySelector('.header-actions').append(switcher);
  switcher.onclick=()=>{const dirty=session.state().some(s=>s.dirty||s.busy||s.error)||patients.state().draft,folder=laptop&&billing.state().adapter?.mode==='local';$('switch-version-message').textContent=dirty?'Save your session to Drive before switching. Your local drafts stay here.':folder?'This connection saves to the laptop’s Drive folder. Connect through Google and verify the saved version before switching.':'Your session is saved. Connect through Google in the other version to load the latest Drive records. Local drafts stay in this browser.';const link=$('switch-version-link');link.hidden=dirty||folder;link.href=laptop?CLOUD_URL:LAPTOP_URL;$('switch-version-connect').hidden=dirty||!folder;switching.showModal();};$('switch-version-close').onclick=()=>switching.close();$('switch-version-connect').onclick=()=>{switching.close();billing.chooseConnection();};
  if(!laptop)$('open-laptop-notes').onclick=e=>{if(session.state().some(s=>s.dirty||s.busy||s.error)||patients.state().draft){e.preventDefault();switcher.click();}};
  document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{
    session.message='';
    if(['patients','maid','oat-fh'].includes(b.dataset.section))showSection(b.dataset.section);else billing.switchTab(lastTab[b.dataset.section]);
    if(b.dataset.section==='maid')void refreshMaid();
    if(b.dataset.section==='oat-fh')void refreshOat();
    status();
  });
  $('patients-print-close').onclick=()=>$('patients-print-dialog').close();
  $('patients-print').onclick=()=>{$('patients-print-frame').contentWindow.focus();$('patients-print-frame').contentWindow.print();};
  window.addEventListener('beforeunload',e=>{if(patients.hasChanges()){e.preventDefault();e.returnValue='';}});
  setInterval(()=>{if(document.visibilityState!=='visible')return;if(section==='maid'&&!maidRoster.state().busy)void refreshMaid();if(section==='oat-fh')void refreshOat();},60000);
  showSection('billing');billing.start();
}
start().catch(e=>{$('gate').hidden=false;$('workspace').hidden=true;$('gate').querySelector('h1').textContent='TRIM could not start';const p=document.createElement('p');p.textContent=e.message;$('gate').querySelector('.gate-card').append(p);});
