import {patientFieldEditor} from './patient-field-controls.mjs?v=20261127-menus2';
import {handset,phoneControls,bindRosterTips} from './roster-phone.mjs?v=20261127-menus2';
import {oatPhoneControls,moreIcon,phoneAddIcon} from './oat-row-controls.mjs?v=20261127-menus2';
import {bindIdentity} from './patient-identity.mjs?v=20261119-most-connection1';
import {assessmentPlanningText} from './maid-assessment.mjs?v=20261112-provision1';
import {dateCalendar} from './maid-date-calendar.mjs';
import {provisionDefaults,provisionPlanningText,provisionMapUrl} from './maid-provision.mjs';
import {avaChartUrl} from './patient-links.mjs';
import {contactGroups,contactRole,phoneLink,appContacts} from './clinic-contacts.mjs?v=20261108-closeout1';
import {maidAppPatients,isProvisionPending,patientLocation,closeoutOutstanding} from './maid-lifecycle.mjs';
import {oatPatientMessages} from './oat-patient-message.mjs?v=20261127-oat-actions1';
import {oatStatusAction,oatStatusVersion,oatStatusDate,oatPatientMatches} from './oat-patient-status.mjs?v=20261127-oat-identity1';
import {formatDate} from './dates.mjs?v=20261119-export1';

// No patient data is persisted in browser storage; each action verifies its saved revision.
export function clinicRosterUI({host,kind,title=kind==='maid'?'MAID':'OAT FH',onAction,onPhone,onAva,onStatus,onPatientView,dialogHost=host,onReload,onLink,onChange=()=>{}}) {
  const maid=kind==='maid',fh=kind==='oat-fh';
  let patients=[],view='active',query='',busy=false,ready=false,loaded=false,loadState='idle',loadMessage='';
  host.classList.add('clinic-workspace');
  host.innerHTML=`<div class="clinic-heading"><div><h1>${title}</h1><p>${maid?'Current patients and assessment history.':'Your clinic list, in the order you provide.'}</p></div><span class="clinic-count" role="status" aria-live="polite"></span></div>
    <div class="clinic-toolbar">${maid?'<nav class="clinic-filters" aria-label="MAID patient status"><button data-view="active" aria-pressed="true">Active</button><button data-view="history" aria-pressed="false">History</button><button data-view="all" aria-pressed="false">All</button></nav>':''}<input type="search" aria-label="Search ${title}" placeholder="${maid?'Search name, PHN or location':'Search name, PHN or Ava number'}" autocomplete="off"></div>
    <p class="clinic-load-status" role="status" aria-live="polite" hidden></p>
    <div class="clinic-table-wrap" role="region" aria-label="${title} patient list" tabindex="0"><table class="clinic-table"><caption class="sr-only">${title} patients</caption><thead><tr><th scope="col">#</th><th scope="col">Patient</th><th scope="col">PHN</th><th scope="col">Patient phone</th>${maid?'<th scope="col">Primary / family contact</th>':''}${maid?'<th scope="col">Location</th>':''}${maid?'<th scope="col" class="clinic-planning-heading">Assessment</th><th scope="col">Provision</th><th scope="col">1645</th><th scope="col">Details / actions</th>':''}</tr></thead><tbody></tbody></table></div>
    <div class="clinic-empty"><h2>Waiting for your patient list</h2><p>${maid?'Your current patients will start in Active.':'Your patients will appear here in the supplied clinic order.'} Names will open Ava, with Copy PHN beside them.</p></div><p class="clinic-feedback" role="status" aria-live="polite"></p>`;
  bindIdentity(host);
  if(!maid){
    const dateHeading=document.createElement('th'),heading=document.createElement('th');dateHeading.scope=heading.scope='col';dateHeading.className='oat-status-date-heading';
    heading.className='clinic-actions-heading';heading.innerHTML='<span class="sr-only">Actions</span>';host.querySelector('thead tr').append(dateHeading,heading);host.classList.add('oat-patient-panel');
  }
  const messages=fh?oatPatientMessages(host,onChange):null;
  const hideTip = bindRosterTips(host);
  if(onReload){const reload=document.createElement('button');reload.textContent='Reload '+title;reload.className='clinic-reload';reload.onclick=()=>{if(!busy)void onReload();};host.querySelector('.clinic-toolbar').append(reload);}
  const linkButton=document.createElement('button');
  if(onLink){
    linkButton.hidden=true;
    linkButton.textContent='Link MAID roster to TRIM';
    host.querySelector('.clinic-toolbar').append(linkButton);
    linkButton.onclick=async()=>{
      linkButton.disabled=true;
      try{await onLink();}
      catch(error){loadMessage=error.message;render();}
      finally{linkButton.disabled=false;}
    };
  }
  const dialog=document.createElement('dialog');dialog.className='clinic-remove-dialog';dialog.innerHTML='<form method="dialog"><h2>Remove patient from MAID?</h2><p class="remove-name"></p><p>This deletes all of their tracking information from Active and History. Their original documents and folders stay in place.</p><div class="actions"><button value="cancel">Cancel</button><button value="remove" class="danger">Remove patient</button></div></form>';if(maid)host.append(dialog);
  const planningDialog=document.createElement('dialog');planningDialog.className='clinic-planning-dialog';
  planningDialog.innerHTML='<form><h2>1634 assessment planning</h2><p class="planning-name"></p><input name="date" type="hidden"><section class="planning-calendar" aria-label="Assessment date calendar"><div class="planning-calendar-nav"><button type="button" data-month="-1" aria-label="Previous month">‹</button><h3 aria-live="polite"></h3><button type="button" data-month="1" aria-label="Next month">›</button></div><div class="planning-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="planning-days"></div><button type="button" data-today>Current month</button><p class="planning-selected" aria-live="polite"></p></section><label>Request urgency<select name="urgency" aria-label="Request urgency"><option value="unknown">Not specified</option><option value="routine">Routine / non-urgent</option><option value="semi-urgent">Semi-urgent</option><option value="urgent">Urgent</option></select></label><p class="planning-error" role="alert"></p><div class="actions"><button type="button" data-cancel>Cancel</button><button type="button" data-clear>Clear date</button><button type="submit">Save planning</button></div></form>';
  if(maid)host.append(planningDialog);
  const planningForm=planningDialog.querySelector('form'),dateInput=planningForm.elements.namedItem('date'),urgencyInput=planningForm.elements.namedItem('urgency');
  const calendar=dateCalendar(planningDialog,dateInput);
  planningDialog.querySelector('[data-cancel]').onclick=()=>planningDialog.close();
  planningDialog.querySelector('[data-clear]').onclick=()=>{dateInput.value='';calendar.render();};
  planningDialog.addEventListener('close',()=>{render();onChange();});
  function editPlanning(p){
    if(busy||!ready||planningDialog.open)return;
    dateInput.value=p.assessmentSchedule?.date||'';calendar.reset();urgencyInput.value=p.assessmentUrgency?.level||'unknown';
    planningDialog.querySelector('.planning-name').textContent=p.name;planningDialog.querySelector('.planning-error').textContent='';
    planningForm.onsubmit=async event=>{
      event.preventDefault();
      const action={type:'assessment-planning',patientId:p.id};
      if(dateInput.value!==(p.assessmentSchedule?.date||''))action.schedule={date:dateInput.value||null,time:null,source:'Physician edit in MAID app'};
      if(urgencyInput.value!==(p.assessmentUrgency?.level||'unknown'))action.urgency={level:urgencyInput.value,source:'Physician edit in MAID app'};
      planningDialog.close();if(action.schedule||action.urgency)await act(action);
    };
    planningDialog.showModal();render();onChange();
  }
  const provisionDialog=document.createElement('dialog');provisionDialog.className='clinic-planning-dialog clinic-provision-dialog';provisionDialog.setAttribute('aria-label','Schedule provision');
  provisionDialog.innerHTML='<form><h2>Schedule provision</h2><p class="planning-name"></p><input name="date" type="hidden"><section class="planning-calendar" aria-label="Provision date calendar"><div class="planning-calendar-nav"><button type="button" data-month="-1" aria-label="Previous month">‹</button><h3 aria-live="polite"></h3><button type="button" data-month="1" aria-label="Next month">›</button></div><div class="planning-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="planning-days"></div><button type="button" data-today>Current month</button><p class="planning-selected" aria-live="polite"></p></section><label>Start time (Pacific)<input name="time" type="time" required></label><label>Venue<input name="location" type="text" placeholder="Home, hospice or facility" required></label><label>Full address<textarea name="address" rows="2" required></textarea></label><p class="planning-help">Confirm the procedure venue and address. Saving updates the patient list; calendar events are managed separately.</p><p class="planning-error" role="alert"></p><div class="actions"><button type="button" data-dismiss>Cancel</button><button type="button" data-cancel-booking>Cancel appointment</button><button type="submit">Save provision</button></div></form>';
  if(maid)host.append(provisionDialog);
  const provisionForm=provisionDialog.querySelector('form'),provisionInputs=Object.fromEntries(['date','time','location','address'].map(key=>[key,provisionForm.elements.namedItem(key)]));
  const provisionCalendar=dateCalendar(provisionDialog,provisionInputs.date);
  provisionDialog.querySelector('[data-dismiss]').onclick=()=>provisionDialog.close();
  provisionDialog.addEventListener('close',()=>{render();onChange();});
  function editProvision(p){
    if(busy||!ready||provisionDialog.open||isProvisionPending(p))return;
    const defaults=provisionDefaults(p);for(const key of Object.keys(provisionInputs))provisionInputs[key].value=defaults[key];
    provisionCalendar.reset();provisionDialog.querySelector('.planning-name').textContent=p.name;provisionDialog.querySelector('.planning-error').textContent='';
    const cancel=provisionDialog.querySelector('[data-cancel-booking]');cancel.hidden=!p.plannedProvision?.date||p.plannedProvision.status==='cancelled';
    cancel.onclick=async()=>{provisionDialog.close();await act({type:'provision-planning',patientId:p.id,cancel:true,source:'Physician cancelled appointment in MAID app'});};
    provisionForm.onsubmit=async event=>{
      event.preventDefault();
      if(!provisionInputs.date.value){provisionDialog.querySelector('.planning-error').textContent='Choose the provision date on the calendar.';return;}
      if(!provisionInputs.location.value.trim()||!provisionInputs.address.value.trim()){provisionDialog.querySelector('.planning-error').textContent='Enter the procedure venue and full address.';return;}
      const schedule=Object.fromEntries(Object.entries(provisionInputs).map(([key,input])=>[key,input.value.trim()]));schedule.source='Physician confirmed appointment in MAID app';
      provisionDialog.close();await act({type:'provision-planning',patientId:p.id,schedule});
    };
    provisionDialog.showModal();render();onChange();
  }
  function renderProvision(row,p){
    const td=cell(row,'');td.className='clinic-provision-planning';const summary=provisionPlanningText(p),label=document.createElement('span');label.textContent=summary.label;td.append(label);
    if(p.plannedProvision?.source)label.title=p.plannedProvision.source;
    if(!p.provisionDate&&p.plannedProvision?.status!=='cancelled'){
      const venue=p.plannedProvision?.location||p.plannedProvision?.venue;if(venue){const name=document.createElement('small');name.textContent=venue;td.append(name);}
      const address=p.plannedProvision?.address,url=provisionMapUrl(address);if(url){const link=document.createElement('a');link.className='clinic-provision-address';link.textContent=address+' ↗';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.title='Open address in Google Maps';td.append(link);}
      if(summary.incomplete){const missing=document.createElement('small');missing.textContent='Confirm missing booking details';td.append(missing);}
      if(summary.past){const past=document.createElement('small');past.className='clinic-planning-overdue';past.textContent='Past date — confirm outcome';td.append(past);}
    }
    if(onAction&&!isProvisionPending(p)){const edit=document.createElement('button');edit.type='button';edit.className='clinic-provision-edit';edit.textContent='Edit';edit.setAttribute('aria-label',`Edit provision for ${p.name}`);edit.disabled=busy||!ready;edit.onclick=()=>editProvision(p);td.append(edit);}
  }
  async function act(action){
    if(busy||!ready||!onAction)return;busy=true;onChange();render();
    let message='';
    try{const result=await onAction(action);patients=structuredClone(result.patients);message=action.type==='remove'?'Patient removed.':action.type==='assessment-planning'?'Assessment planning saved.':action.type==='provision-planning'?(action.cancel?'Provision cancelled.':'Provision scheduled.'):'Patient status saved.';if(result.local)message+=' Saved to the laptop Drive folder; cloud sync is unverified.';}
    catch(error){patients=[];ready=false;loaded=false;loadState='error';loadMessage=error.message+' Reload MAID to check the saved list before continuing.';message=loadMessage;}
    finally{busy=false;render();feedback.textContent=message;onChange();}
  }
  async function confirmRemove(patient){
    if(busy||dialog.open)return;dialog.querySelector('.remove-name').textContent=patient.name;dialog.returnValue='';
    const answer=new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));dialog.showModal();
    if(await answer==='remove')await act({type:'remove',patientId:patient.id});
  }
  const count=host.querySelector('.clinic-count'),body=host.querySelector('tbody'),empty=host.querySelector('.clinic-empty'),feedback=host.querySelector('.clinic-feedback');
  const cell=(row,value)=>{const td=document.createElement('td');td.textContent=value??'Not recorded';row.append(td);return td;};
  function contactSource(contact){
    const card=document.createElement('div');card.className='clinic-contact';
    const role=contactRole(contact).replace(/\s+on\s+1632\b/gi,'').trim();
    const phone=phoneLink(contact.phone,contact.extension),number=document.createElement(phone?'a':'span');number.className='clinic-phone';number.textContent=contact.phone||'Phone not recorded';
    if(phone){number.href=phone.href;number.title=`Call in your phone app (ZAC on this PC)${phone.extension?`; enter extension ${phone.extension} after connection`:''}`;number.setAttribute('aria-label',`Call ${contact.name||role||'contact'} at ${contact.phone}${phone.extension?`, extension ${phone.extension}`:''}`);}
    card.append(number);
    if(contact.extension){const ext=document.createElement('small');ext.textContent=`Extension ${contact.extension}`;card.append(ext);}
    {const name=document.createElement('strong');name.textContent=contact.name||'Name not recorded';card.append(name);}
    if(role){const label=document.createElement('small');label.textContent=role;card.append(label);}
    if(contact.primary===true){const primary=document.createElement('small');primary.textContent='Primary contact';card.append(primary);}
    const location=[contact.facility,contact.unit].filter(Boolean).join(' · ');if(location){const label=document.createElement('small');label.textContent=location;card.append(label);}
    const provenance=[contact.source,contact.sourceDate&&`Source date: ${contact.sourceDate}`,contact.verifiedDate&&`Verified: ${contact.verifiedDate}`].filter(Boolean).join(' · ');
    if(provenance)card.title=provenance;
    for(const text of [contact.email,provenance,contact.note])if(text){const line=document.createElement('small');line.textContent=text;card.append(line);}
    return card;
  }
  const phoneMenu=document.createElement('div');
  if(onPhone||onAva||onStatus){phoneMenu.popover='auto';phoneMenu.className='clinic-phone-menu';dialogHost.append(phoneMenu);}
  async function saveField(action,callback){
    if(!ready||busy)throw new Error('Wait until this patient list is ready.');
    busy=true;onChange();
    try{const saved=await callback(action);patients=structuredClone(saved.roster.patients);return saved;}
    finally{busy=false;onChange();}
  }
  let fieldMessage='';
  const fieldChanged=()=>{if(!phoneEditor.open&&!avaEditor.open){render();feedback.textContent=fieldMessage;}onChange();};
  const phoneEditor=patientFieldEditor(dialogHost,{kind:'phone',className:'clinic-remove-dialog',onChange:fieldChanged,onSave:async(patient,fields)=>{
    const saved=await saveField({type:'patient-phone',patientId:patient.id,expectedPhone:patient.phone||'',phone:fields.phone},onPhone);
    fieldMessage=saved.local?'Phone saved to laptop folder · cloud sync unverified.':'Phone saved.';
  }});
  const avaEditor=patientFieldEditor(dialogHost,{kind:'ava',className:'clinic-planning-dialog clinic-ava-dialog',onChange:fieldChanged,duplicateAva:(patient,value)=>patients.some(p=>p.id!==patient.id&&String(p.ava||'')===value),onSave:async(patient,fields)=>{
    const saved=await saveField({type:'patient-ava',clinic:kind,patientId:patient.id,expectedPhn:patient.phn||'',expectedAva:String(patient.ava||''),expectedAvaHistory:JSON.stringify(patient.avaHistory||[]),ava:fields.ava},onAva);
    fieldMessage=saved.local?'Ava EMR number saved to laptop folder · cloud sync unverified.':'Ava EMR number saved.';
  }});
  const phoneDialog=phoneEditor.dialog,avaDialog=avaEditor.dialog;
  function openPhone(patient){if(onPhone&&ready&&!busy&&!avaEditor.open){fieldMessage='';phoneEditor.show(patient);}}
  function openAva(patient){if(onAva&&ready&&!busy&&!phoneEditor.open){fieldMessage='';avaEditor.show(patient);}}
  let lastStatusChange=null;
  const notice=document.createElement('div');notice.className='oat-status-notice';notice.hidden=true;
  notice.innerHTML='<span role="status" aria-live="polite"></span><button type="button" data-status-view></button><button type="button" data-status-undo>Undo</button><button type="button" data-status-dismiss aria-label="Dismiss status notification">×</button>';
  if(!maid)host.append(notice);
  notice.querySelector('[data-status-dismiss]').onclick=()=>{lastStatusChange=null;notice.hidden=true;};
  function statusNotice(){
    const undo=notice.querySelector('[data-status-undo]');
    if(lastStatusChange){
      const current=patients.find(p=>p.id===lastStatusChange.patientId);
      if(!current||oatStatusVersion(current)!==lastStatusChange.version){lastStatusChange=null;notice.hidden=true;}
    }
    undo.disabled=busy||!ready||!lastStatusChange;
  }
  async function changeStatus(patient,status,options={}){
    if(busy||!ready||!onStatus)return;
    const action=oatStatusAction(patient,kind,status,options);
    busy=true;onChange();render();
    try{
      const saved=await onStatus(action),next=saved.roster.patients.find(p=>p.id===patient.id);
      patients=structuredClone(saved.roster.patients);
      lastStatusChange=options.undoOf?null:{patientId:patient.id,from:patient.status,id:action.id,version:oatStatusVersion(next)};
      const text=options.undoOf?'Status change undone.':options.review==='keep'?patient.name+' kept '+(status==='active'?'active.':'in history.'):patient.name+(status==='active'?' reactivated.':' moved to history.');
      notice.querySelector('[role=status]').textContent=text+(saved.local?' Saved to laptop folder · cloud sync unverified.':'');
      const viewButton=notice.querySelector('[data-status-view]');viewButton.textContent=status==='active'?'View active':'View history';viewButton.onclick=()=>onPatientView?.(status);
      const undo=notice.querySelector('[data-status-undo]');undo.hidden=!lastStatusChange;
      undo.onclick=()=>{const current=patients.find(p=>p.id===lastStatusChange?.patientId);if(current)void changeStatus(current,lastStatusChange.from,{undoOf:lastStatusChange.id});};
      notice.hidden=false;
    }catch(error){ready=false;loadState='error';loadMessage=error.message+' Status change was not confirmed. Reload '+title+' before continuing.';notice.hidden=true;}
    finally{busy=false;render();if(!notice.hidden)(lastStatusChange?notice.querySelector('[data-status-undo]'):notice.querySelector('[data-status-view]')).focus();onChange();}
  }
  function openPatientMenu(patient,button,{status=true}={}){
    if(busy||!ready)return;
    (status?host:dialogHost).append(phoneMenu);
    phoneMenu.replaceChildren();
    const item=(text,action,icon)=>{const b=document.createElement('button');b.type='button';if(icon){const symbol=document.createElement('span');symbol.className='clinic-menu-icon';symbol.innerHTML=icon;b.append(symbol);}b.append(document.createTextNode(text));b.onclick=()=>{phoneMenu.hidePopover();action();};phoneMenu.append(b);};
    if(onPhone)item(patient.phone?'Edit phone…':'Add phone…',()=>openPhone(patient),patient.phone?handset:phoneAddIcon);
    if(onAva)item((patient.ava?'Edit':'Add')+' Ava EMR number',()=>openAva(patient),'<img src="'+new URL('./ava-logo.ico',import.meta.url).href+'" alt="" class="clinic-ava-logo">');
    if(onStatus&&status){
      item(patient.status==='active'?'Move to history':'Reactivate',()=>void changeStatus(patient,patient.status==='active'?'history':'active'));
      if(patient.statusReview){
        item('Keep current status',()=>void changeStatus(patient,patient.status,{review:'keep'}));
        item('Use imported status: '+patient.statusReview.panelStatus,()=>void changeStatus(patient,patient.statusReview.panelStatus,{review:'panel'}));
      }
    }
    phoneMenu.showPopover();const box=button.getBoundingClientRect();
    phoneMenu.style.left=Math.max(4,Math.min(box.left,innerWidth-phoneMenu.offsetWidth-4))+'px';
    phoneMenu.style.top=(box.bottom+phoneMenu.offsetHeight+4<innerHeight?box.bottom+3:Math.max(4,box.top-phoneMenu.offsetHeight-3))+'px';
    phoneMenu.querySelector('button').focus();
  }
  function compactContact(contact,fallback) {
    const wrapper=document.createElement('div');
    const role=contactRole(contact).replace(/\s+on\s+1632\b/gi,'').trim();
    const label=[contact.name || fallback,role,contact.primary && 'Primary contact',contact.facility,contact.unit].filter(Boolean).join(' · ');
    wrapper.innerHTML=phoneControls(contact,label);
    return wrapper;
  }
  function renderContacts(row,p){
    const groups=contactGroups(p.contacts),own=cell(row,'');own.className='clinic-patient-phone';
    if(groups.patient.length)for(const c of groups.patient)own.append(compactContact(c,p.name));else own.textContent='Not recorded';
    const others=cell(row,'');others.className='clinic-contacts';
    for(const c of groups.family)others.append(compactContact(c));
    for(const c of groups.care)others.append(compactContact(c));
    if(!groups.family.length&&!groups.care.length){const missing=document.createElement('span');missing.textContent='Not recorded';others.append(missing);}
    if(groups.other.length){const heading=document.createElement('small');heading.className='clinic-contact-heading';heading.textContent='Other contacts';others.append(heading);for(const c of groups.other)others.append(compactContact(c));}
  }
  function render(){
    hideTip();
    if(phoneMenu.matches(':popover-open'))phoneMenu.hidePopover();
    body.replaceChildren();feedback.textContent=busy?'Saving '+title+'…':'';statusNotice();host.querySelector('.clinic-reload')?.toggleAttribute('disabled',busy||loadState==='loading'||planningDialog.open||provisionDialog.open||phoneDialog.open||avaDialog.open);
    const loadStatus=host.querySelector('.clinic-load-status');loadStatus.hidden=!['loading','error'].includes(loadState);
    loadStatus.textContent=loadState==='error'?loadMessage+(loaded?(maid?' Showing the last loaded list; changes are disabled until reload succeeds.':' Showing the last loaded list.'): ''):loaded?`Refreshing ${title} patients…`:`Loading ${title} patients…`;
    const showPlanning=maid;
    const appPatients=maid?maidAppPatients(patients):patients.filter(p=>p.status===view);
    const inView=appPatients.map((patient,index)=>({patient,index})).filter(({patient})=>!maid||view==='all'||(isProvisionPending(patient)?'active':patient.status)===view);
    const visible=inView.filter(({patient:p})=>maid?[p.name,p.phn,p.ava,patientLocation(p),p.plannedProvision?.location,p.plannedProvision?.address,...appContacts(p.contacts).map(c=>c.name)].join(' ').toLocaleLowerCase().includes(query):oatPatientMatches(p,query));
    count.textContent=!loaded?(loadState==='loading'?'Loading patients…':loadState==='error'?'Patient list unavailable':'Patient list not loaded'):`${visible.length} of ${inView.length} patients`;
    empty.hidden=visible.length>0;
    if(!maid){
      host.querySelector('.clinic-heading h1').textContent=view==='history'?'Historical patients':'Active patients';
      host.querySelector('.clinic-heading p').textContent=title+' · '+(view==='history'?'Previous patients, ready to reactivate.':'Your current clinic list.');
      host.querySelector('.oat-status-date-heading').textContent=view==='history'?'Moved to history':'Active since';
      host.querySelector('input[type=search]').placeholder=view==='history'?'Search history · name, PHN or Ava number':'Search active · name, PHN or Ava number';
    }
    empty.querySelector('[data-search-other]')?.remove();
    if(!visible.length){
      empty.querySelector('h2').textContent=appPatients.length?'No patients match this view':'Waiting for your patient list';
      empty.querySelector('p').textContent=appPatients.length?'Try another search or patient view.':`${maid?'Your current patients will start in Active.':'Your patients will appear here in the supplied clinic order.'} Names will open Ava, with Copy PHN beside them.`;
      if(loadState==='loading'){empty.querySelector('h2').textContent=`Loading ${title} patients…`;empty.querySelector('p').textContent='Reading the existing patient list.';}
      else if(loadState==='error'){empty.querySelector('h2').textContent=`${title} roster could not load`;empty.querySelector('p').textContent=loadMessage;}
      else if(!loaded){empty.querySelector('h2').textContent=`${title} patient list not loaded`;empty.querySelector('p').textContent='Connect your workspace, then reload '+title+'.';}
      else if(!maid&&view==='history'&&!appPatients.length){empty.querySelector('h2').textContent='No patients in history';empty.querySelector('p').textContent='Patients who leave the active list will appear here.';}
      else if(!appPatients.length){empty.querySelector('h2').textContent=`No ${title} patients`;empty.querySelector('p').textContent=maid?'There are no patients to show. Completed provisions are removed automatically after closeout.':'The saved '+title+' roster is empty.';}
      if(!maid&&loaded&&loadState==='ready'&&onPatientView){const searchOther=document.createElement('button');searchOther.type='button';searchOther.dataset.searchOther='';searchOther.textContent=view==='active'?'Search history':'Search active patients';searchOther.onclick=()=>onPatientView(view==='active'?'history':'active');empty.append(searchOther);}
    }
    for(const {patient:p,index} of visible){
      const row=document.createElement('tr');cell(row,String(index+1));
      const name=cell(row,'');const url=avaChartUrl(p);
      if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=p.name;link.title='Open Ava chart';name.append(link);}
      else {name.textContent=p.name;const hint=document.createElement('small');hint.textContent=maid?'Ava number needed':'Ava number pending';name.append(hint);}
      if(!maid&&p.statusReview){const review=document.createElement('small');review.className='oat-status-review';review.textContent='Latest list differs';review.title='The '+p.statusReview.asOf+' list indicates '+p.statusReview.panelStatus+'. Review this patient’s status in the actions menu.';name.append(review);}
      const phn=cell(row,'');const digits=String(p.phn||'').replace(/\D/g,'');
      if(/^\d{10}$/.test(digits)){
        const value=document.createElement('span');value.textContent=digits;phn.append(value);
        const copy=document.createElement('button');copy.type='button';copy.className='clinic-phn-copy';copy.title='Copy PHN';copy.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg>';copy.setAttribute('aria-label',`Copy PHN for ${p.name}`);
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(digits);feedback.textContent='PHN copied.';}catch{feedback.textContent='Could not copy. Select the displayed PHN to copy it.';}};phn.append(copy);
      }else phn.textContent='Not recorded';
      if(maid)renderContacts(row,p);
      else {
        const phone=cell(row,'');
        phone.append(oatPhoneControls(p,{onEdit:onPhone?()=>openPhone(p):null,disabled:!ready||busy}));
        const statusDate=oatStatusDate(p);cell(row,statusDate?formatDate(statusDate):'—').className='oat-status-date';
        const actions=cell(row,'');actions.className='clinic-actions';
        const actionButtons=document.createElement('div');actionButtons.className='roster-billing-actions';actions.append(actionButtons);
        if(p.status==='history'&&onStatus){
          const restore=document.createElement('button');restore.type='button';restore.className='roster-icon oat-reactivate';restore.title='Reactivate';restore.setAttribute('aria-label','Reactivate '+p.name);restore.disabled=!ready||busy;
          restore.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8" r="3.5"/><path d="M3 21v-2a7 7 0 0 1 12-5m1 3 2 2 4-5"/></svg>';
          restore.onclick=()=>void changeStatus(p,'active');actionButtons.append(restore);
        }
        if(fh){const message=messages.button(p);message.disabled=!ready||busy;actionButtons.append(message);}
        if(onPhone||onAva||onStatus){
          const more=document.createElement('button');
          more.type='button';more.className='clinic-phone-edit';more.innerHTML=moreIcon;
          more.setAttribute('aria-label','Actions for '+p.name);
          more.title='Patient actions';
          more.disabled=!ready||busy;
          more.onclick=()=>openPatientMenu(p,more);
          actionButtons.append(more);
        }
      }
      if(maid)cell(row,patientLocation(p));
      if(maid){
        if(showPlanning){
          const plan=cell(row,'');plan.className='clinic-assessment-planning';
          const summary=assessmentPlanningText(p),label=document.createElement('span');label.textContent=summary.label;plan.append(label);
          if(p.assessmentSchedule?.source)label.title=p.assessmentSchedule.source;
          if(summary.past){const overdue=document.createElement('small');overdue.className='clinic-planning-overdue';overdue.textContent='Past date — confirm outcome';plan.append(overdue);}
          const level=p.assessmentUrgency?.level||'unknown';
          if(level==='semi-urgent'){const badge=document.createElement('small');badge.className='clinic-urgency-badge';badge.textContent='Semi-urgent';badge.title=p.assessmentUrgency.source;plan.append(badge);}
          if(onAction&&view==='active'&&!isProvisionPending(p)){
            const actions=document.createElement('div');actions.className='clinic-planning-actions';
            const edit=document.createElement('button');edit.textContent='Edit';edit.setAttribute('aria-label',`Edit 1634 planning for ${p.name}`);edit.disabled=busy||!ready;edit.onclick=()=>editPlanning(p);
            const urgent=document.createElement('button');urgent.className='clinic-urgent-toggle';urgent.textContent=level==='urgent'?'Urgent':'Mark urgent';urgent.setAttribute('aria-pressed',String(level==='urgent'));urgent.setAttribute('aria-label',`${level==='urgent'?'Clear urgent':'Mark urgent'} for ${p.name}`);urgent.disabled=busy||!ready;urgent.title=p.assessmentUrgency?.source||'Mark this request urgent';urgent.onclick=()=>act({type:'assessment-planning',patientId:p.id,urgency:{level:level==='urgent'?'routine':'urgent',source:'Physician edit in MAID app'}});
            actions.append(edit,urgent);plan.append(actions);
          }else if(level==='urgent'){const badge=document.createElement('small');badge.className='clinic-urgency-badge';badge.textContent='Urgent';plan.append(badge);}
        }
        renderProvision(row,p);cell(row,p.form1645===true?'Yes':p.form1645===false?'No':'Not verified');
        const detail=cell(row,'');const disclosure=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Details';disclosure.append(summary);
        const list=document.createElement('dl');
        for(const [label,value] of [['1632 signed',p.forms?.['1632']?.signedDate],['1633 signed',p.forms?.['1633']?.signedDate],['1633 doctor / NP',p.forms?.['1633']?.practitioner],['1634 completed',p.forms?.['1634']?.completedDate],['1645 signed',p.forms?.['1645']?.signedDate]]){
          const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value||'Not recorded';list.append(dt,dd);
        }
        disclosure.append(list);
        const contacts=document.createElement('div');contacts.className='clinic-contact-sources';
        if(appContacts(p.contacts).length)for(const c of appContacts(p.contacts))contacts.append(contactSource(c));else contacts.textContent='No contacts recorded';
        if(p.contactSourceNotes){const note=document.createElement('p');note.textContent=p.contactSourceNotes;contacts.append(note);}
        disclosure.append(contacts);detail.append(disclosure);smoothDisclosure(disclosure,summary);
        const status=document.createElement('small');status.textContent=isProvisionPending(p)?`Provision ${p.provisionDate} — closeout pending`:p.status==='active'?'Active':'History';
        if(isProvisionPending(p))status.title=`Outstanding: ${closeoutOutstanding(p).join(', ')}`;detail.append(status);
        if(onAction){const actions=document.createElement('div');actions.className='clinic-row-actions';const move=document.createElement('button'),remove=document.createElement('button');
          move.textContent=p.status==='active'?'Move to History':'Move to Active';move.disabled=busy||!ready||isProvisionPending(p);move.onclick=()=>act({type:'status',patientId:p.id,status:p.status==='active'?'history':'active'});
          remove.textContent='Remove';remove.className='text-button danger';remove.setAttribute('aria-label','Remove '+p.name);remove.disabled=busy||!ready;remove.onclick=()=>confirmRemove(p);actions.append(move,remove);detail.append(actions);
        }
      }
      body.append(row);
    }
  }
  host.querySelector('input').oninput=e=>{query=e.target.value.trim().toLocaleLowerCase();render();};
  host.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;host.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();});
  render();
  return {
    state(){return {busy:busy||phoneDialog.open||avaDialog.open||planningDialog.open||provisionDialog.open||Boolean(messages?.open),ready,loading:loadState==='loading',dirty:false};},
    selectPatientView(value){if(!maid&&['active','history'].includes(value)){view=value;render();}},
    editAva(patientId){const patient=patients.find(p=>p.id===patientId);if(patient)openAva(patient);},
    editPhone(patientId){const patient=patients.find(p=>p.id===patientId);if(patient)openPhone(patient);},
    patientMenu(patientId,button,options){const patient=patients.find(p=>p.id===patientId);if(patient)openPatientMenu(patient,button,options);},
    setPatients(records){if(busy)return;linkButton.hidden=true;patients=structuredClone(records);ready=true;loaded=true;loadState='ready';loadMessage='';render();},
    loading({preserve=true}={}){ready=false;linkButton.hidden=true;if(!preserve){patients=[];loaded=false;}loadState='loading';loadMessage='';render();},
    error(message,{link=false}={}){ready=false;linkButton.hidden=!link;loadState='error';loadMessage=message;render();}
  };
}

// Animate the actual height so the table row moves with the disclosure in both directions.
function smoothDisclosure(details,summary){
  let animation=null,expanded=false;
  summary.addEventListener('click',event=>{
    event.preventDefault();expanded=!expanded;
    const start=details.getBoundingClientRect().height;
    if(animation){animation.onfinish=null;animation.cancel();animation=null;}
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){details.style.overflow='';details.open=expanded;return;}
    details.style.overflow='hidden';details.open=true;
    const end=expanded?details.getBoundingClientRect().height:summary.getBoundingClientRect().height;
    animation=details.animate({height:[`${start}px`,`${end}px`]},{duration:220,easing:'ease-in-out'});
    animation.onfinish=()=>{details.open=expanded;details.style.overflow='';animation=null;};
  });
}
