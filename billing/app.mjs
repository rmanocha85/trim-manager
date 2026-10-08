import {formatDate,formatTimestamp,enhanceDateInputs} from './dates.mjs?v=20261007-dates1';
import {CODES,COMMON_CODES,CONFERENCE_CODES,REASON_PRESETS,timeDefaults,roundedPacificTime,tenMinutesLater,editBillingTime,calendarDays,codeInfo,clone,sameBillingContent,today,validDate,patientKey,rosterView,dueState,lastBilling,upsertInteractiveEntry,removeEntry,batchEntries,entryIssues,finalizeBatch,escapeHTML as esc,validateLedger,parseImport,mergeImport,importSummary,heldImports,blankLedger} from './core.mjs?v=20261007-cancel1';
import {cancelBillingCodes,undoBillingCancellation,inheritConferenceDiagnoses} from './core.mjs?v=20261007-cancel1';
import {timeField,bindTimeFields} from './time-entry.mjs?v=20261007-cancel1';
import {LocalAdapter,DriveAdapter} from './adapters.mjs?v=20261006-modes1';
import {saveRecovery,loadRecovery} from './recovery.mjs';
import {renderReport} from './reports.mjs?v=20261007-dates1';
import {sessionChanges,coveragePatient,extractDemographics,matchesPatientSearch} from './workspace.mjs?v=20261007-cancel1';
const $=id=>document.getElementById(id);
let savedBase=null,billingMode='concern',lastChecked=null,driveReachable=false,localRecoveryFailed=false,ocrBusy=false,ocrRun=0,ocrAbort=null,imageURL=null;
const localChanges=()=>dirty&&ledger&&savedBase?sessionChanges(savedBase,ledger):[];
function checkedDrive(){driveReachable=true;lastChecked=new Date();}
function connectionError(e){driveReachable=e?.status===409;if(driveReachable)lastChecked=new Date();}
let adapter,ledger,roster,etag,selected=null,editingId=null,tab='billing',dirty=false,blocked=false,seq=0,saving=false,timer,releaseLock,printedSignature=null,recoveryQueue=Promise.resolve(),recoveryPending=0;
let setupCandidate,connecting=false;
let stagedImport=null,importing=false,importRead=0;
let connectionVerified=false,syncFailed=false,checking=false,calendarMonth=today().slice(0,7),saveFocus=null;
const date=()=>$('service-date').value||today();
const people=()=>rosterView(roster,ledger);
const person=k=>people().find(p=>p.key===k);
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function status(text,warn=false){$('save-status').textContent=text;$('save-status').classList.toggle('dirty',warn);updateWriteLock();}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){notice(e.message);}};}
const writeUnavailable=()=>!connectionVerified||syncFailed||blocked||checking||!navigator.onLine;
function guardWrite(){if(writeUnavailable())throw new Error('Billing is locked until the Google Drive connection and saved revision are verified. Use Save to Drive / retry.');if(saving)throw new Error('Wait for the current save to finish.');}
function updateWriteLock(){
  renderSaveControls();
  if(!ledger)return;const unavailable=writeUnavailable(),busy=saving||checking;
  const e=selected?currentEntry():null,historical=selected&&(ledger.historicalBillings||[]).some(h=>h.patientKey===selected&&h.date===date());
  $('editor').querySelectorAll('input,textarea,select,[data-code],#add-code,#remove-entry,[data-remove-code],[data-reason-preset],[data-time-open]').forEach(el=>{el.disabled=unavailable||saving||Boolean(e?.batchId)||historical||(busy&&el.tagName==='BUTTON');});
  $('roster').querySelectorAll('[data-patient]').forEach(el=>el.disabled=busy);
  $('calendar').querySelectorAll('button').forEach(el=>el.disabled=busy||el.dataset.future==='true');
  const identityReady=$('other-form').elements.name.value.trim()&&/^\d{10}$/.test($('other-form').elements.phn.value);
  for(const id of ['confirm-patient','baseline-save','portal-confirm','parallel','finalize','generate'])$(id).disabled=unavailable||busy||(id==='confirm-patient'&&(ocrBusy||!identityReady))||(id==='finalize'&&ledger.settings.parallel);
  $('billing-lock').hidden=!unavailable;$('billing-lock').textContent=blocked?'Billing locked — resolve the saved-data conflict in Settings. Your draft is retained.':!navigator.onLine?'Offline — billing is locked. Existing work is retained; reconnect to continue.':'Billing locked — use Save to Drive / retry to verify Google Drive before making changes.';
}
function renderCalendar(){
  $('calendar-month').textContent=new Intl.DateTimeFormat('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(calendarMonth+'-01T12:00:00Z'));
  const billedDays=new Set(ledger?.entries.map(e=>e.date)||[]);
  $('calendar-days').innerHTML=calendarDays(calendarMonth).map(d=>d?`<button data-day="${d}" data-future="${d>today()}" ${d>today()?'disabled':''} aria-label="${esc(new Intl.DateTimeFormat('en-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')))}${billedDays.has(d)?', billing recorded':''}" aria-pressed="${d===date()}" ${d===today()?'aria-current="date"':''} class="${billedDays.has(d)?'has-billing':''}">${Number(d.slice(-2))}</button>`:'<span></span>').join('');
  $('selected-date-label').textContent=formatDate(date());
  $('calendar-days').querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>selectDate(b.dataset.day));updateWriteLock();
}
function selectDate(value){if(saving||checking)return notice('Wait for this save before changing the billing date.');if(!validDate(value)||value>today())return notice('Choose today or an earlier service date.');$('service-date').value=value;calendarMonth=value.slice(0,7);editingId=null;renderCalendar();renderStats();renderRoster();renderEditor();}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function takeTabLock(id){if(!navigator.locks)throw new Error('This browser cannot protect against competing tabs. Use an up-to-date Chrome browser.');return new Promise((resolve,reject)=>navigator.locks.request(`trim-billing:${id}`,{ifAvailable:true},async lock=>{if(!lock)return reject(new Error('This billing file is already open for editing in another tab. Close or lock that tab first.'));resolve();await new Promise(r=>releaseLock=r);}));}
async function recover(){
  const saved=await loadRecovery(ledger.datasetId);
  if(saved?.dirty){
    validateLedger(saved.ledger);
    if(sameBillingContent(saved.ledger,ledger)){dirty=false;blocked=false;await persistRecovery();notice('Your previous changes are already saved to Google Drive. Recovery status repaired.');return;}
    ledger=saved.ledger;dirty=true;
    if(saved.baseLedger?.datasetId===ledger.datasetId){validateLedger(saved.baseLedger);savedBase=saved.baseLedger;}
    if(saved.etag!==etag){blocked=true;notice('Recovered an unsynced draft, but saved billing has changed. Your draft is retained. Download it in Settings, then reload saved data and reconcile before saving.');}
    else notice('Recovered your unfinished session on this device. Choose Save to Drive when ready.');
  }
}
function persistRecovery(){const snapshot={ledger:clone(ledger),baseLedger:clone(savedBase),etag,dirty,savedAt:new Date().toISOString()};recoveryPending++;
  recoveryQueue=recoveryQueue.catch(()=>{}).then(()=>saveRecovery(snapshot.ledger.datasetId,snapshot)).then(()=>{recoveryPending--;localRecoveryFailed=false;}).catch(e=>{recoveryPending--;localRecoveryFailed=true;blocked=true;status('Recovery save failed — keep this tab open',true);notice(`Device recovery failed: ${e.message}. Download a private backup before closing.`);throw e;});return recoveryQueue;
}
async function connect(mode,create=false){
  if(connecting)return;connecting=true;
  $('create-cloud').hidden=true;
  $('setup-import').hidden=true;setupCandidate=create?setupCandidate:null;
  $('connection-error').textContent='Connecting…';
  try{
    const candidate=create?setupCandidate:mode==='local'?new LocalAdapter():new DriveAdapter($('cloud-file-id').value);
    if(!candidate)throw new Error('Connect through Google first.');
    if(!create)await candidate.connect();
    const r=await candidate.roster();let s;
    try{s=create?await candidate.createEmpty():await candidate.load();}
    catch(e){if(e.code==='MISSING_BILLING'){setupCandidate=candidate;$('create-cloud').hidden=false;$('setup-import').hidden=false;}throw e;}
    if(releaseLock){releaseLock();releaseLock=null;}
    await takeTabLock(s.ledger.datasetId);
    adapter=candidate;roster=r;ledger=s.ledger;savedBase=clone(s.ledger);checkedDrive();etag=s.etag;dirty=false;blocked=false;syncFailed=false;connectionVerified=true;selected=null;editingId=null;
    await recover();
    $('gate').hidden=true;$('workspace').hidden=false;$('connection-dialog').close();document.title='TRIM Billing · Parallel review';
    $('storage-note').textContent=mode==='local'?'Local preview · saves to this laptop’s Drive folder. Cloud sync is not verified. Original roster: read-only.':'Google Drive connected · original roster: read-only.';
    renderAll();setBillingMode(billingMode);document.querySelector('.version').textContent=ledger.settings.parallel?'PAPER COMPARISON':'BILLING';status(blocked?'Draft conflict — action needed':dirty?'Saved on this device — not yet in Drive':mode==='local'?'Local Drive folder connected':'Saved to Google Drive',blocked||dirty);
    return true;
  }catch(e){if(releaseLock){releaseLock();releaseLock=null;}$('connection-error').textContent=e.message;}
  finally{connecting=false;}
}
function commit(next){guardWrite();ledger=next;ledger.units=clone(roster.units);seq++;dirty=true;printedSignature=null;status('Saving on this device…',true);persistRecovery().then(()=>{if(!blocked&&!saving&&!writeUnavailable())status('Saved on this device — not yet in Drive',true);}).catch(()=>{});renderStats();renderRoster();updateWriteLock();}
async function flush(){
  clearTimeout(timer);if(!dirty||saving||blocked||!adapter)return;
  if(!navigator.onLine){syncFailed=true;connectionVerified=false;status('Offline — changes retained on device',true);return;}
  saveFocus=document.activeElement?.matches('#editor input,#editor textarea')?{el:document.activeElement,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
  saving=true;updateWriteLock();const currentSeq=seq;const snapshot=clone(ledger);
  try{
    await recoveryQueue;status('Saving…',true);const saved=await adapter.save(snapshot,etag);etag=saved.etag;savedBase=clone(saved.ledger);checkedDrive();
    if(seq===currentSeq){ledger=saved.ledger;dirty=false;}else{ledger.revision=saved.ledger.revision;ledger.updatedAt=saved.ledger.updatedAt;ledger.localWriter=saved.ledger.localWriter;}
    syncFailed=false;connectionVerified=true;await persistRecovery();status(dirty?'More changes waiting to save':adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive',dirty);
  }catch(e){connectionError(e);syncFailed=true;connectionVerified=false;if(e.status===409){blocked=true;notice(e.message+' Your encrypted draft is retained. Use Settings to download it before reloading.');}else{notice(e.message+' Your draft remains on this device. Use Save to Drive / retry after reconnecting.');}status(e.status===409?'Conflict — save stopped':'Saved on device · not synced',true);}
  finally{saving=false;updateWriteLock();if(!dirty&&!writeUnavailable()){renderCalendar();if(saveFocus?.el.isConnected&&!saveFocus.el.disabled&&document.activeElement===document.body){saveFocus.el.focus();if(saveFocus.start!==null)saveFocus.el.setSelectionRange(saveFocus.start,saveFocus.end);}}saveFocus=null;}
}
function renderAll(){
  $('unit-filter').innerHTML='<option value="">All units</option>'+roster.units.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  renderStats();renderRoster();renderEditor();renderReports();renderHistory();renderSettings();renderCalendar();updateWriteLock();
}
function renderStats(){const pts=people(),own=pts.filter(p=>p.panel),day=ledger.entries.filter(e=>e.date===date());const missing=day.filter(e=>entryIssues(e,ledger,person(e.patientKey)).length);$('stats').innerHTML=[['My panel',own.length,'No patient limit'],['Selected this date',day.length,'Patients with billing'],['Needs information',missing.length,'Saved, incomplete'],['Due for review',own.filter(p=>dueState(ledger,p,date()).kind==='due').length,`${own.filter(p=>dueState(ledger,p,date()).kind==='unknown').length} with unknown history`]].map(([label,n,sub])=>`<div class="stat"><span>${label}</span><b>${n}</b><small>${sub}</small></div>`).join('');$('day-summary').textContent=`${formatDate(date())} · ${day.length} patients billed${missing.length?` · ${missing.length} need information`:''}`;}
function renderRoster(){
  const q=$('search').value.trim(),unit=$('unit-filter').value,dueOnly=$('due-filter').checked;
  // Concern search always spans the full roster, regardless of stale routine filters.
  const pts=people().filter(p=>matchesPatientSearch(p,q)&&(billingMode==='concern'||(p.panel&&(!unit||p.unit===unit)&&(!dueOnly||dueState(ledger,p,date()).kind==='due'||ledger.entries.some(e=>e.patientKey===p.key&&e.date===date())))));
  const units=[...roster.units];for(const p of pts)if(!units.some(u=>u.id===p.unit))units.push({id:p.unit,name:p.unit||'OTHER',floor:''});
  $('roster').innerHTML=units.map(u=>{const group=pts.filter(p=>p.unit===u.id).sort((a,b)=>a.room.localeCompare(b.room,undefined,{numeric:true})||a.name.localeCompare(b.name));if(!group.length)return '';return `<section class="unit"><div class="unit-heading"><span>${esc(u.name)}${u.floor?` · FLOOR ${esc(u.floor)}`:''}</span><span>${group.length}</span></div>${group.map(p=>{const e=ledger.entries.find(e=>e.patientKey===p.key&&e.date===date());const d=dueState(ledger,p,date());return `<button class="patient ${selected===p.key?'selected':''}" data-patient="${esc(p.key)}"><span class="room">${esc(p.room||'—')}</span><span><span class="patient-name">${esc(p.name)}${p.pFlag?'<span class="pflag">P</span>':''}</span><span class="patient-detail">${d.last?`Last billing ${formatDate(d.last)}${billingMode==='routine'?` · ${Math.round((Date.parse(date())-Date.parse(d.last))/86400000)} days ago`:''}`:p.panel?'Starting history not supplied':'Reason required for coverage billing'}</span></span><span class="patient-right">${e?`<span class="pill">${e.items.map(i=>esc(i.code.replace(/^0+/,''))).join(' · ')}</span><span class="patient-detail">${e.batchId?'Handed over':entryIssues(e,ledger,p).length?'Needs information':'Selected'}</span>`:`<span class="pill ${d.kind==='unknown'?'warn':''}">${esc(d.kind==='later'?`Next ${formatDate(d.due)}`:d.label)}</span>`}</span></button>`;}).join('')}</section>`;}).join('')||'<div class="empty">No patients match these filters.</div>';
  $('roster').querySelectorAll('[data-patient]').forEach(b=>b.onclick=()=>{if(saving||checking)return;selected=b.dataset.patient;editingId=null;renderRoster();renderEditor();});updateWriteLock();
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
  $('editor').innerHTML=`<div class="editor-head"><div><h2>${esc(p.name)}</h2><p>${esc(roster.units.find(u=>u.id===p.unit)?.name||p.unit||'Location not recorded')} · Room ${esc(p.room||'—')} · ${p.panel?'My patient':'Coverage / former patient'}</p></div><span class="editor-date">${esc(formatDate(date()))}</span></div>${locked?'<div class="issue-box">Given to Suzy. This entry is read-only.</div>':''}<div class="codes-grid" aria-label="Common billing codes">${(billingMode==='routine'?['00114',...COMMON_CODES.filter(c=>c!=='00114')]:COMMON_CODES).map(code=>{const c=codeInfo(code);return `<button class="code-chip ${billingMode==='routine'&&code==='00114'?'routine-primary ':''}${items.some(i=>i.code===code)?'on':''}" data-code="${code}" aria-pressed="${items.some(i=>i.code===code)}" ${locked?'disabled':''}>${code.replace(/^0+/,'')}<small>${esc({'00114':billingMode==='routine'?'Routine':'Visit','00127':'Palliative','14077':'Provider','13121':'Family'}[code]||c.label)}</small></button>`;}).join('')}</div><details class="other-codes"><summary>Other billing codes</summary><label>Additional code<select id="other-code" ${locked?'disabled':''}><option value="">Choose a code…</option>${CODES.filter(c=>!COMMON_CODES.includes(c.code)).map(c=>`<option value="${c.code}">${c.code} · ${esc(c.label)}</option>`).join('')}</select></label><div class="fields"><label>Custom five-digit code<input id="custom-code" maxlength="5" inputmode="numeric"></label><button id="add-code" ${locked?'disabled':''}>Add</button></div></details>${items.some(i=>i.code==='13334')?`<div class="bonus-banner">✓ 13334 · First-visit bonus${items.find(i=>i.code==='13334').autoAdded?' · Auto':''}</div>`:''}<div id="item-details">${items.map((i,index)=>itemHTML(i,index,locked)).join('')}</div><div id="editor-issues"></div>${e?.comment||items.some(i=>i.code!=='00114'&&i.code!=='13334'&&!CONFERENCE_CODES.includes(i.code))?`<section class="comment-details"><label>Additional billing comment<textarea id="entry-comment" maxlength="3000" ${locked?'disabled':''} placeholder="Only information needed for billing">${esc(e?.comment||'')}</textarea></label></section>`:''}${e&&!locked?'<button id="remove-entry" class="text-button danger">Remove this billing date</button>':''}<details class="billing-history"><summary>Previous billing dates & patient details</summary><p class="hint">PHN ${esc(p.phn||'—')} · Usual ICD ${esc(p.codes||'—')}</p>${ledger.entries.filter(x=>x.patientKey===p.key).sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<div class="history-row"><span>${esc(formatDate(x.date))}<small> · ${x.items.map(i=>i.code).join(', ')}${x.batchId?' · Given to Suzy':''}</small></span><button data-edit="${x.id}">View</button></div>`).join('')||'<p class="hint">No billing recorded yet.</p>'}${ledger.baselines[p.key]?`<p class="hint">Starting qualifying billing: ${esc(formatDate(ledger.baselines[p.key].date))}</p>`:''}${historical.length?`<h3>Already billed · imported</h3>${historical.map(h=>`<div class="history-row"><span>${esc(formatDate(h.date))} · ${h.codes.map(esc).join(', ')}<small>${esc(h.reason||'')} · ${sourceLabel(h.sources)}</small></span></div>`).join('')}`:''}</details>`;
  if(historical.some(h=>h.date===date())){$('editor').insertAdjacentHTML('afterbegin','<div class="issue-box">Already billed on this date. No new charge can be added.</div>');$('editor').querySelectorAll('button,input,textarea').forEach(x=>x.disabled=true);}
  const latestRemoval=(ledger.cancellations||[]).filter(c=>c.before.patientKey===p.key&&c.before.date===date()&&!c.undoneAt&&!savedBase?.cancellations?.some(b=>b.id===c.id)).at(-1);
  if(latestRemoval){const undo=document.createElement('button');undo.className='undo-removal';undo.textContent='Undo last code removal';undo.disabled=locked||writeUnavailable()||saving;undo.onclick=safe(()=>undoCancellation(latestRemoval.id));$('editor').append(undo);}
  const newItem=code=>({code,units:1,...timeDefaults(code),...(CONFERENCE_CODES.includes(code)?{diagnosisSource:'primary114'}:{}),...(code==='00114'?{diagnosisMode:'per-charge',...(billingMode==='concern'?{concernBilling:true}:{})}:{})});
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
  return `<div class="code-details"><h3>${esc(i.code.replace(/^0+/,''))} · ${esc(c?.label||'Other code')}<button class="text-button danger" data-remove-code="${i.code}" ${locked?'disabled':''}>Remove ×</button></h3>${!c?field('customLabel','Description')+field('customVerified','I checked this code’s service-date rules','checkbox')+field('customTimed','This code requires start/end times','checkbox'):''}${c?.timed||!c?`<div class="fields">${field('start','Start','time')}${field('end','End','time')}${field('units','Units','number',`min="1" max="${c?2:99}"`)}</div>`:c?.attendance?field('start','Attendance time','time'):''}${c?.request?field('requestAt','Request date and time','datetime-local')+field('requester','Requesting person / role'):''}${c?.participants?field('participants','Participants / roles'):''}${i.code==='00114'?reasonPresetHTML(i,index,locked,field):`<div class="reason-diagnosis">${CONFERENCE_CODES.includes(i.code)?'':field('reason',c?.reason||!person(selected)?.panel?'Reason / claim note (required)':'Reason / claim note','text','maxlength="2000"')}${field('diagnosis','ICD-9 for this billing','text','maxlength="8" placeholder="Usual if blank"')}</div>`}${c?.admission||c?.callout?field('attested',c.admission?'I confirm admission criteria and required documentation':'I confirm special call, travel and first patient on this call','checkbox'):''}<details class="code-guidance"><summary>Code guidance</summary><p>${esc(c?.note||'Rules for this code must be verified before finalizing.')}</p></details></div>`;
}

function reasonPresetHTML(item,index,locked,field){
  return `<div class="reason-workspace"><div class="reason-presets" aria-label="Common billing reasons">${REASON_PRESETS.map((p,n)=>`<button type="button" data-reason-preset="${n}" data-index="${index}" aria-pressed="${item.reason===p.reason&&item.diagnosis===p.diagnosis}" ${locked?'disabled':''}><span>${esc(p.reason)}</span><small>${esc(p.diagnosis)}</small></button>`).join('')}</div><div class="reason-diagnosis"><label>Billing reason / comment<textarea data-index="${index}" data-field="reason" maxlength="2000" ${locked?'disabled':''} placeholder="Type a reason, or choose one above…">${esc(item.reason||'')}</textarea></label>${field('diagnosis','ICD-9 for this billing','text','maxlength="8" placeholder="Usual if blank"')}</div></div>`;
}
function renderEditorIssues(){const e=currentEntry();$('editor').querySelectorAll('[data-reason-preset]').forEach(b=>{const i=e?.items[Number(b.dataset.index)],p=REASON_PRESETS[Number(b.dataset.reasonPreset)];b.setAttribute('aria-pressed',String(i?.reason===p.reason&&i?.diagnosis===p.diagnosis));});if(!$('editor-issues'))return;const issues=e?entryIssues(e,ledger,person(selected)):[];$('editor-issues').innerHTML=issues.length?`<div class="issue-box"><strong>Saved as a draft · needs information</strong><ul>${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:e?'<p class="hint">Required fields complete. Physician eligibility review still required.</p>':'';}
function openEntry(id){if(saving||checking)return notice('Wait for the current save before opening another entry.');const e=ledger.entries.find(e=>e.id===id);if(!e)return;selected=e.patientKey;editingId=e.id;$('service-date').value=e.date;calendarMonth=e.date.slice(0,7);switchTab('billing');renderCalendar();renderStats();renderRoster();renderEditor();}
function chosen(){return batchEntries(ledger,$('batch-from').value,$('batch-to').value);}
function issuesFor(entries){return entries.flatMap(e=>entryIssues(e,ledger,person(e.patientKey)).map(issue=>({id:e.id,text:`${person(e.patientKey)?.name||'Patient'} · ${formatDate(e.date)} · ${issue}`})));}
function signature(){return JSON.stringify({entries:chosen(),layout:$('report-layout').value,revision:ledger.revision,parallel:ledger.settings.parallel});}
function renderReports(){const entries=chosen(),issues=issuesFor(entries);$('batch-summary').innerHTML=`<p><strong>${entries.length}</strong> patient-date entries · <strong>${new Set(entries.map(e=>e.date)).size}</strong> dates · <strong>${new Set(entries.map(e=>e.patientKey)).size}</strong> patients</p>`;$('batch-issues').innerHTML=issues.length?`<div class="card"><h2>${issues.length} items need attention</h2>${issues.map(x=>`<div class="history-row"><span>${esc(x.text)}</span><button data-fix="${x.id}">Review</button></div>`).join('')}</div>`:'';$('batch-issues').querySelectorAll('[data-fix]').forEach(b=>b.onclick=()=>openEntry(b.dataset.fix));$('finalize').disabled=ledger.settings.parallel;}
function sourceLabel(sources){return (sources||[]).map(s=>`${esc(s.file||'Source scan')} · page ${esc(s.page)}`).join('; ');}
function renderHistory(){
  const entries=[...ledger.entries].sort((a,b)=>b.date.localeCompare(a.date)),historical=[...(ledger.historicalBillings||[])].sort((a,b)=>b.date.localeCompare(a.date)),held=heldImports(ledger);
  $('history-content').innerHTML=`<div class="card"><h2>Billing records</h2><table class="history-table"><thead><tr><th>Date</th><th>Patient</th><th>Codes</th><th>Status</th><th></th></tr></thead><tbody>${entries.map(e=>`<tr><td>${esc(formatDate(e.date))}</td><td>${esc(person(e.patientKey)?.name)}</td><td>${e.items.map(i=>esc(i.code)).join(' · ')}</td><td>${e.batchId?'Given to Suzy':'Current batch'}</td><td><button data-history="${esc(e.id)}">View</button></td></tr>`).join('')}</tbody></table>${entries.length?'':'<div class="empty">No billing entries.</div>'}</div><div class="card"><h2>Already billed · ${historical.length} imported records</h2><p>Read-only. These records are never included in a new billing batch. Historical timed-code units were not inferred.</p><table class="history-table"><thead><tr><th>Date</th><th>Patient</th><th>Codes / reason</th><th>Source</th></tr></thead><tbody>${historical.map(h=>`<tr><td>${esc(formatDate(h.date))}</td><td>${esc(person(h.patientKey)?.name||h.name)}</td><td>${h.codes.map(esc).join(' · ')}<br>${esc(h.reason||'')}</td><td>${sourceLabel(h.sources)}</td></tr>`).join('')}</tbody></table></div><div class="card"><h2>Held for clarification · ${held.length}</h2><p>Not charges. Not included in reports or next-billing calculations.</p>${held.map(h=>`<div class="history-row"><span>${esc(formatDate(h.date))} · ${esc(h.name)}<br>${esc(h.reason)}<br><small>${sourceLabel([h.source])}</small></span></div>`).join('')}</div>${ledger.batches.map(b=>`<div class="card"><h3>${esc(formatDate(b.from))} → ${esc(formatDate(b.to))}</h3><p>${b.entryIds.length} entries · handed over ${esc(formatTimestamp(b.handedOverAt))}</p></div>`).join('')}`;
  $('history-content').querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>openEntry(b.dataset.history));
}
function renderSettings(){
  const previousPatient=$('baseline-patient').value;
  $('parallel').checked=ledger.settings.parallel;$('baseline-patient').innerHTML=people().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('');
  if(previousPatient&&person(previousPatient))$('baseline-patient').value=previousPatient;
  $('baseline-date').value=ledger.baselines[$('baseline-patient').value]?.date||'';enhanceDateInputs(document);
  $('portal-years').innerHTML=(ledger.settings.portalYears||[]).map(y=>`<span class="pill">${esc(y)} confirmed</span>`).join(' ');
  $('baseline-list').innerHTML=Object.entries(ledger.baselines).map(([k,b])=>`<div class="history-row">${esc(person(k)?.name||'Retained patient')} <span>${esc(formatDate(b.date))}</span></div>`).join('');
  const year=$('portal-year').value;const counts={};for(const e of ledger.entries.filter(e=>e.date.startsWith(year)))for(const i of e.items)counts[i.code]=(counts[i.code]||0)+Number(i.units);
  $('annual-counts').innerHTML=Object.entries(counts).map(([c,n])=>`<div class="history-row"><span>${c}</span><span>${n} units · ${year}</span></div>`).join('')||'<p class="hint">No recorded usage this year.</p>';
  if(ledger.historicalBillings?.length)$('annual-counts').insertAdjacentHTML('beforeend','<p class="issue-box">Imported billed records also exist. Their units are unverified and are not included in these totals. Relevant annual-limit codes are flagged for reconciliation before handoff.</p>');
  $('import-receipts').textContent=(ledger.imports||[]).map(i=>`Imported ${formatTimestamp(i.importedAt)}: ${i.summary.billed} already billed, ${i.summary.pending} in the current batch, ${i.summary.held} held.${i.summary.resolved?` ${i.summary.resolved} prior held items resolved.`:''}`).join(' ');
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
    await flush();if(dirty||saving||blocked)throw new Error('Resolve the save or recovery issue before importing.');
    const fresh=await adapter.load();if(fresh.etag!==etag)throw new Error('Billing changed elsewhere. Reload saved data, then choose the import again. Nothing was imported.');
    const result=mergeImport(ledger,stagedImport.p,stagedImport.sha256);
    if(!result.duplicate){if(ledger.entries.length||ledger.historicalBillings?.length||Object.keys(ledger.baselines).length)download(`PRIVATE_TRIM_Before_Import_${today()}.json`,ledger);commit(result.ledger);await flush();if(dirty||blocked)throw new Error('Import is retained on this device but not verified in Drive. Use Save to Drive / retry; do not re-import.');}
    stagedImport=null;$('import-file').value='';$('import-dialog').close();renderAll();switchTab('history');notice(`Import saved and verified: ${result.summary.billed} already billed, ${result.summary.pending} in the current batch, ${result.summary.held} held for clarification.${result.summary.resolved?` ${result.summary.resolved} prior held items resolved.`:''} No billing was submitted.`);
  }catch(e){$('import-error').textContent=e.message;}
  finally{importing=false;$('workspace').inert=false;$('import-file').disabled=false;$('import-close').disabled=false;$('import-apply').disabled=!stagedImport;}
};
function switchTab(name){if(name==='routine'){setBillingMode('routine');name='billing';}else if(name==='billing'){setBillingMode('concern');}tab=name;document.querySelectorAll('.tab').forEach(s=>s.hidden=s.id!==name);document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',name==='billing'?b.dataset.tab===(billingMode==='routine'?'routine':'billing'):b.dataset.tab===name));if(name==='reports')renderReports();if(name==='history')renderHistory();if(name==='settings')renderSettings();}
function setBillingMode(mode){billingMode=mode;$('billing').dataset.mode=mode;$('panel-filter').value=mode==='routine'?'mine':'all';$('panel-filter').hidden=true;$('unit-filter').hidden=mode==='concern';$('routine-filters').hidden=mode==='concern';$('search-scope').hidden=mode==='routine';$('due-filter').checked=mode==='routine';$('add-patient-section').hidden=mode==='routine';$('mode-title').textContent=mode==='routine'?'Routine Billing':'Concern Billing';$('mode-help').textContent=mode==='routine'?'Your panel · due for 14-day billing review. Select each patient and code; nothing is added automatically. Uncheck Due for review to include patients with unknown history.':'Search any patient · record the concern, billing code and relevant details.';if(mode==='routine'&&selected&&!person(selected)?.panel){selected=null;editingId=null;}renderRoster();renderEditor();}
$('connect').onclick=()=>{$('connection-error').textContent='';$('connection-dialog').showModal();};
$('local-option').hidden=!['127.0.0.1','localhost'].includes(location.hostname);
$('local-connect').onclick=()=>connect('local');$('cloud-connect').onclick=()=>connect('cloud');
$('create-cloud').onclick=()=>{if(confirm('Create a new empty private billing file in My Drive? Only continue if you have no existing billing data to import. The original roster will not change.'))connect('cloud',true);};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('service-date').value=today();$('service-date').max=today();$('batch-from').value=today().slice(0,7)+'-01';$('batch-to').value=today();$('portal-year').value=today().slice(0,4);$('baseline-date').max=today();enhanceDateInputs(document);
$('service-date').onchange=()=>selectDate($('service-date').value);
$('month-prev').onclick=()=>{const d=new Date(calendarMonth+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);calendarMonth=d.toISOString().slice(0,7);renderCalendar();};
$('month-next').onclick=()=>{const d=new Date(calendarMonth+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);calendarMonth=d.toISOString().slice(0,7);renderCalendar();};
$('calendar-today').onclick=()=>selectDate(today());
for(const id of ['search','unit-filter','panel-filter','due-filter'])$(id).addEventListener('input',()=>renderRoster());
for(const id of ['batch-from','batch-to','report-layout'])$(id).onchange=()=>{printedSignature=null;renderReports();};
async function verifyConnection(){
  if(!adapter||!ledger||checking||saving||blocked||document.hidden)return;
  checking=true;updateWriteLock();
  try{if(!navigator.onLine)throw new Error('No internet connection.');await adapter.verify(etag);checkedDrive();connectionVerified=true;syncFailed=false;status(dirty?'Saved on this device — not yet in Drive':adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive',dirty);}
  catch(e){connectionError(e);connectionVerified=false;syncFailed=true;if(e.status===409)blocked=true;status(e.status===409?'Conflict — save stopped':'Connection needs attention',true);notice(e.message);}
  finally{checking=false;updateWriteLock();}
}
async function syncSession(save=true){
  if(saving||checking)return;checking=true;updateWriteLock();
  try{
    if(!connectionVerified||syncFailed||blocked)await adapter.connect();
    if(blocked||syncFailed){
      const current=await adapter.load();
      if(!sameBillingContent(ledger,current.ledger)&&(blocked||current.etag!==etag))throw Object.assign(new Error('The browser draft and Google Drive contain different billing information. Both versions are retained; download your draft in Settings for review before reloading.'),{status:409});
      if(sameBillingContent(ledger,current.ledger)){ledger=current.ledger;savedBase=clone(current.ledger);checkedDrive();etag=current.etag;dirty=false;blocked=false;connectionVerified=true;syncFailed=false;printedSignature=null;await persistRecovery();notice('Your billing already matches Google Drive. The stale conflict has been cleared.');renderAll();status(adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive');return;}
      blocked=false;syncFailed=false;connectionVerified=true;
    }
    await adapter.verify(etag);checkedDrive();connectionVerified=true;syncFailed=false;checking=false;
    if(dirty){if(save)await flush();else status('Saved on this device — not yet in Drive',true);if(!dirty)notice('');return;}
    const [r,s]=await Promise.all([adapter.roster(),adapter.load()]);roster=r;ledger=s.ledger;savedBase=clone(s.ledger);checkedDrive();etag=s.etag;printedSignature=null;await persistRecovery();notice('');renderAll();status(adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive');
  }catch(e){connectionError(e);connectionVerified=false;syncFailed=true;if(e.status===409)blocked=true;status(e.status===409?'Conflict — save stopped':'Connection needs attention',true);throw e;}
  finally{checking=false;updateWriteLock();}
}
$('sync').onclick=safe(()=>syncSession(true));
$('drive-connection').onclick=safe(()=>syncSession(false));
$('lock').onclick=safe(async()=>{await persistRecovery();if(dirty&&!confirm('Changes remain on this device. Lock anyway? Reconnect on this browser to recover them.'))return;releaseLock?.();releaseLock=null;location.reload();});
$('other-form').onsubmit=async ev=>{ev.preventDefault();try{guardWrite();if(ocrBusy)throw new Error('Wait for screenshot reading to finish.');const p=coveragePatient(Object.fromEntries(new FormData(ev.target)),people(),crypto.randomUUID());const next=clone(ledger);next.nonPanel.push(p);next.patients[p.key]=p;commit(next);resetPatientForm();$('search').value='';$('unit-filter').value='';$('panel-filter').value='all';$('due-filter').checked=false;selected=p.key;editingId=null;renderRoster();renderEditor();}catch(e){$('other-error').textContent=e.message;}};
$('parallel').onchange=safe(()=>{const off=!$('parallel').checked;if(off&&!confirm('End paper-comparison mode? Only do this when you are ready to use digital reports as the single MOA billing source.')){$('parallel').checked=true;return;}const n=clone(ledger);n.settings.parallel=!off;commit(n);document.querySelector('.version').textContent=off?'BILLING WORKSPACE':'PAPER COMPARISON';});
$('portal-confirm').onclick=safe(()=>{const year=$('portal-year').value;if(!/^20\d{2}$/.test(year))throw new Error('Choose a valid year.');if(!confirm(`Confirm you meet the eligible portal requirements for ${year}?`))return;const n=clone(ledger);n.settings.portalYears=[...new Set([...n.settings.portalYears,year])];commit(n);renderSettings();});
$('portal-year').onchange=renderSettings;
$('baseline-save').onclick=safe(()=>{const key=$('baseline-patient').value,value=$('baseline-date').value;if(!validDate(value)||value>today())throw new Error('Choose a valid past or current starting billing date.');const n=clone(ledger);n.baselines[key]={date:value,enteredAt:new Date().toISOString()};n.patients[key]=clone(person(key));commit(n);renderSettings();});
$('baseline-patient').onchange=()=>{$('baseline-date').value=ledger.baselines[$('baseline-patient').value]?.date||'';enhanceDateInputs(document);};
$('export-data').onclick=()=>download(`PRIVATE_TRIM_Billing_${today()}.json`,ledger);
$('reload-data').onclick=safe(async()=>{if(saving||checking)throw new Error('Wait for the current save to finish.');if(!confirm('Discard this browser’s unsynced draft and reload the saved file? Download a private backup first if you need to reconcile changes.'))return;clearTimeout(timer);if(dirty)download(`PRIVATE_TRIM_Recovery_Before_Reload_${today()}.json`,ledger);const s=await adapter.load();ledger=s.ledger;savedBase=clone(s.ledger);checkedDrive();etag=s.etag;dirty=false;blocked=false;syncFailed=false;connectionVerified=true;selected=null;editingId=null;seq++;await persistRecovery();notice('');renderAll();status('Reloaded saved billing');});
$('generate').onclick=safe(async()=>{
  guardWrite();
  await flush();if(dirty||blocked||saving)throw new Error('Save all changes successfully before creating the batch.');
  const entries=chosen();if(!entries.length)throw new Error('No current-batch billing in this date range.');if(issuesFor(entries).length){renderReports();throw new Error('Complete the flagged information before generating the report.');}if(!$('rules-reviewed').checked)throw new Error('Review the billing entries and confirm the checkbox first.');
  $('report-dialog').showModal();try{const result=await renderReport($('report-frame'),ledger,roster,entries,$('report-layout').value);$('report-title').textContent=`${result.pages} pages · ${$('report-layout').value==='date'?'By date':'By patient'}`;printedSignature=null;}catch(e){$('report-dialog').close();throw e;}
});
$('print-report').onclick=()=>{printedSignature=signature();$('report-frame').contentWindow.focus();$('report-frame').contentWindow.print();};
$('finalize').onclick=safe(async()=>{guardWrite();await flush();if(dirty||blocked||saving)throw new Error('Save changes before handoff.');if(printedSignature!==signature())throw new Error('Generate and print/save the current batch first.');if(issuesFor(chosen()).length)throw new Error('Resolve the flagged billing information first.');if(!confirm('Confirm this exact batch was successfully saved/printed, reviewed, and actually given to Suzy. It will leave the next print batch, but its billing history stays saved.'))return;commit(finalizeBatch(ledger,chosen(),{from:$('batch-from').value,to:$('batch-to').value,layout:$('report-layout').value,reviewed:$('rules-reviewed').checked,delivered:true}));await flush();renderReports();renderHistory();updateWriteLock();});
window.addEventListener('offline',()=>{driveReachable=false;connectionVerified=false;syncFailed=true;status('Offline — billing locked',true);});
window.addEventListener('online',()=>verifyConnection());
window.addEventListener('beforeunload',e=>{if(dirty||recoveryPending){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)verifyConnection();});
setInterval(verifyConnection,45000);

function renderSaveControls(){
  if(!$('drive-connection'))return;
  const offline=!navigator.onLine,connected=driveReachable&&!offline;
  $('drive-connection').dataset.state=checking?'busy':connected?'ok':'error';
  $('drive-connection').textContent=checking?'◌ Checking Drive…':connected?(adapter?.mode==='local'?'● Local folder connected':'● Drive connected'):'● Reconnect Drive';
  $('drive-connection').title=lastChecked?'Last checked '+formatTimestamp(lastChecked):'Check your connection without saving billing';
  $('drive-connection').disabled=saving||checking||!adapter;
  const changes=localChanges(),count=new Set(changes.filter(r=>r.patientKey).map(r=>r.patientKey)).size;
  $('local-changes').dataset.state=blocked||localRecoveryFailed?'error':dirty?'pending':'ok';
  $('local-changes').textContent=localRecoveryFailed?'! Local save needs attention':recoveryPending?'◌ Saving locally…':dirty?(count?'● Local changes · '+count+' patient'+(count===1?'':'s'):'● Local changes'):'✓ No local changes';
  $('local-changes').title=dirty?'Saved on this device, not in Drive. Click to review changes.':'Everything matches your last Drive save.';
  $('local-changes').disabled=!ledger;
  $('sync').textContent=saving?'◌ Saving session…':'Save session to Drive';
  $('sync').dataset.state=saving?'busy':dirty?'pending':'quiet';
  $('sync').disabled=!dirty||saving||checking||blocked||!connectionVerified||syncFailed||offline;
  $('saved-time').textContent=dirty?'Not yet saved to Drive':savedBase?.updatedAt?'Saved '+formatTimestamp(savedBase.updatedAt):'No changes to save';
  if($('changes-save'))$('changes-save').disabled=$('sync').disabled;
  if($('changes-dialog').open)renderChanges();
}
function cancelCode(id,code=null){
  guardWrite();
  if(!code&&!confirm('Remove all billing codes for this patient and date?'))return;
  commit(cancelBillingCodes(ledger,id,code));
  editingId=null;renderEditor();renderCalendar();renderHistory();renderChanges();
}
function undoCancellation(id){
  guardWrite();commit(undoBillingCancellation(ledger,id));renderEditor();renderCalendar();renderHistory();renderChanges();
}
function billingRows(entry,editable=false){
  if(!entry)return '';
  return '<ul class="change-codes">'+entry.items.map(i=>'<li><div><strong>'+esc(i.code.replace(/^0+/,''))+'</strong><span>'+esc([i.start?(i.start+(i.end?'–'+i.end:'')):'',i.reason||'',i.diagnosis?'ICD-9 '+i.diagnosis:'',i.units>1?i.units+' units':''].filter(Boolean).join(' · '))+'</span></div>'+(editable?'<button class="text-button danger" data-cancel-entry="'+esc(entry.id)+'" data-cancel-code="'+esc(i.code)+'" '+(writeUnavailable()||saving?'disabled':'')+'>Remove ×</button>':'')+'</li>').join('')+'</ul>'+(entry.comment?'<p>'+esc(entry.comment)+'</p>':'');
}
function renderChanges(){
  const changes=localChanges();
  $('changes-summary').textContent=localRecoveryFailed?'Local recovery failed. Keep this tab open and download a private backup in Settings.':recoveryPending?'Saving the latest changes on this device…':dirty?'Saved on this device, not yet in Drive. Includes earlier sessions and backdated billing. Save before switching computers.':'No local changes waiting for Drive.';
  const removals=(ledger?.cancellations||[]).filter(c=>!c.undoneAt&&!savedBase?.cancellations?.some(b=>b.id===c.id));
  $('changes-list').innerHTML=changes.map(r=>'<article class="change-row"><div><strong>'+esc(r.name)+'</strong><span>'+esc(formatDate(r.date))+'</span></div><b>'+esc(!r.after&&r.before?'Will be removed from Drive':r.kind)+'</b>'+(r.before?'<h4>Saved in Drive</h4>'+billingRows(r.before):'')+(r.after?'<h4>After this session save</h4>'+billingRows(r.after,!r.after.batchId)+'<button class="text-button danger" data-cancel-entry="'+esc(r.after.id)+'">Remove all billing for this date</button>':'')+(r.detail?'<p>'+esc(r.detail)+'</p>':'')+'</article>').join('')+removals.map(c=>'<article class="change-row removal-record"><strong>'+esc(ledger.patients[c.before.patientKey]?.name||'Patient')+'</strong><p>'+esc(formatDate(c.before.date))+' · Removed '+c.before.items.filter(i=>!c.after?.items.some(a=>a.code===i.code)).map(i=>esc(i.code.replace(/^0+/,''))).join(', ')+'</p><button data-undo-cancel="'+esc(c.id)+'" '+(writeUnavailable()||saving?'disabled':'')+'>Undo removal</button></article>').join('')||(dirty?'<p>A recovered session is waiting to save. No patient changes compared with the saved snapshot.</p>':'<p>✓ All changes saved.</p>');
  $('changes-list').querySelectorAll('[data-cancel-entry]').forEach(b=>{b.disabled=writeUnavailable()||saving||Boolean(ledger.entries.find(e=>e.id===b.dataset.cancelEntry)?.batchId);b.onclick=safe(()=>cancelCode(b.dataset.cancelEntry,b.dataset.cancelCode||null));});
  $('changes-list').querySelectorAll('[data-undo-cancel]').forEach(b=>b.onclick=safe(()=>undoCancellation(b.dataset.undoCancel)));
  $('changes-conflict').hidden=!blocked;$('changes-conflict').textContent='The saved file changed elsewhere. Nothing will be overwritten. Your local version is retained; use Settings to download it for reconciliation.';
}
$('local-changes').onclick=()=>{renderChanges();$('changes-dialog').showModal();renderSaveControls();};
$('changes-save').onclick=safe(()=>syncSession(true));
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
