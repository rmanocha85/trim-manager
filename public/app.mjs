import {patientName} from './patient-names.mjs?v=20261127-names1';
import {refreshIdentities} from './patient-identity.mjs?v=20261127-names1';
import {documentIntakeUI,PROFILE_FILE_ID} from './intake-ui.mjs?v=20261127-names1';
import {billingUI} from './billing-ui.mjs?v=20261127-names1';
import {patientsUI} from './patients-ui.mjs?v=20261127-names1';
import {Session,saveIndicator} from './session.mjs?v=20261115-manual1';
import {clinicRosterUI} from './clinic-roster.mjs?v=20261127-names1';
import {facilityNames, facilityRoster} from './il-roster.mjs?v=20261127-names1';
import {oatWorkspaceUI} from './oat-workspace.mjs?v=20261127-names1';
import {MaidRepository} from './clinic-roster-repository.mjs?v=20261112-provision1';
import {OatRepository,oatClinics} from './oat-roster-repository.mjs?v=20261127-oat-controls1';
import {laptopRuntime,localNotesPlaceholder,CLOUD_URL,NOTES_LAUNCH_URL} from './runtime.mjs?v=20261126-il2';

if(laptopRuntime()){document.title='Work OS Notes';document.querySelector('link[rel=icon]').href='./favicon-notes.svg?v=20261126-work-os-cross';}
const $=id=>document.getElementById(id);
let billing,notes,patients,session,intake,maidRoster,maidRepository,maidSnapshot,maidPending,maidLoad=0,section='billing';
const oatViews=new Map();
let facilityView;
function createOatView(clinic){
  const {title,fileId}=oatClinics[clinic];
  let repository,pending,version=0;
  const view=oatWorkspaceUI({host:$(clinic+'-workspace'),clinic,title,onChange:status,
    onLink:()=>linkClinicFile(fileId,refresh),
    onReload:async()=>{
      try{await repository?.adapter.ensureConnected?.();await refresh();}
      catch(error){view.error(error.message);}
    },
    onSave:async action=>{
      if(!repository)throw new Error('Reload '+title+' before editing.');
      const current=repository;
      ++version;
      const saved=await current.save(action);
      return {...saved,local:current.adapter.mode==='local'};
    }
  });
  async function refresh(){
    if(view.state().busy)return;
    const adapter=intake?.recordsConnection?.()||billing?.state().adapter;
    if(!adapter){view.error('Connect your workspace, then reload '+title+'.');return;}
    if(pending?.adapter===adapter)return pending.promise;
    const preserve=repository?.adapter===adapter,requestVersion=++version;
    repository=new OatRepository(adapter,clinic);
    view.loading({preserve});
    const request={adapter};pending=request;
    request.promise=(async()=>{
      let timeout;
      try{
        const data=await Promise.race([repository.load(),new Promise((_,reject)=>{
          timeout=setTimeout(()=>reject(new Error(title+' took too long to load. Please reload.')),30000);
        })]);
        if(version===requestVersion)view.setRoster(data.roster);
      }catch(error){
        if(version!==requestVersion)return;
        if(error.code==='LINK_OAT'){view.error(error.message,{link:true});return;}
        const needsAccess=adapter.mode==='cloud'&&[401,403,404].includes(error.status);
        if(needsAccess)intake?.offerConnection?.();
        view.error(needsAccess?'Connect patient records and reload '+title+'.':error.message);
      }finally{clearTimeout(timeout);if(pending===request)pending=null;}
    })();
    return request.promise;
  }
  return {refresh,state:view.state,needsLoad:()=>!repository};
}
function refreshClinics(options){return Promise.all([facilityView.refresh(options),refreshMaid(),...Array.from(oatViews.values(),view=>view.refresh())]);}
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
    catch(error){
      if(version!==maidLoad)return;
      if(adapter.hostedAccess&&[403,404].includes(error.status)){
        maidRoster.error('Link the MAID roster to your TRIM account once to open it on your computers.',{link:true});
      }else{
        const needsAccess=adapter.mode==='cloud'&&[401,403,404].includes(error.status);
        if(needsAccess)intake?.offerConnection?.();
        maidRoster.error(needsAccess?'Reconnect patient records and reload MAID.':error.message);
      }
    }
    finally{clearTimeout(timeout);if(maidPending===pending)maidPending=null;}
  })();
  return pending.promise;
}
const lastTab={billing:'billing',notes:'rounds',settings:'settings'};
function showSection(value){
  if(section!==value)$('workspace').scrollTop=0;
  section=value;
  const facility = facilityNames.has(value);
  $('il-workspace').hidden = !facility;
  if (facility) void facilityView.load(value);
  const clinic=facility || ['maid',...oatViews.keys()].includes(value);
  const enteringPatients=value==='patients'&&$('patients-workspace').hidden;
  $('patients-workspace').hidden=value!=='patients';
  if(enteringPatients)patients?.activate();
  $('maid-workspace').hidden=value!=='maid';
  for(const id of oatViews.keys())$(id+'-workspace').hidden=value!==id;
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
  $('local-changes').disabled=!states.some(s=>s.ready)&&!pending.length&&!unfinished;
  $('local-changes').setAttribute('aria-label',indicator.label.replace(/^[^\p{L}]+/u,'')+' — review changes');
  if(pending.length||unfinished)$('local-changes').title='Review pending changes before saving';
  $('sync').textContent=session.saving?'Saving…':session.lastError?'Retry save':'Save to Drive';
  $('sync').disabled=busy||!pending.length;
  $('sync').hidden=!pending.length&&!session.saving&&!session.lastError;
  $('sync').dataset.state=session.saving?'busy':pending.length?'pending':'quiet';
  $('changes-save').disabled=$('sync').disabled;
  $('changes-save').textContent=$('sync').textContent;
  $('saved-time').textContent=indicator.time;
  $('save-status').textContent=indicator.label;
  if($('changes-dialog').open){const tools=document.querySelector('.patient-review-tools');if(tools)tools.hidden=!patients.state().dirty&&!patients.state().error;
    let overview=$('session-changes');
    if(!overview){overview=document.createElement('p');overview.id='session-changes';$('changes-title').after(overview);}
    overview.hidden=false;overview.textContent=states.filter(s=>s.dirty||s.error).map(s=>`${s.name}: ${s.error?'needs attention':'changes pending'}`).join(' · ')||(unfinished?'Patient form in progress.':'No changes waiting to save.');
    renderPendingRoster();
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
function renderPendingRoster(){
  const container=$('roster-pending-changes');if(!container)return;
  container.replaceChildren();
  const changes=patients.pendingChanges(),state=patients.state();
  container.hidden=!changes.length&&!state.dirty&&!state.draft;
  const add=(parent,tag,text,className)=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;};
  if(!container.hidden){
    add(container,'h3','Roster changes');
    for(const change of changes){
      const article=add(container,'article','','change-row roster-change');
      add(article,'strong',patientName(change.name));add(article,'p',change.kind,'hint');
      for(const field of change.fields){
        const detail=add(article,'div','','pending-field');add(detail,'h4',field.label);
        const values=add(detail,'div','','pending-values');
        const before=add(values,'div','','pending-before');add(before,'small','Saved');add(before,'p',field.before);
        const after=add(values,'div','','pending-after');add(after,'small','Pending');add(after,'p',field.after);
      }
    }
    if(state.dirty&&!changes.length)add(container,'p','A recovered roster is pending save; no field differences are available against its saved baseline.');
    if(state.draft)add(container,'p','A patient form is unfinished. Finish or cancel the form in Roster before saving.');
  }
  const notesNotice=$('pending-notes-notice');
  notesNotice.hidden=!notes?.status?.().dirty;
  notesNotice.textContent=notesNotice.hidden?'':'Notes has unsaved work. Open Notes to review the patient summaries and visit drafts before saving.';
}
async function saveSession(){try{await billing.state().adapter?.ensureConnected?.();await session.save();billing.notify('');if(!session.state().some(s=>s.dirty||s.error||s.busy)&&!patients.state().draft&&$('changes-dialog').open)$('changes-dialog').close();}catch(e){if(patients.state().error)showSection('patients');session.lastError=e.message;if(!session.message)session.message=e.message;billing.notify('');}finally{status();}}
async function linkClinicFile(fileId,refresh){
  const adapter=billing.state().adapter;
  if(!adapter?.hostedAccess)throw new Error('Connect TRIM with Google first.');
  const access=await adapter.hostedAccess.authorize({hint:adapter.accountEmail,pickFileId:fileId});
  if(access.email.toLowerCase()!==adapter.accountEmail.toLowerCase())throw new Error('Choose the same Google account you used for TRIM.');
  await adapter.connect({interactive:false});
  await refresh();
}
async function start(){
  facilityView = facilityRoster($('il-workspace'), () => billing?.state().adapter?.hostedAccess ? billing.state().adapter : intake?.recordsConnection?.() || billing?.state().adapter, linkClinicFile);
  maidRoster=clinicRosterUI({host:$('maid-workspace'),kind:'maid',onChange:status,onReload:refreshMaid,onLink:()=>linkClinicFile(maidRepository.fileId,refreshMaid),onAction:async action=>{
    if(!maidSnapshot||!maidRepository)throw new Error('Reload MAID before editing.');
    const saved=await maidRepository.mutate(action,maidSnapshot);maidSnapshot=saved;
    return {patients:saved.roster.patients,local:maidRepository.adapter.mode==='local'};
  }});
  for(const clinic of Object.keys(oatClinics))oatViews.set(clinic,createOatView(clinic));
  patients=await patientsUI({onBirthDate:(...args)=>intake.updateBirthDate(...args),host:$('patients-workspace'),onChange:status,onFocus:p=>{if(notes?.openFocus)void notes.openFocus('phn:'+String(p.phn).replace(/\D/g,'')).catch(e=>billing.notify(e.message));else billing.notify('Open the laptop app to edit routine focus.');},onBilling:key=>billing.openPatientBilling(key),onHistory:key=>billing.showPatientHistory(key),onUpload:p=>{void intake.open(p).catch(e=>billing.notify(e.message));},onRoster:raw=>billing?.setRoster(raw),onSaved:async raw=>{if(notes?.ensureRoster)await notes.ensureRoster(raw);}});
  const laptop=laptopRuntime();
  notes=laptop?(await import('./notes-ui.mjs?v=20261127-names1')).notesUI({state:()=>billing?.state()||{date:new Date().toISOString().slice(0,10),people:[]},reconcileBilling:(...args)=>billing.recordRoutine(...args),switchTab:tab=>billing.switchTab(tab),onStatus:status}):localNotesPlaceholder();
  billing=billingUI({patients,notes,onStatus:status,onNavigate:navigate,onPatientConflict:()=>showSection('patients'),onConnected:()=>{void refreshClinics();void intake.profiles();void intake.refreshQueue();const wanted=new URLSearchParams(location.search).get('section');if(wanted==='notes')billing.switchTab('rounds');else showSection(['maid',...oatViews.keys(),...facilityNames.keys()].includes(wanted)?wanted:section);status();},saveSession});
  const rosterRoot=$('patients-workspace').shadowRoot;
  const profileBanner=document.createElement('div'),profileMessage=document.createElement('span'),profileAction=document.createElement('button');
  profileBanner.className='profile-status';profileBanner.hidden=true;profileMessage.setAttribute('role','status');profileAction.type='button';profileAction.className='btn btn-ghost btn-sm';
  profileBanner.append(profileMessage,profileAction);rosterRoot.querySelector('.roster-search').after(profileBanner);
  function profileStatus(message,action){
    profileBanner.hidden=!message;profileMessage.textContent=message;profileAction.hidden=!action;
    profileAction.textContent=action==='link'?'Link MOST':'Retry';
    profileAction.onclick=async()=>{
      profileAction.disabled=true;
      try{if(action==='link')await linkClinicFile(PROFILE_FILE_ID,()=>intake.profiles({required:true}));else await intake.profiles();}
      catch(error){profileMessage.textContent='Patient histories unavailable. '+error.message;}
      finally{profileAction.disabled=false;}
    };
  }
  intake=documentIntakeUI({onProfileStatus:profileStatus,state:()=>billing.state(),notes,onRecordsConnected:refreshClinics,onProfiles:()=>{refreshIdentities(document);refreshIdentities($('patients-workspace').shadowRoot);patients?.refreshProfiles(); }});
  session=new Session([
    {name:'Roster',state:patients.state,save:patients.save},
    {name:'MAID',state:maidRoster.state,save:async()=>{}},
    {name:'Facility rosters',state:facilityView.state,save:async()=>{}},
    ...Array.from(oatViews,([id,view])=>({name:oatClinics[id].title,state:()=>({busy:view.state().busy}),save:async()=>{}})),
    ...(laptop?[{name:'Notes',state:notes.status,save:notes.save}]:[]),
    {name:'Billing',state:billing.status,save:billing.save}
  ],status);
  const rosterChanges=document.createElement('section');rosterChanges.id='roster-pending-changes';rosterChanges.setAttribute('aria-label','Pending roster changes');$('changes-summary').before(rosterChanges);
  const notesNotice=document.createElement('p');notesNotice.id='pending-notes-notice';notesNotice.hidden=true;rosterChanges.after(notesNotice);
  const openChanges=$('local-changes').onclick;
  $('local-changes').onclick=()=>{openChanges();status();};
  const latest=document.createElement('button');latest.id='load-latest';latest.textContent='Refresh from Drive';$('drive-connection').after(latest);
  latest.onclick=async()=>{try{$('workspace-menu').hidePopover();session.message='';await billing.loadLatest();await refreshClinics({refresh:true});await intake.refreshQueue();await intake.profiles();if(!session.state().some(s=>s.dirty||s.error)){session.lastError='';session.message='';}}catch(e){billing.notify(e.message);}finally{status();}};
  const patientReview=document.createElement('div');patientReview.className='actions patient-review-tools';patientReview.innerHTML='<button id="review-patient-changes">Review patient changes</button><button id="reload-patient-changes">Reload saved roster</button>';$('changes-list').before(patientReview);
  $('review-patient-changes').onclick=async()=>{$('changes-dialog').close();showSection('patients');session.message='';try{await patients.refresh(true);}catch(e){billing.notify(e.message);}status();};
  $('reload-patient-changes').onclick=async()=>{$('changes-dialog').close();session.message='';try{await patients.reload();if(!session.state().some(s=>s.dirty||s.error)){session.lastError='';session.message='';}}catch(e){billing.notify(e.message);}status();};
  if(!laptop)document.querySelector('[data-section="notes"]').title='Notes runs on your laptop';
  // Read-only Drive verification must not prevent opening the separate Notes app.
  const notesLaunchBlocked=()=>session.saving||session.state().some(s=>s.dirty||s.error)||patients.state().draft;
  const switcher=document.createElement('button');switcher.id='switch-version';switcher.textContent=laptop?'Open cloud app':'Open laptop app';switcher.className='text-button';
  const switching=document.createElement('dialog');switching.id='switch-version-dialog';switching.innerHTML='<div class="dialog-body"><h2>Switch TRIM versions</h2><p id="switch-version-message"></p><a id="switch-version-link" target="_blank" rel="noopener">'+(laptop?'Open cloud TRIM ↗':'Open laptop TRIM ↗')+'</a><button id="switch-version-connect" hidden>Connect through Google</button><button id="switch-version-close">Close</button></div>';document.body.append(switching);$('workspace-menu').append(switcher);
  switcher.onclick=()=>{$('workspace-menu').hidePopover();const dirty=laptop?(session.state().some(s=>s.dirty||s.busy||s.error)||patients.state().draft):notesLaunchBlocked(),folder=laptop&&billing.state().adapter?.mode==='local';$('switch-version-message').textContent=dirty?'Save your session to Drive before switching. Keep this tab open until your billing is saved.':folder?'This connection saves to the laptop’s Drive folder. Connect through Google and verify the saved version before switching.':laptop?'Your session is saved. Connect through Google in the other version to load the latest Drive records. Local drafts stay in this browser.':'Your session is saved. Approve Open TRIM Notes in the browser prompt. Local drafts stay in this browser.';const link=$('switch-version-link');link.hidden=dirty||folder;link.href=laptop?CLOUD_URL:NOTES_LAUNCH_URL;link.target=laptop?'_blank':'';$('switch-version-connect').hidden=dirty||!folder;switching.showModal();};$('switch-version-close').onclick=()=>switching.close();$('switch-version-connect').onclick=()=>{switching.close();billing.chooseConnection();};
  if(!laptop)$('open-laptop-notes').onclick=e=>{if(notesLaunchBlocked()){e.preventDefault();switcher.click();}};
  document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{
    session.message='';
    if(!laptop&&b.dataset.section==='notes'){
      billing.switchTab(lastTab.notes);status();return;
    }
    if(['patients','maid',...oatViews.keys(),...facilityNames.keys()].includes(b.dataset.section))showSection(b.dataset.section);else billing.switchTab(lastTab[b.dataset.section]);
    if(b.dataset.section==='maid'&&!maidSnapshot)void refreshMaid();
    const oat=oatViews.get(b.dataset.section);if(oat?.needsLoad())void oat.refresh();
    status();
  });
  $('patients-print-close').onclick=()=>$('patients-print-dialog').close();
  $('patients-print').onclick=()=>{$('patients-print-frame').contentWindow.focus();$('patients-print-frame').contentWindow.print();};
  window.addEventListener('beforeunload',e=>{if(patients.hasChanges()){e.preventDefault();e.returnValue='';}});

  if(laptop){
    const {LocalAdapter}=await import('./adapters.mjs?v=20261119-most-connection1');
    const {keepLaptopService}=await import('./service-lifecycle.mjs?v=20261111-on-demand1');
    const serviceAdapter=new LocalAdapter();await serviceAdapter.connect();
    keepLaptopService({api:(...args)=>serviceAdapter.request(...args)});
  }
  showSection('billing');billing.start();
}
start().catch(e=>{$('gate').hidden=false;$('workspace').hidden=true;$('gate').querySelector('h1').textContent='TRIM could not start';const p=document.createElement('p');p.textContent=e.message;$('gate').querySelector('.gate-card').append(p);});
