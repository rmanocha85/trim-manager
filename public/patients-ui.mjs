import * as TrimRoster from './patients-core.mjs';
import {avaChartUrl} from './patient-links.mjs';
import {rosterPrintPages} from './roster-print.mjs';
import {RosterRepository} from './roster-repository.mjs';
import {mergeRoster} from './roster-merge.mjs';
import {saveRecovery,loadRecovery} from './recovery.mjs';
export async function patientsUI({host,onChange=()=>{},onRoster=()=>{}}){

const MAX_D=17;
const LIST_PAGES=[['cedar','cherry','hatzic','fern'],['dewdney','deroche','silver','stave']];




// Documented physician group: TRIM Management, reviewed October 13, 2026.
// Assignments stay private in otherPatients[].doctor; do not infer ownership.
const OTHER_DOCTORS=[
  {name:'Dr. Adam Siemens'},
  {name:'Dr. Celine Laferriere'},
  {name:'Dr. Kirti Aneja'},
  {name:'Dr. Tarun Soni'},
  {name:'Dr. Hamzah Nasir',status:'Onboarding'}
];
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_S=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];


  const root=host.attachShadow({mode:'open'});
  const [html,css]=await Promise.all(['patients.html','patients.css'].map(async file=>{const r=await fetch('./'+file+'?v=20261022-fixes1');if(!r.ok)throw new Error('Could not load TRIM Patients.');return r.text();}));
  const style=document.createElement('style');
  style.textContent=css.replace(/body:not\(\.drive-connected\)/g,':host(:not(.drive-connected))').replace(/body\.drive-connected/g,':host(.drive-connected)').replace(/body\.history-mode/g,':host(.history-mode)').replace(/body\.pb/g,':host(.pb)').replace(/\bbody\b/g,':host').replace(/:root/g,':host')+'\n:host{display:block;min-height:0}header{position:static}#app-title{font-size:20px}';
  root.append(style);const content=document.createElement('div');content.innerHTML=html;root.append(content);
  let state={patients:[],otherPatients:[],removedPatients:[],units:[],billingDates:[]};
  let delId=null,editId=null,pendingDateKey=null,calYear=new Date().getFullYear(),calMonth=new Date().getMonth();
  let rosterDocument=null,loadedRosterJSON=null,repository,etag,key,ready=false,dirty=false,writeBlocked=false,pendingSaves=0,saving=false,localError='',message='',serial=Promise.resolve();
  const newPatientFields=['in-name','in-phn','in-room','in-codes','in-ava'];
  let rosterChoices={},rosterConflicts=[],refreshing=false;
  const review=document.createElement('dialog');review.id='roster-conflict-dialog';root.append(review);
  function showRosterConflicts(){
    const detail=value=>value===undefined?'Removed / not present':typeof value==='object'?JSON.stringify(value,null,2):String(value);
    review.innerHTML='<h2>Review patient changes</h2><p>These details changed differently on both computers. Other changes will be combined.</p>'+rosterConflicts.map((c,n)=>`<article><strong>${esc(c.label)}</strong><div class="roster-versions"><section><h3>Saved in Drive</h3><pre>${esc(detail(c.drive))}</pre></section><section><h3>Pending on this computer</h3><pre>${esc(detail(c.local))}</pre></section></div><label><input type="radio" name="roster-${n}" data-choice="${n}" value="drive"> Keep Drive</label> <label><input type="radio" name="roster-${n}" data-choice="${n}" value="local"> Keep local</label></article>`).join('')+'<button id="roster-apply" disabled>Apply choices locally</button> <button id="roster-close">Close</button><p>Use Save to Drive when finished. Reload saved roster keeps a recovery copy before discarding local edits.</p>';
    review.querySelectorAll('[data-choice]').forEach(el=>el.onchange=()=>{const c=rosterConflicts[Number(el.dataset.choice)];rosterChoices[c.id]={token:c.token,side:el.value};review.querySelector('#roster-apply').disabled=!rosterConflicts.every(c=>rosterChoices[c.id]?.token===c.token);});
    review.querySelector('#roster-close').onclick=()=>review.close();
    review.querySelector('#roster-apply').onclick=async()=>{try{await refresh(true);}catch(e){setSS(e.message,false);}};
    if(!review.open)review.showModal();
  }
  async function refresh(showConflicts=false){
    if(!ready||saving||refreshing||hasForm()||inHistoryView)return false;
    refreshing=true;updateStatus();
    try{
      await serial;const saved=await repository.load();if(hasForm())return false;
      if(saved.etag===etag&&!writeBlocked)return false;
      const merged=dirty?mergeRoster(loadedRosterJSON?JSON.parse(loadedRosterJSON):null,liveRoster(),saved.roster,rosterChoices):{roster:saved.roster,conflicts:[]};
      rosterConflicts=merged.conflicts;
      if(rosterConflicts.length){writeBlocked=true;if(showConflicts)showRosterConflicts();return true;}
      applyRoster(merged.roster);etag=saved.etag;loadedRosterJSON=JSON.stringify(saved.roster);
      dirty=!TrimRoster.sameRosterContent(merged.roster,saved.roster);writeBlocked=false;rosterChoices={};
      if(review.open)review.close();await persist();render();onRoster(liveRoster());return true;
    }finally{refreshing=false;updateStatus();}
  }
  function currentRoster(){return {...rosterDocument,patients:state.patients,removedPatients:state.removedPatients,units:state.units,billingDates:state.billingDates};}
  function applyRoster(raw){rosterDocument=TrimRoster.normalize(raw);for(const name of ['patients','removedPatients','units','billingDates'])state[name]=rosterDocument[name];}
  function canEdit(){if(!ready||inHistoryView||writeBlocked||saving||refreshing||localError){alert('Finish or resolve the current roster operation before editing.');return false;}return true;}
  function setSS(text,ok){message=text;g('ss').textContent=text;g('ss').style.color=ok?'rgba(255,255,255,.9)':'#ffe0a5';}
  function updateStatus(){
    setSS(localError?'Local recovery failed — keep this tab open':writeBlocked?'Conflict — local changes retained':pendingSaves?'Saving locally…':dirty?'Saved locally · not yet in Drive':ready?(repository.mode==='local'?'Saved in Drive folder · sync unverified':'Saved in Drive'):'Open the workspace to load patients',!dirty&&!writeBlocked&&!localError);
    g('btn-connect').disabled=saving||pendingSaves>0;g('btn-connect').dataset.state=writeBlocked?'error':'ok';
    refreshNotesUploadControls();onChange();
  }
  function liveRoster(){return inHistoryView&&liveStateBackup?{...currentRoster(),...liveStateBackup}:currentRoster();}
  const isForm=el=>/^(in-|en-|ep-|eu-|er-|ec-|ea-|epf-)/.test(el.id||'');
  function formValues(){return Object.fromEntries([...root.querySelectorAll('input[id],select[id]')].filter(isForm).map(el=>[el.id,el.type==='checkbox'?el.checked:el.value]));}
  function hasForm(){return editId!==null||newPatientFields.some(id=>g(id).value.trim())||g('in-pflag').checked;}
  function persist(){
    if(!ready)return Promise.resolve();const snapshot={roster:structuredClone(liveRoster()),etag,base:loadedRosterJSON,dirty,editId,form:formValues()};pendingSaves++;
    serial=serial.catch(()=>{}).then(()=>saveRecovery(key,snapshot)).then(()=>{pendingSaves--;localError='';updateStatus();}).catch(e=>{pendingSaves--;localError=e.message;updateStatus();throw e;});updateStatus();return serial;
  }
  function stageRoster(){dirty=true;onRoster(liveRoster());return persist();}
  async function connect(adapter,dataset){
    if(dirty||hasForm())throw new Error('Save or discard TRIM Patients changes before reconnecting.');
    repository=new RosterRepository(adapter);key=`patients:${dataset}:${adapter.mode}`;
    const saved=await repository.load();applyRoster(saved.roster);etag=saved.etag;loadedRosterJSON=JSON.stringify(saved.roster);ready=true;dirty=false;writeBlocked=false;
    const recovered=await loadRecovery(key);
    if(recovered?.dirty){TrimRoster.normalize(recovered.roster);applyRoster(recovered.roster);dirty=true;writeBlocked=recovered.etag!==etag;etag=recovered.etag;loadedRosterJSON=recovered.base;}
    host.classList.add('drive-connected');render();renderCal();
    if(recovered?.editId&&state.patients.some(p=>String(p.id)===String(recovered.editId))){editId=recovered.editId;render();}
    if(recovered?.form)for(const [id,value]of Object.entries(recovered.form)){const el=g(id);if(el){if(el.type==='checkbox')el.checked=value===true;else el.value=String(value);}}
    updateStatus();onRoster(liveRoster());
  }
  async function save(){
    if(!ready)throw new Error('TRIM Patients is not loaded.');await serial;if(localError)throw new Error('TRIM Patients local recovery needs attention.');await refresh(true);if(writeBlocked)throw new Error('Review the patient details changed on both computers, then save again.');
    if(!dirty)return;saving=true;updateStatus();
    try{const result=await repository.save(liveRoster(),etag);etag=result.etag;loadedRosterJSON=JSON.stringify(result.roster);dirty=false;
      if(inHistoryView){liveStateBackup={patients:result.roster.patients,units:result.roster.units,billingDates:result.roster.billingDates};rosterDocument=result.roster;state.removedPatients=result.roster.removedPatients||[];}
      else applyRoster(result.roster);
      await persist();onRoster(result.roster);
    }catch(e){if(e.status===409)writeBlocked=true;throw e;}finally{saving=false;render();updateStatus();}
  }
  async function gConnect(){
    if(!ready||saving||refreshing)return;
    if((dirty||hasForm())&&!confirm('Discard local roster edits and reload the saved roster? A recovery copy will remain on this device.'))return;
    await serial;const saved=await repository.load();
    if(dirty||hasForm())await saveRecovery(key+':discarded',{roster:liveRoster(),etag,dirty:true,base:loadedRosterJSON,editId,form:formValues()});
    inHistoryView=false;liveStateBackup=null;host.classList.remove('history-mode');g('history-banner').style.display='none';editId=null;
    applyRoster(saved.roster);etag=saved.etag;loadedRosterJSON=JSON.stringify(saved.roster);dirty=false;writeBlocked=false;newPatientFields.forEach(id=>g(id).value='');g('in-pflag').checked=false;
    rosterChoices={};rosterConflicts=[];if(review.open)review.close();render();renderCal();await persist();onRoster(saved.roster);updateStatus();
  }
  function listSnapshots(){return repository.snapshots();}
  function loadSnapshot(id){return repository.snapshot(id);}
  function showPrint(title,body,billing){
    if(!ready||saving||writeBlocked)throw new Error('Resolve the roster operation before printing.');
    const dialog=document.getElementById('patients-print-dialog');
    document.getElementById('patients-print-title').textContent=title;
    document.getElementById('patients-print-frame').srcdoc='<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+'</title><link rel="stylesheet" href="'+new URL('./patients.css',location.href).href+'"><style>body{background:white}#print-trim,#print-billing{display:block!important}</style></head><body class="drive-connected'+(billing?' pb':'')+'"><div id="'+(billing?'print-billing':'print-trim')+'">'+body+'</div></body></html>';
    dialog.showModal();
  }
  const actions={showTab,addPatient,addUnit,calNext,calPrev,calSelectDay,cancelEdit,cancelSeen,clearDates,closeModal,confirmDel,confirmSeen,copyPhn,delUnit,editSeen,exitHistoryView,gConnect,printBilling,printTrim,promptDel,removeDate,saveEdit,startEdit,toggleU,viewSnapshot,renderOtherPatients};
  function argumentsFor(text,element){
    if(!text.trim())return [];const parts=text.match(/'(?:[^']*)'|\bthis\b|\d+/g)||[];
    if(parts.join(',').replace(/\s/g,'')!==text.replace(/\s/g,''))throw new Error('Invalid patient action.');
    return parts.map(value=>value==='this'?element:value[0]==="'"?value.slice(1,-1):Number(value));
  }
  for(const type of ['click','input','change'])root.addEventListener(type,async event=>{
    const element=event.target.closest(`[data-${type}]`);
    try{if(element){const match=/^(\w+)\((.*)\)$/.exec(element.getAttribute('data-'+type));if(!match||!actions[match[1]])throw new Error('Unknown patient action.');await actions[match[1]](...argumentsFor(match[2],element));}
      if(type!=='click'&&ready&&!inHistoryView&&isForm(event.target))void persist().catch(()=>{});
    }catch(e){setSS(e.message,false);alert(e.message);}
  });
  const api={connect,save,refresh,reload:gConnect,state:()=>({dirty,busy:saving||refreshing||pendingSaves>0,error:localError||writeBlocked,ready,mode:repository?.mode,draft:hasForm()}),hasChanges:()=>dirty||hasForm()||pendingSaves>0,beforeLock:async()=>{await serial;},roster:()=>liveRoster()};

// ── TABS ──
function showTab(name,btn){
  root.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  root.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  g('tab-'+name).classList.add('active');btn.classList.add('active');
  if(name==='units')renderUMng();
  if(name==='billing-dates'){renderCal();renderDates();}
  if(name==='history')renderSnapshotList();
  if(name==='removed')renderRemoved();
  if(name==='other-patients')renderOtherPatients();
}
function renderRemoved(){
  const el=g('removed-list');
  if(!ready){el.textContent='Connect Google Drive to see retained records.';return;}
  if(inHistoryView){el.textContent='Return to Today (Live) to see retained records.';return;}
  const records=TrimRoster.expire(currentRoster()).removedPatients;
  el.innerHTML=records.length?`<table><thead><tr><th>Name</th><th>Unit / room</th><th>Removed</th><th>Expires</th></tr></thead><tbody>${records.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.unit)} / ${esc(p.room)}</td><td>${esc(p.removedDate)}</td><td>${TrimRoster.expiresOn(p.removedDate)}</td></tr>`).join('')}</tbody></table>`:'No retained removed patients.';
}

async function renderSnapshotList(){
  const el=g('snapshot-list');
  if(!ready){
    el.innerHTML=`<p style="color:var(--muted);font-size:13px;font-style:italic">Connect Google Drive to see past lists.</p>`;
    return;
  }
  el.innerHTML=`<p style="color:var(--muted);font-size:13px;font-style:italic">Loading…</p>`;
  try{
    const files=await listSnapshots();
    if(files.length===0){
      el.innerHTML=`<p style="color:var(--muted);font-size:13px;font-style:italic">No past snapshots yet — one gets saved with your first roster save after loading the list from Drive.</p>`;
      return;
    }
    el.innerHTML=files.map(f=>{
      const label=f.name.replace('trim-patients-','').replace('.json','');
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light)">
        <span style="flex:1;font-weight:500;font-family:var(--mono)">${esc(label)}</span>
        <button class="btn btn-outline btn-sm" data-click="viewSnapshot('${f.id}','${esc(label)}')">View &amp; Print</button>
      </div>`;
    }).join('');
  }catch(e){
    el.innerHTML=`<p style="color:var(--danger);font-size:13px">Failed to load past lists.</p>`;
    console.error(e);
  }
}

let inHistoryView=false;
let liveStateBackup=null;

async function viewSnapshot(fileId,label){
  if(pendingSaves){alert('Wait for the current save to finish.');return;}
  if(!ready){alert('Please connect Google Drive first.');return}
  try{
    const data=await loadSnapshot(fileId);
    // Back up the live state so we can restore it exactly
    if(!inHistoryView)liveStateBackup={patients:state.patients,units:state.units,billingDates:state.billingDates};
    if(data.patients) state.patients=data.patients;
    if(data.units && data.units.length>0) state.units=data.units;
    if(data.billingDates) state.billingDates=data.billingDates;
    inHistoryView=true;
    host.classList.add('history-mode');
    g('history-banner').style.display='flex';
    g('history-banner-text').textContent=`📅 Viewing: ${label} (read-only — editing disabled)`;
    showTab('patients', root.querySelector(".tab-btn[data-click*='patients']"));
    render();
  }catch(e){
    alert('Could not load that snapshot.');console.error(e);
  }
}

function exitHistoryView(){
  if(!inHistoryView||!liveStateBackup)return;
  state.patients=liveStateBackup.patients;
  state.units=liveStateBackup.units;
  state.billingDates=liveStateBackup.billingDates;
  liveStateBackup=null;
  inHistoryView=false;
  host.classList.remove('history-mode');
  g('history-banner').style.display='none';
  render();
}

// ── PATIENTS ──
function addPatient(){
  if(!canEdit())return;
  const name=g('in-name').value.trim();
  const phn=g('in-phn').value.trim();
  const unit=g('in-unit').value;
  const room=g('in-room').value.trim();
  const codes=g('in-codes').value.trim();
  const ava=g('in-ava').value.trim();
  const pFlag=g('in-pflag').checked;
  if(!name||!unit){alert('Please enter a name and unit.');return}

  try{applyRoster(TrimRoster.add(currentRoster(),{name,phn,unit,room,codes,ava,pFlag}));}
  catch(e){alert(e.message);return;}
  ['in-name','in-phn','in-room','in-codes','in-ava'].forEach(i=>g(i).value='');
  g('in-pflag').checked=false;
  stageRoster();render();
}
function startEdit(id){editId=id;render();void persist().catch(()=>{});}
function cancelEdit(){editId=null;render();void persist().catch(()=>{});}
function saveEdit(id){
  if(!canEdit())return;
  const p=state.patients.find(x=>x.id===id);if(!p)return;
  try{applyRoster(TrimRoster.edit(currentRoster(),id,{
    name:g(`en-${id}`).value.trim()||p.name,phn:g(`ep-${id}`).value.trim(),unit:g(`eu-${id}`).value,
    room:g(`er-${id}`).value.trim(),codes:g(`ec-${id}`).value.trim(),ava:g(`ea-${id}`).value.trim(),pFlag:g(`epf-${id}`).checked
  }));}catch(e){alert(e.message);return;}
  editId=null;stageRoster();render();
}
function promptDel(id){
  if(!canEdit())return;
  delId=id;const p=state.patients.find(x=>x.id===id);
  g('delmsg').textContent=`Remove "${p?.name}" from the active list today (${TrimRoster.today()})? Their roster record will be retained until ${TrimRoster.expiresOn(TrimRoster.today())} for billing reconciliation. Existing billing is preserved.`;
  g('delmv').classList.add('open');
}
function closeModal(id){g(id).classList.remove('open')}
function confirmDel(){
  if(!canEdit()||!delId)return;
  try{applyRoster(TrimRoster.remove(currentRoster(),delId));}catch(e){alert(e.message);return;}
  closeModal('delmv');delId=null;stageRoster();render();
}

// ── UNITS ──
function addUnit(){
  if(!canEdit())return;
  const name=g('in-un').value.trim().toUpperCase();
  const floor=parseInt(g('in-uf').value)||0;
  if(!name)return;
  state.units.push({id:name.toLowerCase().replace(/\W+/g,'_')+'_'+Date.now(),name,floor});
  g('in-un').value='';g('in-uf').value='';
  stageRoster();renderUMng();populateUSel();
}
function delUnit(id){
  if(!canEdit())return;
  if(state.patients.some(p=>p.unit===id)){alert('Cannot delete a unit with patients.');return}
  state.units=state.units.filter(u=>u.id!==id);stageRoster();renderUMng();populateUSel();
}

// ── CALENDAR ──
function calPrev(){calMonth--;if(calMonth<0){calMonth=11;calYear--}renderCal()}
function calNext(){calMonth++;if(calMonth>11){calMonth=0;calYear++}renderCal()}

function renderCal(){
  g('cal-lbl').textContent=`${MONTHS[calMonth]} ${calYear}`;
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const today=new Date();
  const alreadyKeys=new Set(state.billingDates.map(d=>d.sortKey));

  let html='';
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d=>{html+=`<div class="cal-dh">${d}</div>`});
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-day empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const sk=calYear*10000+(calMonth+1)*100+d;
    const isToday=d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
    const isSelected=alreadyKeys.has(sk);
    const cls=isSelected?'already':isToday?'today':'';
    if(isSelected){
      html+=`<div class="cal-day ${cls}" title="Already added">${d}</div>`;
    }else{
      html+=`<div class="cal-day ${cls}" data-click="calSelectDay(${d})">${d}</div>`;
    }
  }
  g('cal-grid').innerHTML=html;
}

function calSelectDay(day){
  if(state.billingDates.length>=MAX_D){alert(`Maximum ${MAX_D} dates reached.`);return}
  const sk=calYear*10000+(calMonth+1)*100+day;
  if(state.billingDates.some(d=>d.sortKey===sk)){alert('Already added.');return}
  const dow=DAYS[new Date(calYear,calMonth,day).getDay()];
  const label=`${MONTHS_S[calMonth]} ${day}`;
  // Show seen-count modal
  pendingDateKey={sk,label,dow};
  g('seen-title').textContent=`${label} (${dow})`;
  g('seen-subtitle').textContent='Optionally record how many patients you saw in the office this day.';
  g('seen-count').value='';
  g('seen-count').onkeydown=function(e){if(e.key==='Enter')confirmSeen();};
  g('seenmv').classList.add('open');
  setTimeout(()=>g('seen-count').focus(),50);
}

function confirmSeen(){
  if(!canEdit())return;
  if(pendingDateKey && pendingDateKey.editId){
    // Edit mode — update existing
    const d=state.billingDates.find(x=>x.id===pendingDateKey.editId);
    if(d){d.seen=g('seen-count').value.trim()||'';}
    pendingDateKey=null;
    closeModal('seenmv');
    stageRoster();renderDates();
    return;
  }
  if(!pendingDateKey)return;
  const cnt=g('seen-count').value.trim();
  state.billingDates.push({
    id:Date.now().toString(),
    label:pendingDateKey.label,
    dow:pendingDateKey.dow,
    seen:cnt||'',
    sortKey:pendingDateKey.sk
  });
  pendingDateKey=null;
  closeModal('seenmv');
  stageRoster();renderDates();renderCal();
}

function editSeen(id){
  const d=state.billingDates.find(x=>x.id===id);if(!d)return;
  pendingDateKey={editId:id};
  g('seen-title').textContent=`Edit: ${d.label} (${d.dow||''})`;
  g('seen-subtitle').textContent='Update how many patients you saw in the office this day.';
  g('seen-count').value=d.seen||'';
  g('seen-count').onkeydown=function(e){if(e.key==='Enter')confirmSeen();};
  g('seenmv').classList.add('open');
  setTimeout(()=>g('seen-count').focus(),50);
}

function cancelSeen(){
  pendingDateKey=null;
  closeModal('seenmv');
}

function removeDate(id){if(!canEdit())return;state.billingDates=state.billingDates.filter(d=>d.id!==id);stageRoster();renderDates();renderCal()}
function clearDates(){if(!canEdit()||!confirm('Clear all dates?'))return;state.billingDates=[];stageRoster();renderDates();renderCal()}

// ESC key closes any open modal
root.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(g('seenmv').classList.contains('open')) cancelSeen();
    if(g('delmv').classList.contains('open')) closeModal('delmv');
  }
});

// ── RENDER ──
function render(){renderStats();renderUList();populateUSel();renderDates();renderRemoved();renderOtherPatients()}

function renderStats(){
  const t=state.patients.length;
  g('stats').innerHTML=`
    <div class="stat-card"><div class="stat-label">Patients</div><div class="stat-value">${t}</div></div>`;
  g('lbanner').textContent='';
}

function populateUSel(){
  const s=g('in-unit');if(!s)return;
  const cur=s.value;
  s.innerHTML='<option value="">— Select Unit —</option>'+
    state.units.map(u=>`<option value="${esc(u.id)}"${u.id===cur?' selected':''}>${esc(u.name)}</option>`).join('');
}

function renderUList(){
  let html='';
  state.units.forEach(unit=>{
    const pts=state.patients.filter(p=>p.unit===unit.id).sort((a,b)=>(parseInt(a.room)||0)-(parseInt(b.room)||0));
    html+=`<div class="usec">
      <div class="uhdr" data-click="toggleU('${unit.id}')">
        <div class="uhdr-l"><span class="unm">${esc(unit.name)}</span><span class="ucnt">${pts.length} patients</span></div>
        <span class="uchev open" id="chev-${unit.id}">▶</span>
      </div>
      <div id="ub-${unit.id}">
        <table class="ptbl">
          <thead><tr>
            <th>Room</th>
            <th>Name</th>
            <th style="width:130px">PHN</th>
            <th style="width:80px">AVA #</th>
            <th style="width:120px">ICD Codes</th>
            <th style="width:110px">Actions</th>
          </tr></thead>
          <tbody>
            ${pts.length===0?`<tr><td colspan="6" style="color:var(--muted);font-style:italic;text-align:center;padding:14px">No patients</td></tr>`:''}
            ${pts.map(p=>editId===p.id?`
              <tr>
                <td><input class="einp" id="er-${esc(p.id)}" value="${esc(p.room)}" style="width:64px"/></td>
                <td><div class="edit-name-wrap"><input class="einp" id="en-${esc(p.id)}" value="${esc(p.name)}"/><label class="p-toggle"><input id="epf-${esc(p.id)}" type="checkbox"${p.pFlag?' checked':''}/><span>P</span></label></div></td>
                <td>
                  <input class="einp" id="ep-${esc(p.id)}" value="${esc(p.phn||'')}"/>
                  <select class="sel" id="eu-${esc(p.id)}" style="font-size:11px;padding:3px 5px;margin-top:3px">
                    ${state.units.map(u=>`<option value="${esc(u.id)}"${u.id===p.unit?' selected':''}>${esc(u.name)}</option>`).join('')}
                  </select>
                </td>
                <td><input class="einp" id="ea-${esc(p.id)}" value="${esc(p.ava||'')}" placeholder="AVA #"/></td>
                <td><input class="einp" id="ec-${esc(p.id)}" value="${esc(p.codes||'')}"/></td>
                <td><div class="pact"><button class="btn btn-green btn-sm" data-click="saveEdit('${esc(p.id)}')">Save</button><button class="btn btn-ghost btn-sm" data-click="cancelEdit()">Cancel</button></div></td>
              </tr>`:`
              <tr>
                <td><span class="prm">${esc(p.room)||'—'}</span></td>
                <td>
                  <div class="pnm">${avaChartUrl(p)?`<a href="${avaChartUrl(p)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>`:`${esc(p.name)}`}${p.pFlag?'<span class="pflag">P</span>':''}</div>
                  <div class="patient-meta"><span class="pphn">${phnWithCopy(p.phn,'')}</span>${notesUploadControl(p,'patients')}</div>
                </td>
                <td><span class="pphn">${phnWithCopy(p.phn)}</span></td>
                <td><span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(p.ava||'—')}</span></td>
                <td><span class="pcd">${esc(p.codes)||'<span style="color:var(--muted);font-style:italic">—</span>'}</span></td>
                <td><div class="pact"><button class="btn btn-outline btn-sm needs-connect" data-click="startEdit('${esc(p.id)}')">Edit</button><button class="btn btn-danger btn-sm needs-connect" data-click="promptDel('${esc(p.id)}')">✕</button></div></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  });
  g('ulist').innerHTML=html||`<div class="banner b-info">No units. Add them in the Units tab.</div>`;
  refreshNotesUploadControls();
}

// Manual document-upload sign-off only; clinical summaries are maintained by TRIM Notes.
function notesUploadControl(p,collection){
  return `<button type="button" class="notes-upload" data-notes-upload="${esc(p.id)}" data-collection="${collection}" aria-label="Notes uploaded for ${esc(p.name)}" aria-pressed="${p.notesDataUploaded===true}"${canAssignOtherDoctor()?'':' disabled'}><span class="notes-upload-icon" aria-hidden="true"></span><span class="notes-upload-text"></span><span class="notes-upload-dot" aria-hidden="true"></span><span class="notes-upload-save sr-only"></span></button>`;
}
function refreshNotesUploadControls(){
  const saved=loadedRosterJSON?JSON.parse(loadedRosterJSON):{};
  root.querySelectorAll('[data-notes-upload]').forEach(el=>{
    const collection=el.dataset.collection;
    const p=(collection==='patients'?state.patients:otherPatients()).find(p=>String(p.id)===el.dataset.notesUpload);
    if(!p)return;
    const previous=(saved[collection]||[]).find(x=>String(x.id)===String(p.id));
    const changed=!inHistoryView&&((p.notesDataUploaded===true)!==(previous?.notesDataUploaded===true)||(p.notesDataUploadedAt||null)!==(previous?.notesDataUploadedAt||null));
    const uploaded=p.notesDataUploaded===true;
    el.setAttribute('aria-pressed',String(uploaded));
    el.setAttribute('aria-description','Manual document-upload sign-off.'+(changed?' Status change not yet saved to Drive.':''));
    el.dataset.dirty=String(changed);
    el.disabled=!canAssignOtherDoctor();
    el.querySelector('.notes-upload-text').textContent=uploaded?'Notes uploaded':'';
    el.querySelector('.notes-upload-icon').innerHTML=uploaded?'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m4 10 4 4 8-9"/></svg>':'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="14" height="14" rx="2"/></svg>';
    el.querySelector('.notes-upload-save').textContent=changed?'Status change not yet saved to Drive.':'';
    el.title=(uploaded?'TRIM Notes documents marked uploaded'+(p.notesDataUploadedAt?' on '+new Date(p.notesDataUploadedAt).toLocaleString():'')+'. Click to clear.':'Click to mark uploaded after adding this patient’s documents to Incoming.')+(changed?' Status change not yet saved to Drive.':'');
    el.onclick=()=>setNotesUploaded(collection,el.dataset.notesUpload,!uploaded);
  });
  for(const [id,patients] of [['notes-upload-count',state.patients],['other-notes-upload-count',otherPatients()]]){
    const el=g(id);if(el)el.textContent=`TRIM Notes: ${patients.filter(p=>p.notesDataUploaded===true).length} of ${patients.length} uploaded.`;
  }
}
async function setNotesUploaded(collection,id,uploaded){
  if(!['patients','otherPatients'].includes(collection)||!canAssignOtherDoctor()||!canEdit()){refreshNotesUploadControls();return;}
  const roster=currentRoster(),patients=roster[collection]||[],matches=patients.filter(p=>String(p.id)===String(id));
  if(matches.length!==1){alert('Patient could not be uniquely identified. Reload the list.');refreshNotesUploadControls();return;}
  if((matches[0].notesDataUploaded===true)===uploaded)return;
  applyRoster({...roster,[collection]:patients.map(p=>p===matches[0]?{...p,notesDataUploaded:uploaded,notesDataUploadedAt:uploaded?new Date().toISOString():null}:p)});
  await stageRoster();refreshNotesUploadControls();
}

function toggleU(id){
  const b=g('ub-'+id),c=g('chev-'+id);
  const h=b.style.display==='none';b.style.display=h?'':'none';c.classList.toggle('open',h);
}

function otherPatients(){return Array.isArray(rosterDocument?.otherPatients)?rosterDocument.otherPatients:[];}
function canAssignOtherDoctor(){return ready&&!inHistoryView&&!writeBlocked&&!pendingSaves&&!saving&&!refreshing;}
function doctorOptions(selected='',filter=false){
  const saved=[...new Set(otherPatients().map(p=>p.doctor).filter(Boolean))];
  const known=OTHER_DOCTORS.map(d=>d.name);
  return OTHER_DOCTORS.map(d=>`<option value="${esc(d.name)}"${d.name===selected?' selected':''}>${esc(d.name)}${d.status?' · '+esc(d.status):''}</option>`).join('')+
    saved.filter(n=>!known.includes(n)).map(n=>`<option value="${esc(n)}"${n===selected?' selected':''}${filter?'':' disabled'}>${esc(n)} (previously recorded)</option>`).join('');
}
async function setOtherDoctor(id,value){
  if(!canAssignOtherDoctor()||!canEdit()){renderOtherPatients();return;}
  if(value&&!OTHER_DOCTORS.some(d=>d.name===value)){alert('Choose a doctor from the list.');renderOtherPatients();return;}
  const matches=otherPatients().filter(p=>String(p.id)===String(id));
  if(matches.length!==1){alert('Patient could not be uniquely identified. Reload the list.');return;}
  if((matches[0].doctor||'')===value)return;
  applyRoster({...currentRoster(),otherPatients:otherPatients().map(p=>p===matches[0]?{...p,doctor:value}:p)});
  await stageRoster();renderOtherPatients();
}
function renderOtherPatients(){
  const list=g('other-list'),stats=g('other-stats'),filter=g('other-doctor-filter');
  if(!list)return;
  if(!ready){stats.innerHTML='';list.innerHTML='<div class="banner b-info">Connect Google Drive to load other patients.</div>';return;}
  if(inHistoryView){stats.innerHTML='';list.innerHTML='<div class="banner b-info">Return to Today (Live) to see other patients.</div>';return;}
  const all=otherPatients(),assigned=all.filter(p=>p.doctor).length;
  stats.innerHTML=[['Other patients',all.length],['Doctor assigned',assigned],['Unassigned',all.length-assigned]].map(([label,n])=>`<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${n}</div></div>`).join('');
  const selectedDoctor=filter.value;
  filter.innerHTML='<option value="">All doctors</option><option value="__unassigned">Unassigned</option>'+doctorOptions(selectedDoctor,true);
  filter.value=selectedDoctor;
  const query=g('other-search').value.trim().toLowerCase(),digits=query.replace(/\D/g,'');
  const pts=all.filter(p=>(!query||p.name.toLowerCase().includes(query)||(digits&&[p.phn,p.ava].some(v=>String(v||'').replace(/\D/g,'').includes(digits))))&&(!selectedDoctor||(selectedDoctor==='__unassigned'?!p.doctor:p.doctor===selectedDoctor)));
  const known=new Set(state.units.map(u=>u.id)),groups=[...state.units,{id:'__unknown',name:'Unit not recorded'}];
  list.innerHTML=groups.map((unit,index)=>{
    const rows=pts.filter(p=>unit.id==='__unknown'?!known.has(p.unit):p.unit===unit.id).sort((a,b)=>(a.room||'').localeCompare(b.room||'',undefined,{numeric:true})||a.name.localeCompare(b.name));
    if(!rows.length)return '';
    const key='other-'+index;
    return `<div class="usec"><div class="uhdr" data-click="toggleU('${key}')"><div class="uhdr-l"><span class="unm">${esc(unit.name)}</span><span class="ucnt">${rows.length} patients</span></div><span class="uchev open" id="chev-${key}">▶</span></div><div id="ub-${key}" style="overflow-x:auto"><table class="ptbl"><thead><tr><th>Room</th><th>Name</th><th style="width:160px">PHN</th><th style="width:100px">AVA #</th><th style="width:260px">Doctor</th></tr></thead><tbody>${rows.map(p=>{
      const ava=String(p.ava||'');const url=avaChartUrl(p);
      return `<tr><td><span class="prm">${esc(p.room)||'—'}</span></td><td><div class="pnm">${url?`<a href="${url}" target="_blank" rel="noopener">${esc(p.name)}</a>`:esc(p.name)}</div><div class="patient-meta"><span class="pphn">${phnWithCopy(p.phn,'')}</span>${notesUploadControl(p,'otherPatients')}</div></td><td><span class="pphn">${phnWithCopy(p.phn)}</span></td><td>${url?`<a href="${url}" target="_blank" rel="noopener" style="font-family:var(--mono);font-size:11px">${esc(ava)}</a>`:'—'}</td><td><select class="sel" data-other-doctor="${esc(p.id)}" aria-label="Doctor for ${esc(p.name)}" ${canAssignOtherDoctor()?'':'disabled'}><option value=""${!p.doctor?' selected':''}>Unassigned</option>${doctorOptions(p.doctor||'')}</select></td></tr>`;
    }).join('')}</tbody></table></div></div>`;
  }).join('')||'<div class="banner b-info">'+(all.length?'No patients match these filters.':'No other patients in the roster.')+'</div>';
  list.querySelectorAll('[data-other-doctor]').forEach(el=>el.addEventListener('change',()=>setOtherDoctor(el.dataset.otherDoctor,el.value)));
  refreshNotesUploadControls();
}

function renderUMng(){
  g('umng').innerHTML=state.units.map(u=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light)">
      <span style="flex:1;font-weight:500">${esc(u.name)}</span>
      <span style="font-size:11px;color:var(--muted)">Floor ${u.floor||'?'}</span>
      <span style="font-size:11px;color:var(--muted)">${state.patients.filter(p=>p.unit===u.id).length} patients</span>
      <button class="btn btn-danger btn-sm needs-connect" data-click="delUnit('${esc(u.id)}')">Delete</button>
    </div>`).join('')||'<p style="color:var(--muted);font-size:13px">No units.</p>';
}

function renderDates(){
  const sorted=[...state.billingDates].sort((a,b)=>a.sortKey-b.sortKey);
  const el=g('dlist');if(!el)return;
  if(sorted.length===0){
    el.innerHTML=`<p style="color:var(--muted);font-size:13px;font-style:italic;margin-top:8px">No dates yet. Click a date on the calendar above to add it.</p>`;
    return;
  }
  el.innerHTML=`
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;font-family:var(--mono);margin-top:4px">${sorted.length} / ${MAX_D} SLOTS USED</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${sorted.map(d=>`
        <div class="dchip">
          <div class="dchip-info">
            <span class="dchip-date">${esc(d.label)}</span>
            <span class="dchip-dow">${esc(d.dow||'')}</span>
            ${d.seen?`<span class="dchip-seen">(${esc(d.seen)})</span>`:'<span class="dchip-seen" style="color:var(--muted);font-style:italic;font-family:var(--sans)">no count</span>'}
          </div>
          <button class="dchip-edit needs-connect" data-click="editSeen('${d.id}')" title="Edit patients seen">✏</button>
          <button class="dchip-del needs-connect" data-click="removeDate('${d.id}')" title="Remove">×</button>
        </div>`).join('')}
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn btn-ghost btn-sm needs-connect" data-click="clearDates()">Clear All Dates</button>
    </div>
    ${sorted.length>=MAX_D?`<div class="banner b-warn" style="margin-top:12px">⚠ All ${MAX_D} slots filled.</div>`:''}`;
}

// ── BUILD TRIM LIST ──
function buildTrimList(){
  // Preserve the familiar unit grouping, adding pages for larger rosters.
  const groups=[...LIST_PAGES,state.units.filter(u=>!LIST_PAGES.flat().includes(u.id)).map(u=>u.id)];
  const known=new Set(groups.flat());
  groups.push([...new Set(state.patients.filter(p=>!known.has(p.unit)).map(p=>p.unit))]);
  const pages=groups.flatMap(ids=>rosterPrintPages(
    ids.map(id=>state.units.find(u=>u.id===id)||{id,name:id||'OTHER'}),
    state.patients.filter(p=>ids.includes(p.unit)),55));
  let html='';
  pages.forEach(groups=>{
    const fp=8,rp=16,nmW=152;
    let rows='';
    groups.forEach(({unit,patients:pts,continued})=>{
      // Unit header with unit name + room indicator
      rows+=`<div class="t-uhdr" style="font-size:${fp+0.5}px"><span>${esc(unit.name)}${continued?' (continued)':''}</span></div>`;
      pts.forEach(p=>{
        // Single line: LastName, FirstName  PHN  RoomNumber
        const parts=[esc(p.name),p.phn?esc(p.phn):'',p.room?esc(p.room):''].filter(Boolean);
        const nameLine=parts.join('  ');
        rows+=`<div class="t-row" style="min-height:${rp}px;background:#fff !important">
          <div class="t-nm" style="font-size:${fp}px;width:${nmW}px;flex:0 0 ${nmW}px">${nameLine}</div>
          <div class="t-bill" style="font-size:${fp}px">
            <span>114</span><span>115</span><span>127</span><span>200</span>
            <span class="sep">13334</span><span class="sep">14077</span>
            <span>x</span><span>1</span><span class="sep">2</span>
            <span>start:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span>end:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <span>R:</span>
          </div>
          <div class="t-icd" style="font-size:${fp}px">${esc(p.codes||'')}</div>
        </div>`;
      });
    });
    html+=`<div class="tpage">
      <div class="t-datehdr"><span>TRIM Date:</span><span class="t-dateline"></span></div>
      ${rows}
    </div>`;
  });
  g('print-trim').innerHTML=html||'<p>No patients.</p>';
}

// ── BUILD TRIM BILLING ──
function buildTrimBilling(){
  const sorted=[...state.billingDates].sort((a,b)=>a.sortKey-b.sortKey);
  const cols=Array.from({length:MAX_D},(_,i)=>sorted[i]||null);
  const pages=rosterPrintPages(state.units,state.patients,38);

  // Usable page height ~9.7in at 96dpi = ~931px, minus header row (~36px)
  const PAGE_USABLE_PX=895;
  const MIN_ROW=16, MAX_ROW=34;

  let html='';
  pages.forEach(groups=>{
    const hdr=cols.map(d=>{
      if(!d)return`<th class="bdh empty"></th>`;
      return`<th class="bdh">
        <span class="bdh-date">${esc(d.label)}</span>
        <span class="bdh-dow">${esc(d.dow||'')}</span>
        ${d.seen?`<span class="bdh-seen">(${esc(d.seen)})</span>`:'<span class="bdh-seen">&nbsp;</span>'}
      </th>`;
    }).join('');

    // Count rows on this page first (patient rows + unit header rows)
    const rowCount=groups.reduce((n,g)=>n+1+g.patients.length,0);
    const rowPx=rowCount>0?Math.max(MIN_ROW,Math.min(MAX_ROW,Math.floor(PAGE_USABLE_PX/rowCount))):MIN_ROW;
    const fontPx=Math.max(6.5,Math.min(10,Math.floor(rowPx*0.42)));

    let body='';
    groups.forEach(({unit,patients:pts,continued})=>{
      body+=`<tr class="buh" style="height:${rowPx}px"><td colspan="${MAX_D+1}" style="font-size:${fontPx}px">${esc(unit.name)}${continued?' (continued)':''}</td></tr>`;
      pts.forEach(p=>{
        // Billing: name + room only (no PHN)
        const nameWithFlag=`${esc(p.name)}${p.pFlag?'<span class="b-pflag">P</span>':''}`;
        const lbl=p.room?`${nameWithFlag}  ${esc(p.room)}`:nameWithFlag;
        body+=`<tr style="height:${rowPx}px"><td class="bpn" style="--bf:${fontPx}px">${lbl}</td>${cols.map(()=>`<td class="bc"></td>`).join('')}</tr>`;
      });
    });

    html+=`<div class="bpage">
      <table class="btbl">
        <thead><tr><th class="bnh">Patient</th>${hdr}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  });
  g('print-billing').innerHTML=html||'<p>No patients.</p>';
}

// ── PRINT ──
function todayStr(){
  const d=new Date();
  const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const yr=d.getFullYear();
  const mon=months[d.getMonth()];
  const day=String(d.getDate()).padStart(2,'0');
  return`${yr}-${mon}-${day}`;
}
function printTrim(){buildTrimList();showPrint('TRIM List '+todayStr(),g('print-trim').innerHTML,false);}
function printBilling(){buildTrimBilling();showPrint('TRIM Billing '+todayStr(),g('print-billing').innerHTML,true);}

// ── UTILS ──
function phnWithCopy(phn,empty='—'){
  const value=String(phn||'').replace(/\D/g,'');
  if(!value)return esc(empty);
  return `<span class="phn-value">${esc(phn)}<button type="button" class="phn-copy" data-phn="${value}" data-click="copyPhn(this)" title="Copy PHN" aria-label="Copy PHN"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg></button><span class="phn-copy-feedback" role="status"></span></span>`;
}
async function copyPhn(button){
  const feedback=button.nextElementSibling;
  clearTimeout(button.copyResetTimer);
  button.disabled=true;
  try{
    await navigator.clipboard.writeText(button.dataset.phn);
    feedback.textContent='Copied';
    button.copyResetTimer=setTimeout(()=>{feedback.textContent='';},1500);
  }catch(e){
    feedback.textContent='';
    alert('Your browser could not copy the PHN. Select the number and copy it manually.');
  }finally{button.disabled=false;}
}
function g(id){return root.getElementById(id)}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}


renderCal();render();return api;
}
