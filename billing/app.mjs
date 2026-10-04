import {CODES,codeInfo,clone,today,validDate,patientKey,rosterView,dueState,lastBilling,upsertEntry,removeEntry,batchEntries,entryIssues,finalizeBatch,escapeHTML as esc,validateLedger} from './core.mjs';
import {LocalAdapter,DriveAdapter} from './adapters.mjs';
import {saveRecovery,loadRecovery} from './recovery.mjs';
import {renderReport} from './reports.mjs';
const $=id=>document.getElementById(id);
let adapter,ledger,roster,etag,selected=null,editingId=null,tab='billing',dirty=false,blocked=false,seq=0,saving=false,timer,releaseLock,printedSignature=null,recoveryQueue=Promise.resolve(),recoveryPending=0;
let setupCandidate,connecting=false;
const date=()=>$('service-date').value||today();
const people=()=>rosterView(roster,ledger);
const person=k=>people().find(p=>p.key===k);
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function status(text,warn=false){$('save-status').textContent=text;$('save-status').classList.toggle('dirty',warn);}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){notice(e.message);}};}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function takeTabLock(id){if(!navigator.locks)throw new Error('This browser cannot protect against competing tabs. Use an up-to-date Chrome browser.');return new Promise((resolve,reject)=>navigator.locks.request(`trim-billing:${id}`,{ifAvailable:true},async lock=>{if(!lock)return reject(new Error('This billing file is already open for editing in another tab. Close or lock that tab first.'));resolve();await new Promise(r=>releaseLock=r);}));}
async function recover(){
  const saved=await loadRecovery(ledger.datasetId);
  if(saved?.dirty){
    validateLedger(saved.ledger);ledger=saved.ledger;dirty=true;
    if(saved.etag!==etag){blocked=true;notice('Recovered an unsynced draft, but saved billing has changed. Your draft is retained. Download it in Settings, then reload saved data and reconcile before saving.');}
    else notice('Recovered unfinished billing from this browser. It will save after reconnection.');
  }
}
function persistRecovery(){const snapshot={ledger:clone(ledger),etag,dirty,savedAt:new Date().toISOString()};recoveryPending++;
  recoveryQueue=recoveryQueue.catch(()=>{}).then(()=>saveRecovery(snapshot.ledger.datasetId,snapshot)).then(()=>{recoveryPending--;}).catch(e=>{recoveryPending--;blocked=true;status('Recovery save failed — keep this tab open',true);notice(`Device recovery failed: ${e.message}. Download a private backup before closing.`);throw e;});return recoveryQueue;
}
async function connect(mode,create=false){
  if(connecting)return;connecting=true;
  $('create-cloud').hidden=true;
  $('connection-error').textContent='Connecting…';
  try{
    const candidate=create?setupCandidate:mode==='local'?new LocalAdapter():new DriveAdapter($('cloud-file-id').value);
    if(!candidate)throw new Error('Connect through Google first.');
    if(!create)await candidate.connect();
    const r=await candidate.roster();let s;
    try{s=create?await candidate.createEmpty():await candidate.load();}
    catch(e){if(e.code==='MISSING_BILLING'){setupCandidate=candidate;$('create-cloud').hidden=false;}throw e;}
    if(releaseLock){releaseLock();releaseLock=null;}
    await takeTabLock(s.ledger.datasetId);
    adapter=candidate;roster=r;ledger=s.ledger;etag=s.etag;dirty=false;blocked=false;selected=null;editingId=null;
    await recover();
    $('gate').hidden=true;$('workspace').hidden=false;$('connection-dialog').close();document.title='TRIM Billing · Parallel review';
    $('storage-note').textContent=mode==='local'?'Local preview · saves to this laptop’s Drive folder. Cloud sync is not verified. Original roster: read-only.':'Google Drive connected · original roster: read-only.';
    renderAll();document.querySelector('.version').textContent=ledger.settings.parallel?'NEW · PARALLEL REVIEW':'BILLING WORKSPACE';if(dirty&&!blocked)await flush();else status(blocked?'Draft conflict — action needed':mode==='local'?'Local Drive folder connected':'Saved to Google Drive',blocked);
  }catch(e){if(releaseLock){releaseLock();releaseLock=null;}$('connection-error').textContent=e.message;}
  finally{connecting=false;}
}
function commit(next){if(blocked)throw new Error('Saving is blocked. Resolve the recovery/conflict notice first.');ledger=next;ledger.units=clone(roster.units);seq++;dirty=true;printedSignature=null;status('Saving on this device…',true);persistRecovery().then(()=>{if(!blocked){status(adapter.mode==='local'?'Saved on device · syncing to folder…':'Saved on device · waiting to sync',true);clearTimeout(timer);timer=setTimeout(()=>flush(),600);}}).catch(()=>{});renderStats();renderRoster();}
async function flush(){
  clearTimeout(timer);if(!dirty||saving||blocked||!adapter)return;
  saving=true;const currentSeq=seq;const snapshot=clone(ledger);
  try{
    await recoveryQueue;status('Saving…',true);const saved=await adapter.save(snapshot,etag);etag=saved.etag;
    if(seq===currentSeq){ledger=saved.ledger;dirty=false;}else{ledger.revision=saved.ledger.revision;ledger.updatedAt=saved.ledger.updatedAt;ledger.localWriter=saved.ledger.localWriter;}
    await persistRecovery();status(dirty?'More changes waiting to save':adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive',dirty);
  }catch(e){if(e.status===409){blocked=true;notice(e.message+' Your encrypted draft is retained. Use Settings to download it before reloading.');}else{notice(e.message+' Your draft remains on this device. Use Sync / retry after reconnecting.');}status(e.status===409?'Conflict — save stopped':'Saved on device · not synced',true);}
  finally{saving=false;if(dirty&&!blocked&&seq!==currentSeq)timer=setTimeout(flush,600);}
}
function renderAll(){
  $('unit-filter').innerHTML='<option value="">All units</option>'+roster.units.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  $('other-unit').innerHTML=roster.units.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  renderStats();renderRoster();renderEditor();renderReports();renderHistory();renderSettings();
}
function renderStats(){const pts=people(),own=pts.filter(p=>p.panel),day=ledger.entries.filter(e=>e.date===date());const missing=day.filter(e=>entryIssues(e,ledger,person(e.patientKey)).length);$('stats').innerHTML=[['My panel',own.length,'No patient limit'],['Selected this date',day.length,'Patients with billing'],['Needs information',missing.length,'Drafts saved, not ready'],['Due for review',own.filter(p=>dueState(ledger,p,date()).kind==='due').length,`${own.filter(p=>dueState(ledger,p,date()).kind==='unknown').length} with unknown history`]].map(([label,n,sub])=>`<div class="stat"><span>${label}</span><b>${n}</b><small>${sub}</small></div>`).join('');}
function renderRoster(){
  const q=$('search').value.toLowerCase().trim(),unit=$('unit-filter').value,panel=$('panel-filter').value,dueOnly=$('due-filter').checked;
  const pts=people().filter(p=>(panel==='all'||(panel==='mine'?p.panel:!p.panel))&&(!unit||p.unit===unit)&&(!q||`${p.name} ${p.room} ${p.phn}`.toLowerCase().includes(q))&&(!dueOnly||dueState(ledger,p,date()).kind==='due'));
  const units=[...roster.units];for(const p of pts)if(!units.some(u=>u.id===p.unit))units.push({id:p.unit,name:p.unit||'OTHER',floor:''});
  $('roster').innerHTML=units.map(u=>{const group=pts.filter(p=>p.unit===u.id).sort((a,b)=>a.room.localeCompare(b.room,undefined,{numeric:true})||a.name.localeCompare(b.name));if(!group.length)return '';return `<section class="unit"><div class="unit-heading"><span>${esc(u.name)}${u.floor?` · FLOOR ${esc(u.floor)}`:''}</span><span>${group.length}</span></div>${group.map(p=>{const e=ledger.entries.find(e=>e.patientKey===p.key&&e.date===date());const d=dueState(ledger,p,date());return `<button class="patient ${selected===p.key?'selected':''}" data-patient="${esc(p.key)}"><span class="room">${esc(p.room||'—')}</span><span><span class="patient-name">${esc(p.name)}${p.pFlag?'<span class="pflag">P</span>':''}</span><span class="patient-detail">${d.last?`Billing basis ${d.last}`:p.panel?'Starting history not supplied':'Reason required for coverage billing'}</span></span><span class="patient-right">${e?`<span class="pill">${e.items.map(i=>esc(i.code.replace(/^0+/,''))).join(' · ')}</span><span class="patient-detail">${e.batchId?'Handed over':entryIssues(e,ledger,p).length?'Needs information':'Selected'}</span>`:`<span class="pill ${d.kind==='unknown'?'warn':''}">${esc(d.label)}</span>`}</span></button>`;}).join('')}</section>`;}).join('')||'<div class="empty">No patients match these filters.</div>';
  $('roster').querySelectorAll('[data-patient]').forEach(b=>b.onclick=()=>{selected=b.dataset.patient;editingId=null;renderRoster();renderEditor();});
}
function currentEntry(){return editingId?ledger.entries.find(e=>e.id===editingId):ledger.entries.find(e=>e.patientKey===selected&&e.date===date());}
function applyItems(items,comment=currentEntry()?.comment||''){
  const p=person(selected),e=currentEntry();if(!p)throw new Error('Select a patient.');
  if(!items.length){if(e){if(!confirm('Remove this pending billing entry?'))return;commit(removeEntry(ledger,e.id));editingId=null;}renderEditor();return;}
  const next=upsertEntry(ledger,p,date(),items,comment,e?.id);editingId=next.entries.find(x=>x.patientKey===p.key&&x.date===date()).id;commit(next);
}
function renderEditor(){
  if(!selected)return;const p=person(selected);if(!p)return;const e=currentEntry(),items=e?.items||[],locked=Boolean(e?.batchId);
  $('editor').innerHTML=`<div class="editor-head"><span class="eyebrow">${esc(date())} · ${p.panel?'MY PANEL':'COVERAGE'}</span><h2>${esc(p.name)}</h2><p>PHN ${esc(p.phn||'—')} · ${esc(p.unit)} · Room ${esc(p.room||'—')}</p><p>ICD ${esc(p.codes||'—')}</p></div>${locked?'<div class="issue-box">Handed over. This entry is read-only.</div>':''}<h3>Choose billing codes</h3><div class="codes-grid">${CODES.map(c=>`<button class="code-chip ${items.some(i=>i.code===c.code)?'on':''}" data-code="${c.code}" ${locked?'disabled':''}>${c.code}<small>${esc(c.label)}</small></button>`).join('')}</div><details><summary>Another code</summary><div class="fields"><label>Full five-digit code<input id="custom-code" maxlength="5" inputmode="numeric"></label><button id="add-code" ${locked?'disabled':''}>Add</button></div></details><div id="item-details">${items.map((i,index)=>itemHTML(i,index,locked)).join('')}</div><label>Billing comment<textarea id="entry-comment" maxlength="3000" ${locked?'disabled':''} placeholder="Only information needed for billing">${esc(e?.comment||'')}</textarea></label><div id="editor-issues"></div>${e&&!locked?'<button id="remove-entry" class="text-button danger">Remove this pending billing date</button>':''}<hr><h3>Billing dates</h3><div>${ledger.entries.filter(x=>x.patientKey===p.key).sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<div class="history-row"><span>${esc(x.date)}<small> · ${x.items.map(i=>i.code).join(', ')}${x.batchId?' · Final':''}</small></span><button data-edit="${x.id}">View</button></div>`).join('')||'<p class="hint">No billing recorded yet.</p>'}</div>${ledger.baselines[p.key]?`<p class="hint">Starting qualifying billing: ${esc(ledger.baselines[p.key].date)}</p>`:''}`;
  $('editor').querySelectorAll('[data-code]').forEach(b=>b.onclick=safe(()=>{const current=currentEntry()?.items||[];applyItems(current.some(i=>i.code===b.dataset.code)?current.filter(i=>i.code!==b.dataset.code):[...current,{code:b.dataset.code,units:1}]);renderEditor();}));
  $('add-code').onclick=safe(()=>{const code=$('custom-code').value.trim();if(!/^\d{5}$/.test(code))throw new Error('Enter the full five-digit fee code.');if(currentEntry()?.items.some(i=>i.code===code))throw new Error('That code is already selected.');applyItems([...(currentEntry()?.items||[]),{code,units:1}]);renderEditor();});
  $('editor').querySelectorAll('[data-field]').forEach(input=>input.addEventListener('input',safe(()=>{const list=clone(currentEntry().items);list[Number(input.dataset.index)][input.dataset.field]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;applyItems(list);renderEditorIssues();})));
  $('entry-comment').oninput=safe(()=>{if(!currentEntry())return;applyItems(clone(currentEntry().items),$('entry-comment').value);renderEditorIssues();});
  if($('remove-entry'))$('remove-entry').onclick=safe(()=>applyItems([]));
  $('editor').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEntry(b.dataset.edit));renderEditorIssues();
}
function itemHTML(i,index,locked){
  const c=codeInfo(i.code);const field=(name,label,type='text',extra='')=>`<label>${label}<input type="${type}" data-index="${index}" data-field="${name}" ${type==='checkbox'?(i[name]?'checked':''):`value="${esc(i[name]??'')}"`} ${locked?'disabled':''} ${extra}></label>`;
  return `<div class="code-details"><h3>${esc(i.code)} · ${esc(c?.label||'Other code')}</h3><p>${esc(c?.note||'Rules for this code must be verified before finalizing.')}</p>${!c?field('customLabel','Description')+field('customVerified','I checked this code’s service-date rules','checkbox')+field('customTimed','This code requires start/end times','checkbox'):''}${c?.timed||!c?`<div class="fields">${field('start','Start','time')}${field('end','End','time')}${field('units','Units','number',`min="1" max="${c?2:99}"`)}</div>`:c?.attendance?field('start','Attendance time','time'):''}${c?.request?field('requestAt','Request date and time','datetime-local')+field('requester','Requesting person / role'):''}${c?.participants?field('participants','Participants / roles'):''}${field('reason',c?.reason||!person(selected)?.panel?'Reason / claim note (required)':'Reason / claim note (if needed)','text','maxlength="2000"')}${c?.admission||c?.callout?field('attested',c.admission?'I confirm admission criteria and required documentation':'I confirm special call, travel and first patient on this call','checkbox'):''}</div>`;
}
function renderEditorIssues(){const e=currentEntry();if(!$('editor-issues'))return;const issues=e?entryIssues(e,ledger,person(selected)):[];$('editor-issues').innerHTML=issues.length?`<div class="issue-box"><strong>Saved as a draft · needs information</strong><ul>${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:e?'<p class="hint">Required fields complete. Physician eligibility review still required.</p>':'';}
function openEntry(id){const e=ledger.entries.find(e=>e.id===id);if(!e)return;selected=e.patientKey;editingId=e.id;$('service-date').value=e.date;switchTab('billing');renderStats();renderRoster();renderEditor();}
function chosen(){return batchEntries(ledger,$('batch-from').value,$('batch-to').value);}
function issuesFor(entries){return entries.flatMap(e=>entryIssues(e,ledger,person(e.patientKey)).map(issue=>({id:e.id,text:`${person(e.patientKey)?.name||'Patient'} · ${e.date} · ${issue}`})));}
function signature(){return JSON.stringify({entries:chosen(),layout:$('report-layout').value,revision:ledger.revision,parallel:ledger.settings.parallel});}
function renderReports(){const entries=chosen(),issues=issuesFor(entries);$('batch-summary').innerHTML=`<p><strong>${entries.length}</strong> patient-date entries · <strong>${new Set(entries.map(e=>e.date)).size}</strong> dates · <strong>${new Set(entries.map(e=>e.patientKey)).size}</strong> patients</p>`;$('batch-issues').innerHTML=issues.length?`<div class="card"><h2>${issues.length} items need attention</h2>${issues.map(x=>`<div class="history-row"><span>${esc(x.text)}</span><button data-fix="${x.id}">Review</button></div>`).join('')}</div>`:'';$('batch-issues').querySelectorAll('[data-fix]').forEach(b=>b.onclick=()=>openEntry(b.dataset.fix));$('finalize').disabled=ledger.settings.parallel;}
function renderHistory(){const entries=[...ledger.entries].sort((a,b)=>b.date.localeCompare(a.date));$('history-content').innerHTML=`<div class="card"><table class="history-table"><thead><tr><th>Date</th><th>Patient</th><th>Codes</th><th>Status</th><th></th></tr></thead><tbody>${entries.map(e=>`<tr><td>${esc(e.date)}</td><td>${esc(person(e.patientKey)?.name)}</td><td>${e.items.map(i=>esc(i.code)).join(' · ')}</td><td>${e.batchId?'Handed over':'Pending'}</td><td><button data-history="${e.id}">View</button></td></tr>`).join('')}</tbody></table>${entries.length?'':'<div class="empty">Your billing history will appear here.</div>'}</div>${ledger.batches.map(b=>`<div class="card"><h3>${esc(b.from)} → ${esc(b.to)}</h3><p>${b.entryIds.length} entries · handed over ${esc(b.handedOverAt.slice(0,10))}</p></div>`).join('')}`;$('history-content').querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>openEntry(b.dataset.history));}
function renderSettings(){
  const previousPatient=$('baseline-patient').value;
  $('parallel').checked=ledger.settings.parallel;$('baseline-patient').innerHTML=people().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('');
  if(previousPatient&&person(previousPatient))$('baseline-patient').value=previousPatient;
  $('baseline-date').value=ledger.baselines[$('baseline-patient').value]?.date||'';
  $('portal-years').innerHTML=(ledger.settings.portalYears||[]).map(y=>`<span class="pill">${esc(y)} confirmed</span>`).join(' ');
  $('baseline-list').innerHTML=Object.entries(ledger.baselines).map(([k,b])=>`<div class="history-row">${esc(person(k)?.name||'Retained patient')} <span>${esc(b.date)}</span></div>`).join('');
  const year=$('portal-year').value;const counts={};for(const e of ledger.entries.filter(e=>e.date.startsWith(year)))for(const i of e.items)counts[i.code]=(counts[i.code]||0)+Number(i.units);
  $('annual-counts').innerHTML=Object.entries(counts).map(([c,n])=>`<div class="history-row"><span>${c}</span><span>${n} units · ${year}</span></div>`).join('')||'<p class="hint">No recorded usage this year.</p>';
}
function switchTab(name){tab=name;document.querySelectorAll('.tab').forEach(s=>s.hidden=s.id!==name);document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));if(name==='reports')renderReports();if(name==='history')renderHistory();if(name==='settings')renderSettings();}
$('connect').onclick=()=>{$('connection-error').textContent='';$('connection-dialog').showModal();};
$('local-option').hidden=!['127.0.0.1','localhost'].includes(location.hostname);
$('local-connect').onclick=()=>connect('local');$('cloud-connect').onclick=()=>connect('cloud');
$('create-cloud').onclick=()=>{if(confirm('Create a new empty private billing file in My Drive? Only continue if you have no existing billing data to import. The original roster will not change.'))connect('cloud',true);};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('service-date').value=today();$('service-date').max=today();$('batch-from').value=today().slice(0,7)+'-01';$('batch-to').value=today();$('portal-year').value=today().slice(0,4);$('baseline-date').max=today();
$('service-date').onchange=()=>{editingId=null;renderStats();renderRoster();renderEditor();};
for(const id of ['search','unit-filter','panel-filter','due-filter'])$(id).addEventListener('input',()=>renderRoster());
for(const id of ['batch-from','batch-to','report-layout'])$(id).onchange=()=>{printedSignature=null;renderReports();};
$('sync').onclick=safe(async()=>{if(blocked)throw new Error('Resolve the conflict in Settings first.');if(adapter.mode==='cloud')await adapter.connect();else await adapter.connect();if(dirty){await flush();return;}const [r,s]=await Promise.all([adapter.roster(),adapter.load()]);roster=r;ledger=s.ledger;etag=s.etag;printedSignature=null;await persistRecovery();notice('');renderAll();status(adapter.mode==='local'?'Saved to Drive folder · sync unverified':'Saved to Google Drive');});
$('lock').onclick=safe(async()=>{await persistRecovery();if(dirty&&!confirm('Changes remain on this device. Lock anyway? Reconnect on this browser to recover them.'))return;releaseLock?.();releaseLock=null;location.reload();});
$('add-other').onclick=()=>{$('other-error').textContent='';$('other-dialog').showModal();};
$('other-form').onsubmit=async ev=>{ev.preventDefault();try{const f=new FormData(ev.target);const p={id:crypto.randomUUID(),name:String(f.get('name')).trim(),phn:String(f.get('phn')),unit:String(f.get('unit')),room:String(f.get('room')).trim(),codes:String(f.get('codes')).trim(),ava:'',panel:false};p.key=patientKey(p);if(people().some(x=>x.key===p.key))throw new Error('This patient already exists. Select the existing record.');const next=clone(ledger);next.nonPanel.push(p);next.patients[p.key]=p;commit(next);$('other-dialog').close();ev.target.reset();$('panel-filter').value='other';selected=p.key;editingId=null;renderRoster();renderEditor();}catch(e){$('other-error').textContent=e.message;}};
$('parallel').onchange=safe(()=>{const off=!$('parallel').checked;if(off&&!confirm('End paper-comparison mode? Only do this when you are ready to use digital reports as the single MOA billing source.')){$('parallel').checked=true;return;}const n=clone(ledger);n.settings.parallel=!off;commit(n);document.querySelector('.version').textContent=off?'BILLING WORKSPACE':'NEW · PARALLEL REVIEW';});
$('portal-confirm').onclick=safe(()=>{const year=$('portal-year').value;if(!/^20\d{2}$/.test(year))throw new Error('Choose a valid year.');if(!confirm(`Confirm you meet the eligible portal requirements for ${year}?`))return;const n=clone(ledger);n.settings.portalYears=[...new Set([...n.settings.portalYears,year])];commit(n);renderSettings();});
$('portal-year').onchange=renderSettings;
$('baseline-save').onclick=safe(()=>{const key=$('baseline-patient').value,value=$('baseline-date').value;if(!validDate(value)||value>today())throw new Error('Choose a valid past or current starting billing date.');const n=clone(ledger);n.baselines[key]={date:value,enteredAt:new Date().toISOString()};n.patients[key]=clone(person(key));commit(n);renderSettings();});
$('baseline-patient').onchange=()=>{$('baseline-date').value=ledger.baselines[$('baseline-patient').value]?.date||'';};
$('export-data').onclick=()=>download(`PRIVATE_TRIM_Billing_${today()}.json`,ledger);
$('reload-data').onclick=safe(async()=>{if(saving)throw new Error('Wait for the current save to finish.');if(!confirm('Discard this browser’s unsynced draft and reload the saved file? Download a private backup first if you need to reconcile changes.'))return;clearTimeout(timer);const s=await adapter.load();ledger=s.ledger;etag=s.etag;dirty=false;blocked=false;selected=null;editingId=null;seq++;await persistRecovery();notice('');renderAll();status('Reloaded saved billing');});
$('generate').onclick=safe(async()=>{
  await flush();if(dirty||blocked||saving)throw new Error('Save all changes successfully before creating the batch.');
  const entries=chosen();if(!entries.length)throw new Error('No pending billing in this date range.');if(issuesFor(entries).length){renderReports();throw new Error('Complete the flagged information before generating the report.');}if(!$('rules-reviewed').checked)throw new Error('Review the billing entries and confirm the checkbox first.');
  $('report-dialog').showModal();try{const result=await renderReport($('report-frame'),ledger,roster,entries,$('report-layout').value);$('report-title').textContent=`${result.pages} pages · ${$('report-layout').value==='date'?'By date':'By patient'}`;printedSignature=null;}catch(e){$('report-dialog').close();throw e;}
});
$('print-report').onclick=()=>{printedSignature=signature();$('report-frame').contentWindow.focus();$('report-frame').contentWindow.print();};
$('finalize').onclick=safe(async()=>{await flush();if(dirty||blocked||saving)throw new Error('Save changes before handoff.');if(printedSignature!==signature())throw new Error('Generate and print/save the current batch first.');if(issuesFor(chosen()).length)throw new Error('Resolve the flagged billing information first.');if(!confirm('Confirm this exact batch was successfully saved/printed, reviewed, and actually delivered to your MOA. This locks its billing entries.'))return;commit(finalizeBatch(ledger,chosen(),{from:$('batch-from').value,to:$('batch-to').value,layout:$('report-layout').value,reviewed:$('rules-reviewed').checked,delivered:true}));await flush();renderReports();renderHistory();});
window.addEventListener('online',()=>{if(dirty&&!blocked)flush();});
window.addEventListener('beforeunload',e=>{if(dirty||recoveryPending){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)flush();});
