import {identityHTML,nameCopy,bindIdentity} from './patient-identity.mjs?v=20261031-compact1';
import {formatDate,formatTimestamp,enhanceDateInputs} from './dates.mjs?v=20261007-dates1';
import {normalizeRoster,CODES,COMMON_CODES,CONFERENCE_CODES,REASON_PRESETS,timeDefaults,roundedPacificTime,tenMinutesLater,editBillingTime,calendarDays,codeInfo,clone,sameBillingContent,today,validDate,patientKey,rosterView,dueState,lastBilling,upsertInteractiveEntry,removeEntry,batchEntries,entryIssues,finalizeBatch,escapeHTML as esc,validateLedger,parseImport,mergeImport,importSummary,heldImports,blankLedger} from './core.mjs?v=20261031-compact1';
import {cancelBillingCodes,undoBillingCancellation,inheritConferenceDiagnoses} from './core.mjs?v=20261031-compact1';
import {timeField,bindTimeFields} from './time-entry.mjs?v=20261007-cancel1';
import {LocalAdapter,DriveAdapter,preferredDriveAccount} from './adapters.mjs?v=20261031-compact1';
import {avaChartUrl} from './patient-links.mjs';
import {planNewPatients} from './core.mjs?v=20261031-compact1';
import {saveRecovery,loadRecovery} from './recovery.mjs?v=20261012-backup1';
import {backupUI} from './backup-ui.mjs?v=20261012-backup1';
import {renderReport} from './reports.mjs?v=20261019-fixes1';
import {sessionChanges,changedBillCount,routineCandidates,addRoutineBatch,undoRoutineBatch,coveragePatient,extractDemographics,matchesPatientSearch,newestBillingFirst,patientHistoryGroups} from './workspace.mjs?v=20261031-history-date1';
import {mergeSession} from './merge.mjs?v=20261015-immediate1';
import {laptopRuntime} from './runtime.mjs';
import {sameRosterContent} from './patients-core.mjs?v=20261031-compact1';
import {RosterRepository} from './roster-repository.mjs';

import {hospitalBlocks114,assertHospital114} from './hospital.mjs?v=20261024-hospital2';
import {hospitalFlag} from './hospital-ui.mjs?v=20261024-hospital2';
import {hospitalEditor} from './hospital-entry.mjs?v=20261024-hospital2';

export function billingUI({notes,patients,onStatus=()=>{},onNavigate=()=>{},onConnected=()=>{},onPatientConflict=()=>{},saveSession}){
const $=id=>document.getElementById(id);
const laptopStartup=['127.0.0.1','localhost'].includes(location.hostname)&&['/','/index.html'].includes(location.pathname)&&!['manual','cloud'].includes(new URLSearchParams(location.search).get('connection'));
const laptopLockKey='trim-billing:laptop-locked';
$('search-scope').textContent='All TRIM Patients residents · your panel, other residents and saved coverage patients';
const headerDate=document.createElement('div');headerDate.id='header-billing-date';headerDate.setAttribute('aria-live','polite');headerDate.innerHTML='<small>Billing for</small><strong id="header-date-value"></strong>';document.querySelector('.app-sections').after(headerDate);
const routineViews=document.createElement('div');routineViews.id='routine-views';routineViews.className='view-tabs';routineViews.hidden=true;routineViews.innerHTML='<button id="routine-individual" aria-pressed="true">Individual</button><button id="routine-batch" aria-pressed="false">Batch by unit/floor</button>';$('billing-lock').after(routineViews);
const routinePanel=document.createElement('section');routinePanel.id='routine-batch-panel';routinePanel.hidden=true;routinePanel.innerHTML='<div class="card"><h2>Choose units / floors</h2><p class="hint">Active TRIM Patients only. Counts use the selected billing date.</p><div id="routine-units"></div></div><div class="card"><h2>Review patients you saw</h2><div id="routine-review"></div><div class="batch-build-actions"><button id="routine-add" class="primary" disabled>Add 114 for 0 patients</button><p class="hint">Adds to local changes only. Save the session to Drive when finished.</p></div><div id="routine-result" role="status"></div></div>';$('billing').append(routinePanel);
const historyViews=document.createElement('div');historyViews.className='view-tabs';historyViews.innerHTML='<button id="history-by-date" aria-pressed="true">By date</button><button id="history-by-patient" aria-pressed="false">By patient</button>';$('history-content').before(historyViews);
const historyFilters=document.createElement('section');historyFilters.className='history-date-filter';historyFilters.setAttribute('aria-label','Browse billing history by date');historyFilters.innerHTML='<div id="history-calendar" aria-label="History calendar"><div class="calendar-heading"><button id="history-month-prev" aria-label="Previous history month">‹</button><strong id="history-calendar-month" aria-live="polite"></strong><button id="history-month-next" aria-label="Next history month">›</button></div><div class="calendar-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div id="history-calendar-days" class="calendar-days"></div></div><div class="history-date-actions"><p id="history-date-status" class="hint" role="status">Showing all dates</p><div class="actions"><button id="history-date-calendar">Today</button><button id="history-date-clear" aria-pressed="true">All dates</button></div><p class="hint">Select a day to view its billing. Dots mark dates with records.</p></div>';historyViews.after(historyFilters);
const historySearch=document.createElement('section');historySearch.id='history-patient-picker';historySearch.hidden=true;historySearch.innerHTML='<label>Find a patient<input id="history-search" type="search" placeholder="Search name or PHN" autocomplete="off"></label><div id="history-patient-results"></div><div id="history-patient-summary"></div>';$('history-content').before(historySearch);
const startingDates=document.createElement('details');startingDates.id='starting-dates';const baselineHeading=$('baseline-patient').closest('.card').querySelector('h2');startingDates.innerHTML='<summary>Historical starting dates / corrections <span id="baseline-needed-count"></span></summary><p id="baseline-needed-status"></p><label class="check-line"><input id="baseline-show-all" type="checkbox"> Show all patients / correct a starting date</label>';baselineHeading.before(startingDates);let baselineNode=baselineHeading.nextSibling;baselineHeading.remove();while(baselineNode){const next=baselineNode.nextSibling;startingDates.append(baselineNode);if(baselineNode.id==='baseline-list')break;baselineNode=next;}startingDates.querySelector('p:not([id])').textContent='Only needed when there is no known qualifying billing date. Saved billings update routine due dates automatically.';const savedStartingDates=document.createElement('details');savedStartingDates.innerHTML='<summary>Saved starting dates</summary>';$('baseline-list').before(savedStartingDates);savedStartingDates.append($('baseline-list'));
let routineView='individual',routineUnits=new Set(),routineExcluded=new Set(),routineReceipt=null,historyView='date',historyPatient=null,historyDate='',historyMonth=today().slice(0,7);
let savedBase=null,billingMode='concern',lastChecked=null,driveReachable=false,localRecoveryFailed=false,ocrBusy=false,ocrRun=0,ocrAbort=null,imageURL=null;
const localChanges=()=>dirty&&ledger&&savedBase?sessionChanges(savedBase,ledger):[];
function checkedDrive(){driveReachable=true;lastChecked=new Date();}
function connectionError(e){driveReachable=e?.status===409;if(driveReachable)lastChecked=new Date();}
let adapter,ledger,roster,etag,selected=null,editingId=null,tab='billing',dirty=false,blocked=false,seq=0,saving=false,timer,releaseLock,printedSignature=null,recoveryQueue=Promise.resolve(),recoveryPending=0;
let setupCandidate,connecting=false,loadingLatest=false;
let mergeChoices={},mergeConflicts=[],remoteBilling=null;
let stagedImport=null,importing=false,importRead=0;
let connectionVerified=false,syncFailed=false,checking=false,calendarMonth=today().slice(0,7),saveFocus=null;
const backups=backupUI({state:()=>({adapter,saved:savedBase,dirty,busy:saving||checking}),showSettings:()=>switchTab('settings'),restore:async(next,preserve)=>{
  guardWrite();if(dirty)throw new Error('Save or discard local changes first.');
  saving=true;updateWriteLock();
  try{
    const current=await adapter.load();if(current.etag!==etag)throw new Error('Drive changed. Reconnect / reload saved billing before restoring.');
    await preserve(current.ledger);
    const saved=await adapter.restoreBackup(next,current.etag);
    selected=null;editingId=null;await adoptSaved(saved);
  }catch(e){connectionVerified=false;syncFailed=true;throw e;
  }finally{saving=false;updateWriteLock();}
}});
const hospitalControls=hospitalEditor({patients,guard:guardWrite,notify:notice});
const date=()=>$('service-date').value||today();
async function resetBillingDate(){
  if(notes.hasChanges())return false;
  $('service-date').value=today();calendarMonth=today().slice(0,7);editingId=null;routineExcluded.clear();await notes.selectDate(today());
  return true;
}
const people=()=>rosterView(roster,ledger);
const person=k=>people().find(p=>p.key===k);

function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function status(text,warn=false){$('save-status').textContent=text;$('save-status').classList.toggle('dirty',warn);updateWriteLock();}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){notice(e.message);}};}
const writeUnavailable=()=>!connectionVerified||syncFailed||blocked||checking||loadingLatest||!navigator.onLine;
function guardWrite(){if(writeUnavailable())throw new Error('Billing is locked until the Google Drive connection and saved revision are verified. Use Save to Drive / retry.');if(saving)throw new Error('Wait for the current save to finish.');}
function updateWriteLock(){
  renderSaveControls();
  if(!ledger)return;const unavailable=writeUnavailable(),busy=saving||checking||loadingLatest;
  const e=selected?currentEntry():null,historical=selected&&(ledger.historicalBillings||[]).some(h=>h.patientKey===selected&&h.date===date());
  $('editor').querySelectorAll('input,textarea,select,[data-code],#add-code,#remove-entry,[data-remove-code],[data-reason-preset],[data-time-open]').forEach(el=>{el.disabled=unavailable||saving||Boolean(e?.batchId)||historical||(busy&&el.tagName==='BUTTON')||(el.dataset.code==='00114'&&hospitalBlocks114(person(selected),date())&&!e?.items.some(i=>i.code==='00114'));});
  $('history-content').querySelectorAll('[data-history-remove],[data-history-undo]').forEach(el=>el.disabled=unavailable||busy);
  $('routine-batch-panel').querySelectorAll('input,button').forEach(el=>el.disabled=unavailable||busy);
  $('routine-add').disabled=unavailable||busy||!selectedRoutineCandidates().length;
  $('roster').querySelectorAll('[data-patient]').forEach(el=>el.disabled=busy);
  $('calendar').querySelectorAll('button').forEach(el=>el.disabled=busy||el.dataset.future==='true');
  const identityReady=$('other-form').elements.name.value.trim()&&/^\d{10}$/.test($('other-form').elements.phn.value);
  for(const id of ['confirm-patient','baseline-save','parallel','finalize','generate'])$(id).disabled=unavailable||busy||(id==='baseline-save'&&!$('baseline-patient').value)||(id==='confirm-patient'&&(ocrBusy||!identityReady))||(id==='finalize'&&ledger.settings.parallel);
  $('baseline-date').disabled=unavailable||busy||!$('baseline-patient').value;
  $('baseline-patient').disabled=unavailable||busy||!$('baseline-patient').value;
  $('billing-lock').hidden=!unavailable;$('billing-lock').textContent=blocked?'Changes saved on another computer. Load latest changes to combine your pending work, or review it below.':!navigator.onLine?'Offline — billing is locked. Existing work is retained; reconnect to continue.':'Billing locked — use Load latest changes to reconnect.';
  $('conflict-actions').hidden=!blocked;
  for(const id of ['conflict-save','conflict-discard','changes-discard','reload-data'])$(id).disabled=busy||!navigator.onLine;
  if($('merge-dialog').open){$('merge-save').disabled=busy||!navigator.onLine||!mergeConflicts.every(c=>mergeChoices[c.id]?.token===c.token);$('merge-list').querySelectorAll('input').forEach(el=>el.disabled=busy);}
}
function renderCalendar(){
  $('calendar').dataset.serviceDate=date();
  $('calendar-month').textContent=new Intl.DateTimeFormat('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(calendarMonth+'-01T12:00:00Z'));
  const billedDays=new Set(ledger?.entries.map(e=>e.date)||[]);
  $('calendar-days').innerHTML=calendarDays(calendarMonth).map(d=>d?`<button data-day="${d}" data-future="${d>today()}" ${d>today()?'disabled':''} aria-label="${esc(new Intl.DateTimeFormat('en-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')))}${billedDays.has(d)?', billing recorded':''}" aria-pressed="${d===date()}" ${d===today()?'aria-current="date"':''} class="${billedDays.has(d)?'has-billing':''}">${Number(d.slice(-2))}</button>`:'<span></span>').join('');
  $('selected-date-label').textContent=formatDate(date());
  $('header-date-value').textContent=formatDate(date());
  $('calendar-days').querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>selectDate(b.dataset.day));updateWriteLock();
}
function selectDate(value){if(value===date())return;if(saving||checking||notes.hasChanges())return notice('Save this day’s notes and wait for the current operation before changing dates.');if(!validDate(value)||value>today())return notice('Choose today or an earlier service date.');$('service-date').value=value;calendarMonth=value.slice(0,7);editingId=null;routineExcluded.clear();renderCalendar();renderStats();renderRoster();renderEditor();renderRoutineBatch();void notes.selectDate(value);}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function takeTabLock(id){if(!navigator.locks)throw new Error('This browser cannot protect against competing tabs. Use an up-to-date Chrome browser.');return new Promise((resolve,reject)=>navigator.locks.request(`trim-billing:${id}`,{ifAvailable:true},async lock=>{if(!lock)return reject(new Error('This billing file is already open for editing in another tab. Close or lock that tab first.'));resolve();await new Promise(r=>releaseLock=r);}));}
async function recover(){
  const saved=await loadRecovery(ledger.datasetId);
  if(saved?.dirty){
    validateLedger(saved.ledger);
    if(sameBillingContent(saved.ledger,ledger)){dirty=false;blocked=false;await persistRecovery();notice('Your previous changes are already saved to Google Drive. Recovery status repaired.');return;}
    const loadedBase=clone(ledger);remoteBilling=clone(ledger);ledger=saved.ledger;dirty=true;
    if(saved.baseLedger?.datasetId===ledger.datasetId){validateLedger(saved.baseLedger);savedBase=saved.baseLedger;}else savedBase=saved.etag===etag?loadedBase:null;
    if(saved.etag!==etag){blocked=true;notice('Drive has newer billing. Click Save my changes to Drive to add your local work, or discard local changes.');}
    else notice('Recovered your unfinished session on this device. Choose Save to Drive when ready.');
    etag=saved.etag; // Keep the revision belonging to this draft's starting copy.
  }
}
function persistRecovery(){const snapshot={ledger:clone(ledger),baseLedger:clone(savedBase),etag,dirty,savedAt:new Date().toISOString()};recoveryPending++;
  recoveryQueue=recoveryQueue.catch(()=>{}).then(()=>saveRecovery(snapshot.ledger.datasetId,snapshot)).then(()=>{recoveryPending--;localRecoveryFailed=false;}).catch(e=>{recoveryPending--;localRecoveryFailed=true;blocked=true;status('Recovery save failed — keep this tab open',true);notice(`Device recovery failed: ${e.message}. Download a private backup before closing.`);throw e;});return recoveryQueue;
}
function applyNewPatientPlans(){
  if(!ledger||!roster||writeUnavailable()||saving)return;
  const next=planNewPatients(ledger,roster);
  if(!sameBillingContent(next,ledger))commit(next);
}
function openConnectionDialog(){
  const email=preferredDriveAccount();
  $('cloud-account').textContent=email?`Continue with ${email}`:'Choose your Google account on the first connection.';
  $('connection-error').textContent='';$('connection-dialog').showModal();
}
async function connect(mode,create=false,selectAccount=false){
  if(dirty||notes.hasChanges()||patients.hasChanges())return notice('Save or discard your local session before changing connections.');
  if(connecting)return;connecting=true;
  let replacedConnection=false;
  $('create-cloud').hidden=true;$('setup-note').hidden=true;
  $('setup-import').hidden=true;setupCandidate=create?setupCandidate:null;
  $('connection-error').textContent='Connecting…';$('connection-error').dataset.state='connecting';
  try{
    const candidate=create?setupCandidate:mode==='local'?new LocalAdapter():new DriveAdapter($('cloud-file-id').value);
    if(!candidate)throw new Error('Connect through Google first.');
    if(!create)await candidate.connect({selectAccount});
    const r=await candidate.roster();let s;
    try{s=create?await candidate.createEmpty():await candidate.load();if(mode==='local'&&s.etag==='new')throw new Error('The billing file is not available in this laptop’s Drive folder. Check Drive sync, then retry.');}
    catch(e){if(e.code==='MISSING_BILLING'){setupCandidate=candidate;$('create-cloud').hidden=false;$('setup-import').hidden=false;$('setup-note').hidden=false;}throw e;}
    if(adapter?.mode==='local'&&mode==='cloud'){
      const cloudRoster=await new RosterRepository(candidate).load();
      if(!sameBillingContent(savedBase,s.ledger)||!sameRosterContent(patients.roster(),cloudRoster.roster))throw new Error('The laptop Drive folder and Google Drive do not match yet. Your laptop session is unchanged. Wait for Drive sync, reload the laptop app, then reconnect through Google.');
    }
    replacedConnection=true;
    if(releaseLock){releaseLock();releaseLock=null;}
    await takeTabLock(s.ledger.datasetId);
    adapter=candidate;roster=r;ledger=s.ledger;savedBase=clone(s.ledger);checkedDrive();etag=s.etag;dirty=false;blocked=false;syncFailed=false;connectionVerified=true;selected=null;editingId=null;
    await recover();await resetBillingDate();
    if(!blocked)applyNewPatientPlans();
    document.title='TRIM';
    $('storage-note').textContent=mode==='local'?'Laptop connection · saves to this laptop’s Drive folder. Cloud sync is not verified. Roster edits use Save to Drive.':'Google Drive connected · Roster edits use Save to Drive.';
    renderAll();setBillingMode(billingMode);status(blocked?'Draft conflict — action needed':dirty?'Saved on this device — not yet in Drive':mode==='local'?'Local Drive folder connected':'Saved to Google Drive',blocked||dirty);
    void backups.connected(adapter,s.ledger);
    await patients.connect(adapter,ledger.datasetId);
    await patients.refresh();
    await notes.connected();
    candidate.rememberAccount?.();
    $('gate').hidden=true;$('workspace').hidden=false;$('connection-dialog').close();
    onConnected();
    return true;
  }catch(e){if(replacedConnection&&releaseLock){releaseLock();releaseLock=null;}$('connection-error').textContent=e.message;$('connection-error').dataset.state='error';}
  finally{connecting=false;}
}
function commit(next){guardWrite();ledger=next;ledger.units=clone(roster.units);seq++;dirty=true;printedSignature=null;status('Saving on this device…',true);persistRecovery().then(()=>{if(!blocked&&!saving&&!writeUnavailable())status('Saved on this device — not yet in Drive',true);}).catch(()=>{});renderStats();renderRoster();updateWriteLock();}
async function flush(){
  clearTimeout(timer);if(!dirty||saving||blocked||!adapter)return;
  if(!navigator.onLine){syncFailed=true;connectionVerified=false;status('Offline — changes retained on device',true);return;}
  saveFocus=document.activeElement?.matches('#editor input,#editor textarea')?{el:document.activeElement,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
  saving=true;updateWriteLock();const currentSeq=seq;const snapshot=clone(ledger);
  try{
    await recoveryQueue;status('Saving…',true);const saved=await adapter.save(snapshot,etag);etag=saved.etag;savedBase=clone(saved.ledger);remoteBilling=clone(saved.ledger);checkedDrive();
    if(seq===currentSeq){ledger=saved.ledger;dirty=false;}else{ledger.revision=saved.ledger.revision;ledger.updatedAt=saved.ledger.updatedAt;ledger.localWriter=saved.ledger.localWriter;}
    syncFailed=false;connectionVerified=true;await persistRecovery();status(dirty?'More changes waiting to save':adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive',dirty);
    await backups.capture(saved.ledger);
  }catch(e){connectionError(e);syncFailed=true;connectionVerified=false;if(e.status===409){blocked=true;notice('Drive changed during saving. Your work is retained. Click Save my changes to Drive to try again.');}else{notice(e.message+' Your draft remains on this device. Use Save to Drive / retry after reconnecting.');}status(e.status===409?'Conflict — save stopped':'Saved on device · not synced',true);}
  finally{saving=false;updateWriteLock();if(!dirty&&!writeUnavailable()){renderCalendar();if(tab==='history')renderHistory();if(saveFocus?.el.isConnected&&!saveFocus.el.disabled&&document.activeElement===document.body){saveFocus.el.focus();if(saveFocus.start!==null)saveFocus.el.setSelectionRange(saveFocus.start,saveFocus.end);}}saveFocus=null;}
}
function renderAll(){
  $('unit-filter').innerHTML='<option value="">All units</option>'+roster.units.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  renderStats();renderRoster();renderEditor();renderReports();renderReview();renderHistory();renderSettings();renderCalendar();renderRoutineBatch();updateWriteLock();
}
function renderStats(){const pts=people(),own=pts.filter(p=>p.panel),day=ledger.entries.filter(e=>e.date===date());const missing=day.filter(e=>entryIssues(e,ledger,person(e.patientKey)).length);$('stats').innerHTML=[['My panel',own.length,'No patient limit'],['Selected this date',day.length,'Patients with billing'],['Needs information',missing.length,'Saved, incomplete'],['Due for review',own.filter(p=>dueState(ledger,p,date()).kind==='due').length,`${own.filter(p=>dueState(ledger,p,date()).kind==='unknown').length} with unknown history`]].map(([label,n,sub])=>`<div class="stat"><span>${label}</span><b>${n}</b><small>${sub}</small></div>`).join('');$('day-summary').textContent=`${formatDate(date())} · ${day.length} patients billed${missing.length?` · ${missing.length} need information`:''}`;}
function renderRoster(){
  const q=$('search').value.trim(),unit=$('unit-filter').value,dueOnly=$('due-filter').checked;
  // Concern search always spans the full roster, regardless of stale routine filters.
  const pts=people().filter(p=>matchesPatientSearch(p,q)&&(billingMode==='concern'||(p.panel&&(!unit||p.unit===unit)&&(!dueOnly||dueState(ledger,p,date()).kind==='due'||ledger.entries.some(e=>e.patientKey===p.key&&e.date===date())))));
  const units=[...roster.units];for(const p of pts)if(!units.some(u=>u.id===p.unit))units.push({id:p.unit,name:p.unit||'OTHER',floor:''});
  $('roster').innerHTML=units.map(u=>{const group=pts.filter(p=>p.unit===u.id).sort((a,b)=>a.room.localeCompare(b.room,undefined,{numeric:true})||a.name.localeCompare(b.name));if(!group.length)return '';return `<section class="unit"><div class="unit-heading"><span>${esc(u.name)}${u.floor?` · FLOOR ${esc(u.floor)}`:''}</span><span>${group.length}</span></div>${group.map(p=>{const e=ledger.entries.find(e=>e.patientKey===p.key&&e.date===date());const d=dueState(ledger,p,date());return `<div class="patient-row${avaChartUrl(p)?' has-chart-link':''}"><div role="button" tabindex="0" class="patient ${selected===p.key?'selected':''}" data-patient="${esc(p.key)}"><span class="room">${esc(p.room||'—')}</span><span><span class="patient-name">${identityHTML(p,{compact:true})}${hospitalFlag(p,date())}${p.pFlag?'<span class="pflag">P</span>':''}</span><span class="patient-detail">${d.last?`Last billing ${formatDate(d.last)}${billingMode==='routine'?` · ${Math.round((Date.parse(date())-Date.parse(d.last))/86400000)} days ago`:''}`:d.firstRoutine?'New patient · first routine review':p.panel?'Starting history not supplied':'Reason required for coverage billing'}</span></span><span class="patient-right">${e?`<span class="pill">${e.items.map(i=>esc(i.code.replace(/^0+/,''))).join(' · ')}</span><span class="patient-detail">${e.batchId?'Handed over':entryIssues(e,ledger,p).length?'Needs information':'Selected'}</span>`:`<span class="pill ${d.kind==='unknown'?'warn':''}">${esc(d.kind==='later'?`Next ${formatDate(d.due)}`:d.label)}</span>`}</span></div></div>`;}).join('')}</section>`;}).join('')||'<div class="empty">No patients match these filters.</div>';
  $('roster').querySelectorAll('[data-patient]').forEach(b=>{b.onclick=event=>{if(event.target.closest('a,button')||saving||checking)return;selected=b.dataset.patient;editingId=null;renderRoster();renderEditor();};b.onkeydown=event=>{if(event.target===b&&['Enter',' '].includes(event.key)){event.preventDefault();b.click();}};});bindIdentity(document);updateWriteLock();
}
function billingPhnCopy(p){
  const phn=String(p.phn||'').replace(/\D/g,'');
  return /^\d{10}$/.test(phn)?`<button type="button" class="text-button billing-phn-copy" data-copy-phn="${phn}" aria-label="Copy PHN for ${esc(p.name)}" title="Copy PHN">Copy PHN</button>`:'';
}
function bindBillingPhnCopy(){
  $('roster').querySelectorAll('[data-copy-phn]').forEach(button=>button.onclick=safe(async()=>{
    await navigator.clipboard.writeText(button.dataset.copyPhn);
    button.textContent='Copied';
    setTimeout(()=>{button.textContent='Copy PHN';},1600);
  }));
}
function chartLink(p,className=''){
  const url=avaChartUrl(p);
  return url?`<a class="ava-chart-link ${className}" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Open Ava chart for ${esc(p.name)}">Ava ↗</a>`:'';
}
function currentEntry(){return editingId?ledger.entries.find(e=>e.id===editingId):ledger.entries.find(e=>e.patientKey===selected&&e.date===date());}
function applyItems(items,comment=currentEntry()?.comment||''){
  guardWrite();
  const p=person(selected),e=currentEntry();if(!p)throw new Error('Select a patient.');
  if(!items.length){if(e){if(!confirm('Remove all codes for this billing date?'))return;commit(cancelBillingCodes(ledger,e.id));editingId=null;}renderEditor();return;}
  items=inheritConferenceDiagnoses(items,p.codes||'');
  const next=upsertInteractiveEntry(ledger,p,date(),items,comment,e?.id);editingId=next.entries.find(x=>x.patientKey===p.key&&x.date===date())?.id||null;commit(next);
}
function renderEditor(){
  if(!selected){$('editor').innerHTML='<div class="empty-editor"><h2>Choose a patient</h2><p>Select a name to choose billing codes.</p><small>No charge is added until you select a code.</small></div>';return;}const p=person(selected);if(!p)return;const e=currentEntry(),items=e?.items||[],locked=Boolean(e?.batchId);
  const historical=(ledger.historicalBillings||[]).filter(h=>h.patientKey===p.key).sort((a,b)=>b.date.localeCompare(a.date));
  $('editor').innerHTML=`<div class="editor-head"><div><div class="patient-title"><h2>${identityHTML(p)}</h2>${hospitalFlag(p,date())}<button type="button" class="upload-documents" data-upload-patient="${esc(p.key)}">Documents</button></div><p>${esc(roster.units.find(u=>u.id===p.unit)?.name||p.unit||'Location not recorded')} · Room ${esc(p.room||'—')} · ${p.panel?'My patient':'Coverage / former patient'}</p></div><span class="editor-date">${esc(formatDate(date()))}</span></div>${locked?'<div class="issue-box">Given to Suzy. This entry is read-only.</div>':''}<div class="codes-grid" aria-label="Common billing codes">${(billingMode==='routine'?['00114',...COMMON_CODES.filter(c=>c!=='00114')]:COMMON_CODES).map(code=>{const c=codeInfo(code);return `<button class="code-chip ${billingMode==='routine'&&code==='00114'?'routine-primary ':''}${items.some(i=>i.code===code)?'on':''}" data-code="${code}" aria-pressed="${items.some(i=>i.code===code)}" ${locked?'disabled':''}>${code.replace(/^0+/,'')}<small>${esc({'00114':billingMode==='routine'?'Routine':'Visit','00127':'Palliative','14077':'Provider','13121':'Family'}[code]||c.label)}</small></button>`;}).join('')}</div><details class="other-codes"><summary>Other billing codes</summary><label>Additional code<select id="other-code" ${locked?'disabled':''}><option value="">Choose a code…</option>${CODES.filter(c=>!COMMON_CODES.includes(c.code)).map(c=>`<option value="${c.code}">${c.code} · ${esc(c.label)}</option>`).join('')}</select></label><div class="fields"><label>Custom five-digit code<input id="custom-code" maxlength="5" inputmode="numeric"></label><button id="add-code" ${locked?'disabled':''}>Add</button></div></details>${items.some(i=>i.code==='13334')?`<div class="bonus-banner">✓ 13334 · First-visit bonus${items.find(i=>i.code==='13334').autoAdded?' · Auto':''}</div>`:''}<div id="item-details">${items.map((i,index)=>itemHTML(i,index,locked)).join('')}</div><div id="editor-issues"></div>${e?.comment||items.some(i=>i.code!=='00114'&&i.code!=='13334'&&!CONFERENCE_CODES.includes(i.code))?`<section class="comment-details"><label>Additional billing comment<textarea id="entry-comment" maxlength="3000" ${locked?'disabled':''} placeholder="Only information needed for billing">${esc(e?.comment||'')}</textarea></label></section>`:''}${e&&!locked?'<button id="remove-entry" class="text-button danger">Remove this billing date</button>':''}<details class="billing-history"><summary>Previous billing dates & patient details</summary><p class="hint">PHN ${esc(p.phn||'—')} · Usual ICD ${esc(p.codes||'—')}</p>${ledger.entries.filter(x=>x.patientKey===p.key).sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<div class="history-row"><span>${esc(formatDate(x.date))}<small> · ${x.items.map(i=>i.code).join(', ')}${x.batchId?' · Given to Suzy':''}</small></span><button data-edit="${x.id}">View</button></div>`).join('')||'<p class="hint">No billing recorded yet.</p>'}${ledger.baselines[p.key]?`<p class="hint">Starting qualifying billing: ${esc(formatDate(ledger.baselines[p.key].date))}</p>`:''}${historical.length?`<h3>Already billed · imported</h3>${historical.map(h=>`<div class="history-row"><span>${esc(formatDate(h.date))} · ${h.codes.map(esc).join(', ')}<small>${esc(h.reason||'')} · ${sourceLabel(h.sources)}</small></span></div>`).join('')}`:''}</details>`;
  hospitalControls.mount($('editor'),p,date());
  const dateLabel=$('editor').querySelector('.editor-date');dateLabel.setAttribute('aria-live','polite');dateLabel.innerHTML='<small>Billing for</small><strong>'+esc(formatDate(date()))+'</strong>';
  if(blocked){
    const comparison=document.createElement('section');comparison.id='billing-conflict-preview';comparison.innerHTML='<h3>Pending on this computer</h3>'+(e?billingRows(e):'<p>No pending billing for this date.</p>')+savedPatientHistory(p.key,remoteBilling);
    $('editor').querySelector('.editor-head').after(comparison);
    $('editor').querySelector('.billing-history').open=true;
  }
  if(historical.some(h=>h.date===date())){$('editor').insertAdjacentHTML('afterbegin','<div class="issue-box">Already billed on this date. No new charge can be added.</div>');$('editor').querySelectorAll('[data-code],#add-code,[data-remove-code],input,textarea,select').forEach(x=>x.disabled=true);}
  const latestRemoval=(ledger.cancellations||[]).filter(c=>c.before.patientKey===p.key&&c.before.date===date()&&!c.undoneAt&&!savedBase?.cancellations?.some(b=>b.id===c.id)).at(-1);
  if(latestRemoval){const undo=document.createElement('button');undo.className='undo-removal';undo.textContent='Undo last code removal';undo.disabled=locked||writeUnavailable()||saving;undo.onclick=safe(()=>undoCancellation(latestRemoval.id));$('editor').append(undo);}
  const newItem=code=>({code,units:1,...timeDefaults(code),...(code==='00127'?{diagnosis:'V66.7'}:{}),...(CONFERENCE_CODES.includes(code)?{diagnosisSource:'primary114'}:{}),...(code==='00114'?{diagnosisMode:'per-charge',...(billingMode==='concern'?{concernBilling:true}:{})}:{})});
  $('editor').querySelectorAll('[data-code]').forEach(b=>b.onclick=safe(()=>{const current=currentEntry()?.items||[];if(current.some(i=>i.code===b.dataset.code))cancelCode(currentEntry().id,b.dataset.code);else applyItems([...current,newItem(b.dataset.code)]);renderEditor();}));
  const addCode=code=>{if(!/^\d{5}$/.test(code))throw new Error('Enter the full five-digit fee code.');if(currentEntry()?.items.some(i=>i.code===code))throw new Error('That code is already selected.');applyItems([...(currentEntry()?.items||[]),newItem(code)]);renderEditor();};
  $('add-code').onclick=safe(()=>addCode($('custom-code').value.trim()));$('other-code').onchange=safe(()=>{if($('other-code').value)addCode($('other-code').value);});
  $('editor').querySelectorAll('[data-remove-code]').forEach(b=>b.onclick=safe(()=>{cancelCode(currentEntry().id,b.dataset.removeCode);}));
  $('editor').querySelectorAll('[data-field]:not([data-time-text])').forEach(input=>input.addEventListener('input',safe(()=>{const list=clone(currentEntry().items),item=list[Number(input.dataset.index)];item[input.dataset.field]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;if(input.dataset.field==='diagnosis'&&CONFERENCE_CODES.includes(item.code))item.diagnosisSource='manual';if(input.dataset.field==='customTimed'&&item.customTimed&&!item.start){item.start=roundedPacificTime();item.end=tenMinutesLater(item.start);item.endAuto=true;}if(item.code==='00114'&&['reason','diagnosis'].includes(input.dataset.field))item.diagnosisMode='per-charge';applyItems(list);for(const el of $('editor').querySelectorAll('[data-field="diagnosis"]')){if(el!==input)el.value=currentEntry()?.items[Number(el.dataset.index)]?.diagnosis||'';}if(input.dataset.field==='customTimed')renderEditor();else renderEditorIssues();})));
  bindTimeFields($('editor'),{guard:()=>{try{guardWrite();return !currentEntry()?.batchId;}catch(e){notice(e.message);return false;}},change:safe((index,field,value)=>{guardWrite();const list=clone(currentEntry().items);if(currentEntry().batchId)return;list[index]=editBillingTime(list[index],field,value);applyItems(list);if(field==='start'){const end=$('editor').querySelector(`[data-index="${index}"][data-field="end"]`);if(end){end.value=list[index].end||'';end.dispatchEvent(new Event('time-refresh'));}}renderEditorIssues();})});
  $('editor').querySelectorAll('[data-reason-preset]').forEach(button=>button.onclick=safe(()=>{guardWrite();const list=clone(currentEntry().items),item=list[Number(button.dataset.index)],preset=REASON_PRESETS[Number(button.dataset.reasonPreset)];if(!preset||item?.code!=='00114')return;if((item.reason?.trim()||item.diagnosis?.trim())&&!REASON_PRESETS.some(p=>p.reason===item.reason&&p.diagnosis===item.diagnosis)&&!confirm('Replace the current billing reason and diagnosis with this preset?'))return;Object.assign(item,preset,{diagnosisMode:'per-charge'});applyItems(list);renderEditor();}));
  if($('entry-comment'))$('entry-comment').oninput=safe(()=>{if(!currentEntry())return;applyItems(clone(currentEntry().items),$('entry-comment').value);renderEditorIssues();});
  enhanceDateInputs($('editor'));
  if($('remove-entry'))$('remove-entry').onclick=safe(()=>cancelCode(currentEntry().id));
  $('editor').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEntry(b.dataset.edit));renderEditorIssues();updateWriteLock();
}
function itemHTML(i,index,locked){
  if(i.code==='13334')return `<div class="code-details bonus-card"><h3>13334 · First-visit bonus<button class="text-button danger" data-remove-code="13334" ${locked?'disabled':''}>Remove ×</button></h3><small>${i.autoAdded?'Added automatically with the qualifying visit.':'First-visit bonus.'}</small></div>`;
  const c=codeInfo(i.code);const field=(name,label,type='text',extra='')=>type==='time'?timeField(i,index,name,label,locked):`<label>${label}<input type="${type}" data-index="${index}" data-field="${name}" ${type==='checkbox'?(i[name]?'checked':''):`value="${esc(i[name]??'')}"`} ${locked?'disabled':''} ${extra}></label>`;
  return `<div class="code-details"><h3>${esc(i.code.replace(/^0+/,''))} · ${esc(c?.label||'Other code')}<button class="text-button danger" data-remove-code="${i.code}" ${locked?'disabled':''}>Remove ×</button></h3>${!c?field('customLabel','Description')+field('customVerified','I checked this code’s service-date rules','checkbox')+field('customTimed','This code requires start/end times','checkbox'):''}${c?.timed||!c?`<div class="fields">${field('start','Start','time')}${field('end','End','time')}${field('units','Units','number',`min="1" max="${c?2:99}"`)}</div>`:c?.attendance?field('start','Attendance time','time'):''}${c?.request?field('requestAt','Request date and time','datetime-local')+field('requester','Requesting person / role'):''}${c?.participants?field('participants','Participants / roles'):''}${i.code==='00114'?reasonPresetHTML(i,index,locked,field):`<div class="reason-diagnosis">${i.code==='14077'?`<label>Note (optional)<textarea aria-label="Note (optional)" data-index="${index}" data-field="reason" maxlength="2000" ${locked?'disabled':''}>${esc(i.reason||'')}</textarea></label>`:CONFERENCE_CODES.includes(i.code)?'':field('reason',c?.reason||!person(selected)?.panel?'Reason / claim note (required)':'Reason / claim note','text','maxlength="2000"')}${field('diagnosis','ICD-9 for this billing','text','maxlength="32" placeholder="Up to 3 codes; spaces or commas" title="Enter up to 3 ICD-9 codes, separated by spaces, commas or semicolons. Usual diagnosis if blank."')}</div>`}${c?.admission||c?.callout?field('attested',c.admission?'I confirm admission criteria and required documentation':'I confirm special call, travel and first patient on this call','checkbox'):''}<details class="code-guidance"><summary>Code guidance</summary><p>${esc(c?.note||'Rules for this code must be verified before finalizing.')}</p></details></div>`;
}

function reasonPresetHTML(item,index,locked,field){
  return `<div class="reason-workspace"><div class="reason-presets" aria-label="Common billing reasons">${REASON_PRESETS.map((p,n)=>`<button type="button" data-reason-preset="${n}" data-index="${index}" aria-pressed="${item.reason===p.reason&&item.diagnosis===p.diagnosis}" ${locked?'disabled':''}><span>${esc(p.reason)}</span><small>${esc(p.diagnosis)}</small></button>`).join('')}</div><div class="reason-diagnosis"><label>Billing reason / comment<textarea data-index="${index}" data-field="reason" maxlength="2000" ${locked?'disabled':''} placeholder="Type a reason, or choose one above…">${esc(item.reason||'')}</textarea></label>${field('diagnosis','ICD-9 for this billing','text','maxlength="32" placeholder="Up to 3 codes; spaces or commas" title="Enter up to 3 ICD-9 codes, separated by spaces, commas or semicolons. Usual diagnosis if blank."')}</div></div>`;
}
function renderEditorIssues(){const e=currentEntry();$('editor').querySelectorAll('[data-reason-preset]').forEach(b=>{const i=e?.items[Number(b.dataset.index)],p=REASON_PRESETS[Number(b.dataset.reasonPreset)];b.setAttribute('aria-pressed',String(i?.reason===p.reason&&i?.diagnosis===p.diagnosis));});if(!$('editor-issues'))return;const issues=e?entryIssues(e,ledger,person(selected)):[];$('editor-issues').innerHTML=issues.length?`<div class="issue-box"><strong>Saved as a draft · needs information</strong><ul>${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:e?'<p class="hint">Required fields complete. Physician eligibility review still required.</p>':'';}
function openEntry(id){if(saving||checking)return notice('Wait for the current save before opening another entry.');const e=ledger.entries.find(e=>e.id===id);if(!e)return;if(e.date!==date()&&notes.hasChanges())return notice('Save your current notes before opening another date.');if(e.date!==date())void notes.selectDate(e.date);selected=e.patientKey;editingId=e.id;$('service-date').value=e.date;calendarMonth=e.date.slice(0,7);switchTab('billing');renderCalendar();renderStats();renderRoster();renderEditor();}
function chosen(){return batchEntries(ledger,$('batch-from').value,$('batch-to').value);}
function issuesFor(entries){return entries.flatMap(e=>entryIssues(e,ledger,person(e.patientKey)).map(issue=>({id:e.id,text:`${person(e.patientKey)?.name||'Patient'} · ${formatDate(e.date)} · ${issue}`})));}
function signature(){return JSON.stringify({entries:chosen(),layout:$('report-layout').value,revision:ledger.revision,parallel:ledger.settings.parallel});}
function renderReports(){const entries=chosen(),issues=issuesFor(entries);$('batch-summary').innerHTML=`<p><strong>${entries.length}</strong> patient-date entries · <strong>${new Set(entries.map(e=>e.date)).size}</strong> dates · <strong>${new Set(entries.map(e=>e.patientKey)).size}</strong> patients</p>`;$('batch-issues').innerHTML=issues.length?'<div class="card"><p>'+issues.length+' items need attention in this print selection.</p><button id="open-billing-review">Open Billing review</button></div>':'';if($('open-billing-review'))$('open-billing-review').onclick=()=>switchTab('review');$('finalize').disabled=ledger.settings.parallel;}
function pendingReviewIssues(){return ledger?issuesFor(ledger.entries.filter(e=>!e.batchId)):[];}
function renderReviewBadge(){
  const button=document.querySelector('.nav[data-tab="review"]'),count=pendingReviewIssues().length;
  let badge=$('billing-review-badge');
  if(!badge){badge=document.createElement('span');badge.id='billing-review-badge';badge.setAttribute('aria-hidden','true');button.append(badge);}
  badge.hidden=!count;
  const text=count?'★ '+count:'';if(badge.textContent!==text)badge.textContent=text;
  button.setAttribute('aria-label',count?`Billing review, ${count} ${count===1?'item needs':'items need'} attention`:'Billing review');
  button.title=count?`${count} ${count===1?'item needs':'items need'} attention across all billing not yet handed over`:'No billing items need attention';
}
function renderReview(){
  const issues=pendingReviewIssues();
  $('review-issues').innerHTML='<div class="card"><h2>'+issues.length+' item'+(issues.length===1?'':'s')+' need attention</h2>'+(issues.length?issues.map(x=>'<div class="history-row"><span>'+esc(x.text)+nameCopy(person(ledger.entries.find(e=>e.id===x.id)?.patientKey)?.name||'Patient')+'</span><button data-review-entry="'+esc(x.id)+'">Review</button></div>').join(''):'<p>No missing billing information found in the current batch.</p>')+'</div>';
  $('review-issues').querySelectorAll('[data-review-entry]').forEach(b=>b.onclick=()=>openEntry(b.dataset.reviewEntry));
}
function sourceLabel(sources){return (sources||[]).map(s=>`${esc(s.file||'Source scan')} · page ${esc(s.page)}`).join('; ');}
function historyPatientLink(key,fallback='Patient'){
  return '<button class="text-button history-patient-link" data-history-patient="'+esc(key)+'">'+esc(person(key)?.name||ledger.patients[key]?.name||fallback)+'</button>'+nameCopy(person(key)?.name||ledger.patients[key]?.name||fallback);
}
function historyCodeHTML(i,e,imported=false){
  // Show stored per-charge values. A legacy usual-code fallback is labelled,
  // not presented as an explicitly recorded diagnosis.
  const usual=ledger.patients[e.patientKey]?.codes||'';
  const primary=i.code==='13334'?e.items?.find(x=>['00114','00127','13115'].includes(x.code))?.diagnosis:'';
  const diagnosis=i.diagnosis||primary||(!imported?usual:'');
  return '<div class="history-code"><span class="history-code-label"><strong>'+esc(i.code.replace(/^0+/,''))+(i.units>1?' × '+esc(i.units):'')+'</strong>'+
    (i.reason?'<span class="history-reason">'+esc(i.reason)+'</span>':'')+
    (diagnosis?'<small>ICD-9: '+esc(diagnosis)+(!i.diagnosis&&!primary?' · usual reference':'')+'</small>':'<small>ICD-9 not recorded</small>')+
    (i.start||i.end||codeInfo(i.code)?.timed||i.customTimed?'<small class="history-code-time">'+(i.start||i.end?'Start '+esc(i.start||'not recorded')+' · End '+esc(i.end||'not recorded'):'Time not recorded')+'</small>':'')+
    '</span>'+(!imported&&!e.batchId?'<button class="text-button danger" data-history-remove="'+esc(e.id)+'" data-history-code="'+esc(i.code)+'">Remove ×</button>':'')+'</div>';
}
function historyTable(records){
  return '<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Date</th><th>Patient</th><th>Billing details</th><th>Status</th><th></th></tr></thead><tbody>'+
    records.map(({e,imported})=>'<tr><td>'+esc(formatDate(e.date))+'</td><td>'+historyPatientLink(e.patientKey,e.name)+'</td><td>'+
      (imported?(e.codes||[]).map(code=>historyCodeHTML(e.items?.find(i=>i.code===code)||{code,diagnosis:e.diagnosis||e.icd9||''},e,true)).join(''):e.items.map(i=>historyCodeHTML(i,e)).join(''))+
      (imported&&e.reason?'<p class="history-comment">'+esc(e.reason)+'</p>':'')+
      (e.comment?'<p class="history-comment">Comment: '+esc(e.comment)+'</p>':'')+
      '</td><td>'+(imported?'Already billed · imported':e.batchId?'Given to Suzy':'Current batch')+'</td><td>'+
      (imported?'<small>'+sourceLabel(e.sources)+'</small>':'<div class="history-actions"><button data-history="'+esc(e.id)+'">'+(e.batchId?'View':'View / edit')+'</button>'+(!e.batchId?'<button class="text-button danger" data-history-remove="'+esc(e.id)+'">Remove all</button>':'')+'</div>')+
      '</td></tr>').join('')+'</tbody></table></div>'+(records.length?'':'<div class="empty">No recorded billing.</div>');
}
function showPatientHistory(key){
  const group=patientHistoryGroups(ledger,people()).find(g=>g.keys.has(key));
  historyPatient=group?.patient.key||key;historyView='patient';$('history-search').value=group?.patient.name||person(key)?.name||ledger.patients[key]?.name||'';switchTab('history');
}
function renderHistoryCalendar(){
  $('history-calendar-month').textContent=new Intl.DateTimeFormat('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(historyMonth+'-01T12:00:00Z'));
  const groups=historyView==='patient'?patientHistoryGroups(ledger,people()).find(g=>g.keys.has(historyPatient)):null;
  const days=new Set([...ledger.entries,...ledger.historicalBillings||[],...heldImports(ledger)].filter(e=>historyView!=='patient'||groups?.keys.has(e.patientKey)).map(e=>e.date));
  $('history-calendar-days').innerHTML=calendarDays(historyMonth).map(d=>d?'<button data-history-day="'+d+'" aria-label="'+esc(new Intl.DateTimeFormat('en-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')))+(days.has(d)?', billing recorded':'')+'" aria-pressed="'+(historyDate===d)+'" '+(d===today()?'aria-current="date"':'')+' class="'+(days.has(d)?'has-billing':'')+'">'+Number(d.slice(-2))+'</button>':'<span></span>').join('');
  $('history-calendar-days').querySelectorAll('[data-history-day]').forEach(b=>b.onclick=()=>{historyDate=b.dataset.historyDay;renderHistory();});
}
function renderHistory(){
  renderHistoryCalendar();
  $('history-date-status').textContent=historyDate?'Showing billings for '+formatDate(historyDate):'Showing all dates';$('history-date-clear').setAttribute('aria-pressed',String(!historyDate));
  const patientMode=historyView==='patient';
  $('history-by-date').setAttribute('aria-pressed',String(!patientMode));$('history-by-patient').setAttribute('aria-pressed',String(patientMode));
  $('history-patient-picker').hidden=!patientMode;
  const groups=patientHistoryGroups(ledger,people()),group=groups.find(g=>g.keys.has(historyPatient));
  if(group)historyPatient=group.patient.key;
  const pts=groups.map(g=>g.patient).filter(p=>matchesPatientSearch(p,$('history-search').value)).sort((a,b)=>a.name.localeCompare(b.name));
  $('history-patient-results').innerHTML=pts.map(p=>'<div class="history-patient-choice"><button data-history-patient="'+esc(p.key)+'" aria-pressed="'+(historyPatient===p.key)+'"><strong>'+esc(p.name)+'</strong><small>PHN '+esc(p.phn||'not recorded')+'</small></button>'+nameCopy(p.name)+'</div>').join('')||'<p>No matching patients.</p>';
  const p=group?.patient,last=group?[...group.keys].map(key=>lastBilling(ledger,key)).filter(Boolean).sort().at(-1):null;
  $('history-patient-summary').innerHTML=patientMode&&p?'<h2>'+esc(p.name)+nameCopy(p.name)+'</h2><p>Last recorded billing: <strong>'+esc(last?formatDate(last):'Unknown')+'</strong></p>'+
    (ledger.baselines[p.key]?'<p class="hint">Starting date: '+esc(formatDate(ledger.baselines[p.key].date))+' (no charge details recorded for this starting date).</p>':'')+
    (group.keys.size>1?'<p class="hint">Includes earlier billing recorded before the PHN was added. Original records are preserved.</p>':''):'';
  const matches=e=>(!patientMode||Boolean(group?.keys.has(e.patientKey)))&&(!historyDate||e.date===historyDate);
  const entries=newestBillingFirst(ledger.entries).filter(matches),historical=[...(ledger.historicalBillings||[])].filter(matches).sort((a,b)=>b.date.localeCompare(a.date));
  const currentRows=entries.map(e=>({e,imported:false})),oldRows=historical.map(e=>({e,imported:true}));
  if(patientMode){
    $('history-content').innerHTML=historyPatient?'<div class="card"><h2>Patient billing history</h2>'+historyTable([...currentRows,...oldRows].sort((a,b)=>b.e.date.localeCompare(a.e.date)||String(b.e.createdAt||'').localeCompare(String(a.e.createdAt||''))))+'</div>':'<div class="card empty">Select a patient to see their previous billings.</div>';
  }else{
    const held=heldImports(ledger).filter(h=>!historyDate||h.date===historyDate);
    $('history-content').innerHTML='<div class="card"><h2>Billing records</h2><p class="hint">Newest billing date first.</p>'+historyTable(currentRows)+'</div><div class="card"><h2>Already billed · '+historical.length+' imported records</h2><p>Read-only. Missing historical details are not inferred.</p>'+historyTable(oldRows)+'</div>'+
      '<div class="card"><h2>Held for clarification · '+held.length+'</h2><p>Not charges. Not included in reports or next-billing calculations.</p>'+held.map(h=>'<div class="history-row"><span>'+esc(formatDate(h.date))+' · '+esc(h.name)+nameCopy(h.name)+'<br>'+esc(h.reason)+'<br><small>'+sourceLabel([h.source])+'</small></span></div>').join('')+'</div>'+
      (historyDate?'':ledger.batches.map(b=>'<div class="card"><h3>'+esc(formatDate(b.from))+' → '+esc(formatDate(b.to))+'</h3><p>'+b.entryIds.length+' entries · handed over '+esc(formatTimestamp(b.handedOverAt))+'</p></div>').join(''));
  }
  const recent=(ledger.cancellations||[]).filter(c=>!c.undoneAt&&!savedBase?.cancellations?.some(b=>b.id===c.id)&&matches(c.before));
  if(recent.length)$('history-content').insertAdjacentHTML('afterbegin','<section class="card history-removals"><h3>Removals waiting to save</h3><p>These changes are on this device until you save the session to Drive.</p>'+recent.map(c=>'<div class="history-row"><span>'+esc(ledger.patients[c.before.patientKey]?.name||'Patient')+' · '+esc(formatDate(c.before.date))+'<small>Removed: '+c.before.items.filter(i=>!c.after?.items.some(a=>a.code===i.code)).map(i=>esc(i.code.replace(/^0+/,''))).join(', ')+'</small></span><button data-history-undo="'+esc(c.id)+'">Undo removal</button></div>').join('')+'</section>');
  $('history').querySelectorAll('[data-history-patient]').forEach(b=>b.onclick=()=>showPatientHistory(b.dataset.historyPatient));
  $('history-content').querySelectorAll('[data-history-remove]').forEach(b=>b.onclick=safe(()=>cancelCode(b.dataset.historyRemove,b.dataset.historyCode||null)));
  $('history-content').querySelectorAll('[data-history-undo]').forEach(b=>b.onclick=safe(()=>undoCancellation(b.dataset.historyUndo)));
  $('history-content').querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>openEntry(b.dataset.history));
  updateWriteLock();
}
function baselineCopy(){let box=$('baseline-name-copy');if(!box){box=document.createElement('span');box.id='baseline-name-copy';$('baseline-patient').after(box);}const p=person($('baseline-patient').value);box.innerHTML=p?nameCopy(p.name):'';}
function renderSettings(){
  const previousPatient=$('baseline-patient').value,all=people(),missing=all.filter(p=>{const s=dueState(ledger,p,today());return p.panel&&s.kind==='unknown'&&!s.firstRoutine;}),choices=($('baseline-show-all').checked?all:missing).sort((a,b)=>a.name.localeCompare(b.name));
  $('baseline-needed-count').textContent=missing.length?'· '+missing.length+' need history':'· Setup complete';
  $('baseline-needed-status').textContent=missing.length?missing.length+' active patient'+(missing.length===1?' needs':'s need')+' a last known qualifying billing date.':'All active patients have a starting date or qualifying billing history. No routine setup is needed.';
  // Historical setup stays collapsed until explicitly opened.
  $('parallel').checked=ledger.settings.parallel;$('baseline-patient').innerHTML=choices.map(p=>`<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('')||'<option value="">No missing starting dates</option>';
  if(previousPatient&&choices.some(p=>p.key===previousPatient))$('baseline-patient').value=previousPatient;
  baselineCopy();$('baseline-date').value=ledger.baselines[$('baseline-patient').value]?.date||'';enhanceDateInputs(document);
  $('baseline-list').innerHTML=Object.entries(ledger.baselines).map(([k,b])=>`<div class="history-row">${esc(person(k)?.name||'Retained patient')}${nameCopy(person(k)?.name||'Retained patient')} <span>${esc(formatDate(b.date))}</span></div>`).join('');
  const year=$('totals-year').value;const counts={};for(const e of ledger.entries.filter(e=>e.date.startsWith(year)))for(const i of e.items.filter(i=>i.code!=='14077'))counts[i.code]=(counts[i.code]||0)+Number(i.units);
  $('annual-counts').innerHTML=Object.entries(counts).map(([c,n])=>`<div class="history-row"><span>${c}</span><span>${n} units · ${year}</span></div>`).join('')||'<p class="hint">No recorded usage this year.</p>';
  if(ledger.historicalBillings?.some(h=>h.codes.some(code=>codeInfo(code)?.annual&&code!=='13121')))$('annual-counts').insertAdjacentHTML('beforeend','<p class="issue-box">Imported billed records also exist. Their units are unverified and are not included in these totals. Relevant annual-limit codes are flagged for reconciliation before handoff.</p>');
  $('import-receipts').textContent=(ledger.imports||[]).map(i=>`Imported ${formatTimestamp(i.importedAt)}: ${i.summary.billed} already billed, ${i.summary.pending} in the current batch, ${i.summary.held} held.${i.summary.resolved?` ${i.summary.resolved} prior held items resolved.`:''}`).join(' ');
  updateWriteLock();
}

function openImport(){if(!adapter&&!setupCandidate)return;stagedImport=null;importRead++;$('import-file').value='';$('import-preview').textContent='';$('import-error').textContent='';$('import-apply').disabled=true;$('import-dialog').showModal();}
const setupImport=document.createElement('button');setupImport.id='setup-import';setupImport.className='primary';setupImport.textContent='Import reviewed billing file';setupImport.hidden=true;$('create-cloud').after(setupImport);setupImport.onclick=openImport;
const importCard=document.createElement('div');importCard.className='card';importCard.innerHTML='<h2>Import reviewed billing</h2><p>Add a reviewed JSON package with billed history, current-batch charges and held clarification items. Re-importing the same package will not duplicate charges.</p><button id="open-import">Choose reviewed billing file</button><p id="import-receipts" class="hint"></p>';$('settings').querySelector('.settings-grid').append(importCard);$('open-import').onclick=openImport;
const overview=document.createElement('details');overview.className='card';overview.innerHTML='<summary>Panel summary & storage</summary><div id="stats" class="stats"></div><p id="storage-note" class="storage-note"></p>';$('settings').append(overview);
$('import-file').onchange=async()=>{
  const read=++importRead;stagedImport=null;$('import-apply').disabled=true;$('import-error').textContent='';$('import-preview').textContent='';
  try{const file=$('import-file').files[0];if(!file)return;if(file.size>8_000_000)throw new Error('Import is too large.');const text=await file.text(),p=parseImport(text),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)),sha256=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');if(read!==importRead)return;
    const result=mergeImport(ledger||blankLedger(),p,sha256);const s=result.summary;stagedImport={p,sha256};$('import-preview').textContent=`${s.billed} already billed · ${s.pending} in the current batch · ${s.baselines} starting dates · ${s.held} held for clarification.${s.resolved?` ${s.resolved} prior held items resolved.`:''}${result.duplicate?' This package is already loaded.':''}`;$('import-apply').disabled=result.duplicate;
  }catch(e){if(read===importRead)$('import-error').textContent=e.message;}
};
$('import-close').onclick=()=>{if(!importing){stagedImport=null;importRead++;$('import-dialog').close();}};
$('import-dialog').addEventListener('cancel',e=>{if(importing)e.preventDefault();});
$('import-apply').onclick=async()=>{
  if(importing||!stagedImport)return;
  importing=true;$('import-apply').disabled=true;$('import-file').disabled=true;$('import-close').disabled=true;$('workspace').inert=true;$('import-error').textContent='';
  try{
    // First setup creates an empty private file, then uses the same revision-
    // checked save as an existing workspace. A failed import never replaces data.
    if(!adapter&&!await connect('cloud',true))throw new Error($('connection-error').textContent);
    if(dirty||saving||blocked)throw new Error('Choose Save to Drive or resolve local recovery before importing.');
    const fresh=await adapter.load();if(fresh.etag!==etag)throw new Error('Billing changed elsewhere. Reload saved data, then choose the import again. Nothing was imported.');
    const result=mergeImport(ledger,stagedImport.p,stagedImport.sha256);
    if(!result.duplicate){if(ledger.entries.length||ledger.historicalBillings?.length||Object.keys(ledger.baselines).length)download(`PRIVATE_TRIM_Before_Import_${today()}.json`,ledger);commit(result.ledger);await recoveryQueue;notice('Reviewed billing imported locally. Choose Save to Drive when ready.');}
    stagedImport=null;$('import-file').value='';$('import-dialog').close();renderAll();switchTab('history');notice(`Import prepared locally: ${result.summary.billed} already billed, ${result.summary.pending} in the current batch, ${result.summary.held} held for clarification.${result.summary.resolved?` ${result.summary.resolved} prior held items resolved.`:''} Choose Save to Drive to finish. No billing was submitted.`);
  }catch(e){$('import-error').textContent=e.message;}
  finally{importing=false;$('workspace').inert=false;$('import-file').disabled=false;$('import-close').disabled=false;$('import-apply').disabled=!stagedImport;}
};
function switchTab(name){onNavigate(name);if(name==='routine'){setBillingMode('routine');name='billing';}else if(name==='billing'){setBillingMode('concern');}tab=name;document.querySelectorAll('.tab').forEach(s=>s.hidden=s.id!==name);document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',name==='billing'?b.dataset.tab===(billingMode==='routine'?'routine':'billing'):b.dataset.tab===name));if(name==='reports')renderReports();if(name==='review')renderReview();if(name==='history')renderHistory();if(name==='settings')renderSettings();}
function setBillingMode(mode){billingMode=mode;$('billing').dataset.mode=mode;$('panel-filter').value=mode==='routine'?'mine':'all';$('panel-filter').hidden=true;$('unit-filter').hidden=mode==='concern';$('routine-filters').hidden=mode==='concern';$('search-scope').hidden=mode==='routine';$('due-filter').checked=mode==='routine';$('add-patient-section').hidden=mode==='routine';$('mode-title').textContent=mode==='routine'?'Routine Billing':'Concern Billing';$('mode-help').textContent=mode==='routine'?'Your panel · due for 14-day billing review. Choose individual or batch billing.':'Search any patient · record the concern, billing code and relevant details.';if(mode==='routine'&&selected&&!person(selected)?.panel){selected=null;editingId=null;}renderRoster();renderEditor();renderRoutineBatch();}
function selectedRoutineCandidates(){
  return ledger&&roster?routineCandidates(ledger,people(),date()).filter(c=>c.status==='due'&&routineUnits.has(c.patient.unit)&&!routineExcluded.has(c.patient.key)):[];
}
function renderRoutineBatch(){
  const batch=billingMode==='routine'&&routineView==='batch';
  $('routine-views').hidden=billingMode!=='routine';$('routine-individual').setAttribute('aria-pressed',String(routineView==='individual'));$('routine-batch').setAttribute('aria-pressed',String(routineView==='batch'));
  $('billing').querySelector('.billing-grid').hidden=batch;$('routine-batch-panel').hidden=!batch;
  if(!ledger||!roster)return;
  const candidates=routineCandidates(ledger,people(),date());
  const units=[...roster.units];for(const c of candidates)if(!units.some(u=>u.id===c.patient.unit))units.push({id:c.patient.unit,name:c.patient.unit||'Location not recorded'});
  $('routine-units').innerHTML=units.map(u=>{
    const group=candidates.filter(c=>c.patient.unit===u.id);if(!group.length)return '';
    return '<label class="batch-unit"><input type="checkbox" data-routine-unit="'+esc(u.id)+'" '+(routineUnits.has(u.id)?'checked':'')+'><span><strong>'+esc(u.name)+(u.floor?' · Floor '+esc(u.floor):'')+'</strong><small>'+group.filter(c=>c.status==='due').length+' due · '+group.filter(c=>c.status==='review').length+' need review · '+group.filter(c=>c.status==='billed').length+' already billed</small></span></label>';
  }).join('');
  const inUnits=candidates.filter(c=>routineUnits.has(c.patient.unit)),due=inUnits.filter(c=>c.status==='due'),review=inUnits.filter(c=>c.status==='review');
  $('routine-review').innerHTML='<p><strong>'+esc(formatDate(date()))+'</strong> · '+due.length+' due across selected units</p>'+(!routineUnits.size?'<p class="empty">Choose units to review their patients.</p>':due.length?'<div class="batch-patient-list">'+due.map(c=>'<label class="batch-patient"><input type="checkbox" data-routine-patient="'+esc(c.patient.key)+'" '+(!routineExcluded.has(c.patient.key)?'checked':'')+'><span><strong>'+esc(c.patient.name)+nameCopy(c.patient.name)+'</strong><small>'+esc(units.find(u=>u.id===c.patient.unit)?.name||c.patient.unit)+' · Room '+esc(c.patient.room||'—')+' · Last billing '+esc(formatDate(c.last))+'</small><small>Usual ICD-9: '+esc(c.usualCodes)+'</small></span></label>').join('')+'</div>':'<p class="empty">No patients are due in these units for this date.</p>')+
    (review.length?'<section class="batch-needs-review"><h3>Needs review · '+review.length+'</h3><p class="hint">Not included in this batch.</p>'+review.map(c=>'<p><strong>'+esc(c.patient.name)+nameCopy(c.patient.name)+'</strong> — '+esc(c.reason)+'</p>').join('')+'</section>':'')+
    (routineUnits.size?'<p class="hint">Excluded: '+inUnits.filter(c=>c.status==='billed').length+' already billed for this date · '+inUnits.filter(c=>c.status==='later').length+' not yet due · '+inUnits.filter(c=>c.status==='hospital').length+' in hospital (excluded from routine rounds).</p>':'');
  $('routine-units').querySelectorAll('[data-routine-unit]').forEach(el=>el.onchange=()=>{if(el.checked)routineUnits.add(el.dataset.routineUnit);else routineUnits.delete(el.dataset.routineUnit);renderRoutineBatch();});
  $('routine-review').querySelectorAll('[data-routine-patient]').forEach(el=>el.onchange=()=>{if(el.checked)routineExcluded.delete(el.dataset.routinePatient);else routineExcluded.add(el.dataset.routinePatient);updateRoutineAction();});
  const canUndo=routineReceipt&&routineReceipt.entries.some(e=>ledger.entries.some(x=>x.id===e.id))&&!routineReceipt.entries.some(e=>savedBase?.entries.some(x=>x.id===e.id));
  $('routine-result').innerHTML=canUndo?'<p>Routine batch added for '+esc(formatDate(routineReceipt.date))+'. Saved locally, not yet in Drive.</p><button id="undo-routine-batch">Undo this routine batch</button>':'';
  if($('undo-routine-batch'))$('undo-routine-batch').onclick=safe(()=>{guardWrite();commit(undoRoutineBatch(ledger,routineReceipt));routineReceipt=null;renderRoutineBatch();renderCalendar();renderHistory();notice('Routine batch undone locally. Other billing is unchanged.');});
  updateRoutineAction();
}
function updateRoutineAction(){const count=selectedRoutineCandidates().length;$('routine-add').textContent='Add 114 for '+count+' patient'+(count===1?'':'s');updateWriteLock();}
$('routine-individual').onclick=()=>{routineView='individual';renderRoutineBatch();};
$('routine-batch').onclick=()=>{routineView='batch';renderRoutineBatch();};
$('routine-add').onclick=safe(()=>{
  guardWrite();const keys=selectedRoutineCandidates().map(c=>c.patient.key);
  const result=addRoutineBatch(ledger,people(),date(),keys);commit(result.ledger);routineReceipt=result.receipt;routineExcluded.clear();renderRoutineBatch();renderCalendar();renderHistory();notice(keys.length+' routine 114 billings added locally. Save the session to Drive when finished.');
});
$('history-by-date').onclick=()=>{historyView='date';renderHistory();};
$('history-by-patient').onclick=()=>{historyView='patient';renderHistory();};
$('history-search').oninput=()=>renderHistory();
for(const [id,offset]of [['history-month-prev',-1],['history-month-next',1]])$(id).onclick=()=>{const month=new Date(historyMonth+'-01T12:00:00Z');month.setUTCMonth(month.getUTCMonth()+offset);historyMonth=month.toISOString().slice(0,7);renderHistoryCalendar();};
$('history-date-clear').onclick=()=>{historyDate='';renderHistory();};
$('history-date-calendar').onclick=()=>{historyDate=today();historyMonth=historyDate.slice(0,7);renderHistory();};
$('baseline-show-all').onchange=()=>renderSettings();
$('connect').onclick=openConnectionDialog;
$('local-option').hidden=!laptopRuntime();
$('local-connect').onclick=()=>connect('local');$('cloud-connect').onclick=()=>connect('cloud');
$('cloud-switch-account').onclick=()=>connect('cloud',false,true);
$('create-cloud').onclick=()=>{if(confirm('Create a new empty private billing file in My Drive? Only continue if you have no existing billing data to import. The original roster will not change.'))connect('cloud',true);};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('service-date').value=today();$('service-date').max=today();$('batch-from').value=today().slice(0,7)+'-01';$('batch-to').value=today();$('totals-year').value=today().slice(0,4);$('baseline-date').max=today();enhanceDateInputs(document);
$('service-date').onchange=()=>{const next=$('service-date').value;$('service-date').value=$('calendar').dataset.serviceDate||today();selectDate(next);};
$('month-prev').onclick=()=>{const d=new Date(calendarMonth+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);calendarMonth=d.toISOString().slice(0,7);renderCalendar();};
$('month-next').onclick=()=>{const d=new Date(calendarMonth+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);calendarMonth=d.toISOString().slice(0,7);renderCalendar();};
$('calendar-today').onclick=()=>selectDate(today());
for(const id of ['search','unit-filter','panel-filter','due-filter'])$(id).addEventListener('input',()=>renderRoster());
for(const id of ['batch-from','batch-to','report-layout'])$(id).onchange=()=>{printedSignature=null;renderReports();};
async function verifyConnection(){
  if(!adapter||!ledger||checking||saving||loadingLatest||blocked||document.hidden)return;
  checking=true;updateWriteLock();
  try{if(!navigator.onLine)throw new Error('No internet connection.');await patients.refresh();await adapter.verify(etag);checkedDrive();connectionVerified=true;syncFailed=false;status(dirty?'Saved on this device — not yet in Drive':adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive',dirty);}
  catch(e){connectionError(e);connectionVerified=false;syncFailed=true;if(e.status===409){blocked=true;try{remoteBilling=(await adapter.load()).ledger;}catch{}renderEditor();notice('Changes saved on another computer. Choose Load latest changes.');}else notice(e.message);status(e.status===409?'New Drive changes available':'Connection needs attention',true);}
  finally{checking=false;applyNewPatientPlans();updateWriteLock();}
}
async function syncSession(save=true){
  if(saving||checking)return;checking=true;updateWriteLock();
  try{
    if(!navigator.onLine)throw new Error('Reconnect to the internet. Your local work is retained.');
    if(!driveReachable)await adapter.connect();
    await recoveryQueue;
    const current=await adapter.load();remoteBilling=clone(current.ledger);checkedDrive();roster=patients.state().ready?normalizeRoster(patients.roster()):await adapter.roster();
    if(!dirty||sameBillingContent(ledger,current.ledger)){await adoptSaved(current);checking=false;applyNewPatientPlans();if(save&&dirty)await flush();renderAll();return;}
    const merged=mergeSession(savedBase,ledger,current.ledger,mergeChoices);
    if(merged.conflicts.length){
      blocked=true;mergeConflicts=merged.conflicts;renderEditor();renderMergeChoices();status('Review overlapping billing changes',true);
      notice('Choose which version to keep for the billing changed on both computers.');return;
    }
    // Rebase the local recovery before the one conditional upload. If the upload
    // fails, retry uses the same changes against the newly loaded Drive version.
    ledger=planNewPatients(merged.ledger,roster);savedBase=clone(current.ledger);etag=current.etag;seq++;
    dirty=!sameBillingContent(ledger,current.ledger);blocked=false;syncFailed=false;connectionVerified=true;
    printedSignature=null;mergeChoices={};mergeConflicts=[];await persistRecovery();
    if($('merge-dialog').open)$('merge-dialog').close();
    checking=false;
    if(dirty&&save)await flush();else if(!dirty)await adoptSaved(current);
    if(!dirty)notice('');
    renderAll();
  }catch(e){connectionError(e);connectionVerified=false;syncFailed=true;if(e.status===409)blocked=true;status(e.status===409?'Conflict — save stopped':'Connection needs attention',true);throw e;}
  finally{checking=false;updateWriteLock();}
}
async function adoptSaved(s){
  validateLedger(s.ledger);
  ledger=s.ledger;savedBase=clone(s.ledger);remoteBilling=clone(s.ledger);etag=s.etag;dirty=false;blocked=false;syncFailed=false;connectionVerified=true;printedSignature=null;mergeChoices={};mergeConflicts=[];seq++;
  checkedDrive();await persistRecovery();notice('');renderAll();
  if($('merge-dialog').open)$('merge-dialog').close();
  status(adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive');
  await backups.capture(s.ledger);
}
async function discardLocal(){
  if(saving||checking)return;
  if(!confirm('Discard unsaved changes on this computer and load the latest Drive billing? Billing already saved in Drive will not be changed.'))return;
  checking=true;updateWriteLock();
  try{
    if(!navigator.onLine)throw new Error('Reconnect first. Your local changes have not been discarded.');
    if(!driveReachable)await adapter.connect();
    await recoveryQueue;
    const current=await adapter.load();validateLedger(current.ledger);
    if(current.ledger.datasetId!==ledger.datasetId)throw new Error('Wrong billing file. Your draft has not been discarded.');
    // Keep a private encrypted safety copy on this device, without downloads.
    if(dirty)await saveRecovery(`${ledger.datasetId}:discarded`,{ledger:clone(ledger),baseLedger:clone(savedBase),etag,dirty:true,savedAt:new Date().toISOString()});
    selected=null;editingId=null;await adoptSaved(current);
    notice('Local changes discarded. Latest Drive billing loaded.');
  }finally{checking=false;updateWriteLock();}
}
function renderMergeChoices(){
  $('merge-list').innerHTML=mergeConflicts.map((c,n)=>`<article class="change-row"><strong>${esc(c.entry?c.label.replace((c.local||c.drive).date,formatDate((c.local||c.drive).date)):c.label)}</strong>${c.locked?'<p>Already handed over or imported in Drive. Keep the saved record.</p>':''}<div class="merge-versions"><section><h4>Drive version</h4>${mergeDetail(c,c.drive)}</section><section><h4>My local version</h4>${mergeDetail(c,c.local)}</section></div><label><input type="radio" name="merge-${n}" data-merge="${n}" value="drive"> Keep Drive version</label>${c.locked?'':`<label><input type="radio" name="merge-${n}" data-merge="${n}" value="local"> Use my local version</label>`}</article>`).join('');
  for(const [n,c] of mergeConflicts.entries())if(c.entry){const key=(c.local||c.drive)?.patientKey;if(key)$('merge-list').children[n].insertAdjacentHTML('beforeend',savedPatientHistory(key,remoteBilling));}
  $('merge-save').disabled=true;
  $('merge-list').querySelectorAll('[data-merge]').forEach(el=>el.onchange=()=>{
    const c=mergeConflicts[Number(el.dataset.merge)];mergeChoices[c.id]={token:c.token,side:el.value};
    $('merge-save').disabled=!mergeConflicts.every(c=>mergeChoices[c.id]?.token===c.token);
  });
  if($('changes-dialog').open)$('changes-dialog').close();
  if(!$('merge-dialog').open)$('merge-dialog').showModal();
}
function mergeDetail(c,value){return value===undefined?'<p>No entry / removed</p>':c.entry?billingRows(value):'<pre>'+esc(JSON.stringify(value,null,2))+'</pre>';}
function savedPatientHistory(key,data){
  if(!data)return '<p>Saved history could not be loaded. Use Load latest changes to retry.</p>';
  const entries=data.entries.filter(e=>e.patientKey===key).sort((a,b)=>b.date.localeCompare(a.date));
  const imported=(data.historicalBillings||[]).filter(e=>e.patientKey===key).sort((a,b)=>b.date.localeCompare(a.date));
  return '<details class="saved-drive-history" open><summary>Saved billing history in Drive</summary>'+entries.map(e=>'<article><strong>'+esc(formatDate(e.date))+(e.batchId?' · Handed over':' · Saved')+'</strong>'+billingRows(e)+'</article>').join('')+imported.map(e=>'<p>'+esc(formatDate(e.date))+' · '+e.codes.map(esc).join(', ')+' · Already billed (imported)</p>').join('')+(!entries.length&&!imported.length?'<p>No saved billing history.</p>':'')+'</details>';
}
async function loadLatest(){
  if(saving||checking||loadingLatest)return;
  loadingLatest=true;updateWriteLock();
  try{
    if(!driveReachable)await adapter.connect();
    await patients.refresh(true);
    if(patients.state().error){onPatientConflict();return;}
    checkedDrive();await syncSession(false);const dateReset=await resetBillingDate();renderAll();
    if(!blocked)notice('Latest Drive changes loaded. '+(dirty||patients.hasChanges()?'Your pending changes are retained; use Save to Drive when ready. ':'')+(!dateReset?'Save pending notes before resetting the date to today.':''));
  }finally{loadingLatest=false;updateWriteLock();}
}
$('merge-save').onclick=safe(()=>syncSession(true));
$('conflict-save').onclick=safe(()=>syncSession(true));
$('conflict-discard').onclick=safe(discardLocal);
$('changes-discard').onclick=safe(discardLocal);
$('sync').onclick=safe(saveSession);
$('drive-connection').onclick=safe(loadLatest);
$('lock').onclick=safe(async()=>{await notes.beforeLock();await patients.beforeLock();await persistRecovery();if((dirty||notes.hasChanges()||patients.hasChanges())&&!confirm('Changes remain on this device. Lock anyway? Reconnect on this browser to recover them.'))return;if(laptopStartup)sessionStorage.setItem(laptopLockKey,'yes');releaseLock?.();releaseLock=null;location.reload();});
$('other-form').onsubmit=async ev=>{ev.preventDefault();try{guardWrite();if(ocrBusy)throw new Error('Wait for screenshot reading to finish.');const p=coveragePatient(Object.fromEntries(new FormData(ev.target)),people(),crypto.randomUUID());const next=clone(ledger);next.nonPanel.push(p);next.patients[p.key]=p;commit(next);resetPatientForm();$('search').value='';$('unit-filter').value='';$('panel-filter').value='all';$('due-filter').checked=false;selected=p.key;editingId=null;renderRoster();renderEditor();}catch(e){$('other-error').textContent=e.message;}};
$('parallel').onchange=safe(()=>{const off=!$('parallel').checked;if(off&&!confirm('End paper-comparison mode? Only do this when you are ready to use digital reports as the single MOA billing source.')){$('parallel').checked=true;return;}const n=clone(ledger);n.settings.parallel=!off;commit(n);});
$('totals-year').onchange=renderSettings;
$('baseline-save').onclick=safe(()=>{const key=$('baseline-patient').value,value=$('baseline-date').value;if(!validDate(value)||value>today())throw new Error('Choose a valid past or current starting billing date.');const n=clone(ledger);n.baselines[key]={...n.baselines[key],date:value,enteredAt:new Date().toISOString()};n.patients[key]=clone(person(key));commit(n);renderSettings();});
$('baseline-patient').onchange=()=>{baselineCopy();$('baseline-date').value=ledger.baselines[$('baseline-patient').value]?.date||'';enhanceDateInputs(document);};
$('export-data').onclick=()=>download(`PRIVATE_TRIM_Billing_${today()}.json`,ledger);
$('reload-data').onclick=safe(discardLocal);
$('generate').onclick=safe(async()=>{
  guardWrite();
  if(dirty||blocked||saving)throw new Error('Choose Save to Drive before creating the batch.');
  const entries=chosen();if(!entries.length)throw new Error('No current-batch billing in this date range.');if(issuesFor(entries).length){renderReports();throw new Error('Complete the flagged information before generating the report.');}if(!$('rules-reviewed').checked)throw new Error('Review the billing entries and confirm the checkbox first.');
  $('report-dialog').showModal();try{const result=await renderReport($('report-frame'),ledger,roster,entries,$('report-layout').value);$('report-title').textContent=`${result.pages} pages · ${$('report-layout').value==='date'?'By date':'By patient'}`;printedSignature=null;}catch(e){$('report-dialog').close();throw e;}
});
$('print-report').onclick=()=>{printedSignature=signature();$('report-frame').contentWindow.focus();$('report-frame').contentWindow.print();};
$('finalize').onclick=safe(async()=>{guardWrite();if(dirty||blocked||saving)throw new Error('Choose Save to Drive before handoff.');if(printedSignature!==signature())throw new Error('Generate and print/save the current batch first.');if(issuesFor(chosen()).length)throw new Error('Resolve the flagged billing information first.');if(!confirm('Confirm this exact batch was successfully saved/printed, reviewed, and actually given to Suzy. It will leave the next print batch, but its billing history stays saved.'))return;commit(finalizeBatch(ledger,chosen(),{from:$('batch-from').value,to:$('batch-to').value,layout:$('report-layout').value,reviewed:$('rules-reviewed').checked,delivered:true}));notice('Batch marked as given to Suzy locally. Choose Save to Drive to finish.');renderReports();renderHistory();updateWriteLock();});
window.addEventListener('offline',()=>{driveReachable=false;connectionVerified=false;syncFailed=true;status('Offline — billing locked',true);});
window.addEventListener('online',()=>verifyConnection());
window.addEventListener('beforeunload',e=>{if(dirty||recoveryPending||backups.busy()){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)verifyConnection();});
setInterval(verifyConnection,45000);

function renderSaveControls(){
  if(!$('drive-connection'))return;
  renderReviewBadge();
  const offline=!navigator.onLine,connected=driveReachable&&!offline;
  $('drive-connection').dataset.state=checking?'busy':connected?'ok':'error';
  $('drive-connection').textContent=checking?'◌ Checking Drive…':connected?(adapter?.mode==='local'?'● Local folder connected':'● Drive connected'):'● Reconnect Drive';
  $('drive-connection').title=lastChecked?'Last checked '+formatTimestamp(lastChecked):'Check your connection without saving billing';
  $('drive-connection').disabled=saving||checking||loadingLatest||!adapter;
  const changes=localChanges(),count=changedBillCount(changes);
  $('local-changes').dataset.state=blocked||localRecoveryFailed?'error':dirty?'pending':'ok';
  $('local-changes').textContent=localRecoveryFailed?'! Local save needs attention':recoveryPending?'◌ Saving locally…':dirty?(count?'● '+count+' bill'+(count===1?'':'s')+' pending':'● Other local changes'):'✓ No local changes';
  $('local-changes').title=dirty?'Saved on this device, not in Drive. Click to review changes.':'Everything matches your last Drive save.';
  $('local-changes').disabled=!ledger;
  $('sync').textContent=saving?'◌ Saving session…':blocked?'Save my changes to Drive':'Save session to Drive';
  $('sync').dataset.state=saving?'busy':dirty?'pending':'quiet';
  $('sync').disabled=(!dirty&&!blocked)||saving||checking||offline;
  $('saved-time').textContent=dirty?'Not yet saved to Drive':savedBase?.updatedAt?'Saved '+formatTimestamp(savedBase.updatedAt):'No changes to save';
  if($('changes-save'))$('changes-save').disabled=$('sync').disabled;
  if($('changes-dialog').open)renderChanges();
  onStatus();
}
function cancelCode(id,code=null){
  guardWrite();
  if(!code&&!confirm('Remove all billing codes for this patient and date?'))return;
  commit(cancelBillingCodes(ledger,id,code));
  editingId=null;renderEditor();renderCalendar();renderHistory();renderChanges();
}
function undoCancellation(id){
  guardWrite();const before=ledger.cancellations?.find(c=>c.id===id)?.before;if(before)assertHospital114(person(before.patientKey),before.date,before.items);commit(undoBillingCancellation(ledger,id));renderEditor();renderCalendar();renderHistory();renderChanges();
}
function billingRows(entry,editable=false){
  if(!entry)return '';
  return '<ul class="change-codes">'+entry.items.map(i=>'<li><div><strong>'+esc(i.code.replace(/^0+/,''))+'</strong><span>'+esc([i.start?(i.start+(i.end?'–'+i.end:'')):'',i.reason||'',i.diagnosis?'ICD-9 '+i.diagnosis:'',i.units>1?i.units+' units':''].filter(Boolean).join(' · '))+'</span></div>'+(editable?'<button class="text-button danger" data-cancel-entry="'+esc(entry.id)+'" data-cancel-code="'+esc(i.code)+'" '+(writeUnavailable()||saving?'disabled':'')+'>Remove ×</button>':'')+'</li>').join('')+'</ul>'+(entry.comment?'<p>'+esc(entry.comment)+'</p>':'');
}
function renderChanges(){
  const changes=localChanges();
  $('changes-summary').textContent=localRecoveryFailed?'Local recovery failed. Keep this tab open and download a private backup in Settings.':recoveryPending?'Saving the latest changes on this device…':dirty?'Review the changes below, then save.':'No local changes waiting for Drive.';
  const removals=(ledger?.cancellations||[]).filter(c=>!c.undoneAt&&!savedBase?.cancellations?.some(b=>b.id===c.id));
$('changes-list').innerHTML=changes.map(r=>'<article class="change-row"><div><strong>'+esc(r.name)+nameCopy(r.name)+'</strong><span>'+esc(formatDate(r.date))+'</span></div><b>'+esc(!r.after&&r.before?'Will be removed from Drive':r.kind)+'</b>'+(r.before?'<h4>Before</h4>'+billingRows(r.before):'')+(r.after?'<h4>After</h4>'+billingRows(r.after):'')+(r.detail?'<p>'+esc(r.detail)+'</p>':'')+'</article>').join('')+removals.map(c=>'<article class="change-row removal-record"><strong>'+esc(ledger.patients[c.before.patientKey]?.name||'Patient')+nameCopy(ledger.patients[c.before.patientKey]?.name||'Patient')+'</strong><p>'+esc(formatDate(c.before.date))+' · Removed '+c.before.items.filter(i=>!c.after?.items.some(a=>a.code===i.code)).map(i=>esc(i.code.replace(/^0+/,''))).join(', ')+'</p><button data-undo-cancel="'+esc(c.id)+'" '+(writeUnavailable()||saving?'disabled':'')+'>Undo removal</button></article>').join('')||(dirty?'<p>A recovered session is waiting to save. No patient changes compared with the saved snapshot.</p>':'');
  $('changes-list').querySelectorAll('[data-undo-cancel]').forEach(b=>b.onclick=safe(()=>undoCancellation(b.dataset.undoCancel)));
  $('changes-conflict').hidden=!blocked;$('changes-conflict').textContent='Drive has newer billing. Save my changes to Drive combines your local work with it. Or discard local changes to use Drive only.';
  $('changes-save').textContent=blocked?'Save my changes to Drive':'Save session to Drive';
}
$('local-changes').onclick=()=>{renderChanges();$('changes-dialog').showModal();renderSaveControls();};
$('changes-save').onclick=safe(saveSession);
function clearScreenshot(){ocrRun++;ocrAbort?.abort();ocrAbort=null;ocrBusy=false;if(imageURL)URL.revokeObjectURL(imageURL);imageURL=null;$('patient-preview').removeAttribute('src');$('patient-preview').hidden=true;}
function resetPatientForm(){clearScreenshot();$('other-form').reset();$('ocr-status').textContent='Paste just the demographics area. The image stays on this device.';$('other-error').textContent='';setPatientBusy(false);updateWriteLock();}
function setPatientBusy(busy){ocrBusy=busy;for(const el of $('other-form').querySelectorAll('input,select'))el.disabled=busy;updateWriteLock();}
for(const input of $('other-form').querySelectorAll('[name="name"],[name="phn"]'))input.addEventListener('input',()=>updateWriteLock());
$('clear-screenshot').onclick=resetPatientForm;
$('paste-patient').addEventListener('paste',async event=>{
  const images=[...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/'));
  if(!images.length){$('ocr-status').textContent='Copy a screenshot first, then click here and press Ctrl+V. Or enter the details below.';return;}
  event.preventDefault();if(images.length!==1){$('ocr-status').textContent='Paste one patient screenshot at a time.';return;}
  if(ocrBusy)return;
  const blob=images[0].getAsFile();if(!blob)return;
  clearScreenshot();const run=ocrRun;ocrAbort=new AbortController();
  $('other-form').elements.name.value='';$('other-form').elements.phn.value='';
  imageURL=URL.createObjectURL(blob);$('patient-preview').src=imageURL;$('patient-preview').hidden=false;setPatientBusy(true);
  try{
    const {readScreenshot}=await import('./ocr.mjs?v=20261006-modes1');
    const text=await readScreenshot(blob,msg=>{if(run===ocrRun)$('ocr-status').textContent=msg;},ocrAbort.signal);
    if(run!==ocrRun)return;
    const result=extractDemographics(text);$('other-form').elements.name.value=result.name;$('other-form').elements.phn.value=result.phn;
    $('ocr-status').textContent='Review the name and every PHN digit against the screenshot. '+result.warnings.join(' ');
  }catch(e){if(run===ocrRun)$('ocr-status').textContent='Could not read the screenshot reliably. Enter the details manually. '+(e.message.includes('smaller')||e.message.includes('too large')?e.message:'');}
  finally{if(run===ocrRun)setPatientBusy(false);}
});

// The laptop launcher and local bookmark open the existing workspace directly.
// Explicit lock, file errors and another editing tab remain visible boundaries.
async function openLaptopWorkspace(){
  const card=$('gate').querySelector('.gate-card'),heading=card.querySelector('h1');
  let message=$('local-startup-status');
  if(!message){message=document.createElement('p');message.id='local-startup-status';message.setAttribute('role','status');card.append(message);}
  const button=$('connect');
  button.onclick=()=>{sessionStorage.removeItem(laptopLockKey);void openLaptopWorkspace();};
  button.textContent='Open local workspace';
  if(sessionStorage.getItem(laptopLockKey)==='yes'){
    heading.textContent='TRIM locked';message.textContent='Your work is retained on this laptop.';button.hidden=false;button.disabled=false;return;
  }
  heading.textContent='Opening TRIM…';message.textContent='Connecting to your laptop’s Drive folder…';button.hidden=true;
  try{
    const response=await fetch('/health',{cache:'no-store'});
    if(!response.ok||(await response.json()).app!=='trim-app')throw new Error('The local app is not responding. Start TRIM, then retry.');
    if(!await connect('local'))throw new Error($('connection-error').textContent||'Could not open the local workspace. Retry when the file is available.');
  }catch(e){
    heading.textContent='Could not open TRIM';message.textContent=e.message;
    button.textContent='Retry local connection';button.hidden=false;button.disabled=false;
  }
}


  async function recordRoutine(serviceDate,keys){
    guardWrite();if(serviceDate!==date())throw new Error('Return to the visit date before recording billing.');
    const candidates=routineCandidates(ledger,people(),serviceDate).filter(c=>keys.includes(c.patient.key));
    const eligible=candidates.filter(c=>c.status==='due').map(c=>c.patient.key);
    if(eligible.length)commit(addRoutineBatch(ledger,people(),serviceDate,eligible).ledger);
    const already=candidates.filter(c=>c.status==='billed').length;
    return eligible.length+' routine billings added; '+already+' already recorded; '+(keys.length-eligible.length-already)+' require billing review.';
  }
  return {
    start:()=>{if(laptopStartup)void openLaptopWorkspace();},
    render:renderAll,
    state:()=>({adapter,ledger,roster,date:date(),people:ledger?people():[]}),
    save:async()=>{await syncSession(true);if(dirty||blocked)throw new Error('Resolve the TRIM Billing conflict before finishing this save.');},
    status:()=>({dirty,busy:saving||checking||loadingLatest||recoveryPending>0,error:localRecoveryFailed||mergeConflicts.length>0,ready:!!ledger,mode:adapter?.mode}),
    switchTab,recordRoutine,notify:notice,chooseConnection:openConnectionDialog,loadLatest,
    setRoster:raw=>{roster=normalizeRoster(raw);if(ledger){renderAll();notes.render();applyNewPatientPlans();}},
    localChanges,
  };

}
