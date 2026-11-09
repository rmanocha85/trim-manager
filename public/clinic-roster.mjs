import {avaChartUrl} from './patient-links.mjs';
import {contactGroups,contactRole,phoneLink,appContacts} from './clinic-contacts.mjs?v=20261108-closeout1';
import {maidAppPatients,isProvisionPending,patientLocation,closeoutOutstanding} from './maid-lifecycle.mjs';

// No patient data is persisted in browser storage; each action verifies its saved revision.
export function clinicRosterUI({host,kind,onAction,onReload,onChange=()=>{}}) {
  const maid=kind==='maid', title=maid?'MAID':'OAT Fraser Health';
  let patients=[],view='active',query='',busy=false,ready=false,loaded=false,loadState='idle',loadMessage='';
  host.classList.add('clinic-workspace');
  host.innerHTML=`<div class="clinic-heading"><div><h1>${title}</h1><p>${maid?'Current patients and assessment history.':'Your clinic list, in the order you provide.'}</p></div><span class="clinic-count" role="status" aria-live="polite"></span></div>
    <div class="clinic-toolbar">${maid?'<nav class="clinic-filters" aria-label="MAID patient status"><button data-view="active" aria-pressed="true">Active</button><button data-view="history" aria-pressed="false">History</button><button data-view="all" aria-pressed="false">All</button></nav>':''}<input type="search" aria-label="Search ${title}" placeholder="Search name, PHN or location" autocomplete="off"></div>
    <p class="clinic-load-status" role="status" aria-live="polite" hidden></p>
    <div class="clinic-table-wrap" role="region" aria-label="${title} patient list" tabindex="0"><table class="clinic-table"><caption class="sr-only">${title} patients</caption><thead><tr><th scope="col">#</th><th scope="col">Patient</th><th scope="col">PHN</th>${maid?'<th scope="col">Patient phone</th><th scope="col">Primary / family contact</th>':''}<th scope="col">Location</th>${maid?'<th scope="col">Assessment</th><th scope="col">1645</th><th scope="col">Details / actions</th>':''}</tr></thead><tbody></tbody></table></div>
    <div class="clinic-empty"><h2>Waiting for your patient list</h2><p>${maid?'Your current patients will start in Active.':'Your patients will appear here in the supplied clinic order.'} Names will open Ava, with Copy PHN beside them.</p></div><p class="clinic-feedback" role="status" aria-live="polite"></p>`;
  if(maid&&onReload){const reload=document.createElement('button');reload.textContent='Reload MAID';reload.className='clinic-reload';reload.onclick=()=>{if(!busy)void onReload();};host.querySelector('.clinic-toolbar').append(reload);}
  const dialog=document.createElement('dialog');dialog.className='clinic-remove-dialog';dialog.innerHTML='<form method="dialog"><h2>Remove patient from MAID?</h2><p class="remove-name"></p><p>This deletes all of their tracking information from Active and History. Their original documents and folders stay in place.</p><div class="actions"><button value="cancel">Cancel</button><button value="remove" class="danger">Remove patient</button></div></form>';if(maid)host.append(dialog);
  async function act(action){
    if(busy||!ready||!onAction)return;busy=true;onChange();render();
    let message='';
    try{const result=await onAction(action);patients=structuredClone(result.patients);message=action.type==='remove'?'Patient removed.':'Patient status saved.';if(result.local)message+=' Saved to the laptop Drive folder; cloud sync is unverified.';}
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
  function contactCard(contact,{patient=false,source=false,phoneOnly=false}={}){
    const card=document.createElement('div');card.className='clinic-contact';
    const role=contactRole(contact).replace(/\s+on\s+1632\b/gi,'').trim();
    const phone=phoneLink(contact.phone,contact.extension),number=document.createElement(phone?'a':'span');number.className='clinic-phone';number.textContent=contact.phone||'Phone not recorded';
    if(phone){number.href=phone.href;number.title=`Call in your phone app (ZAC on this PC)${phone.extension?`; enter extension ${phone.extension} after connection`:''}`;number.setAttribute('aria-label',`Call ${contact.name||role||'contact'} at ${contact.phone}${phone.extension?`, extension ${phone.extension}`:''}`);}
    card.append(number);
    if(contact.extension){const ext=document.createElement('small');ext.textContent=`Extension ${contact.extension}`;card.append(ext);}
    if(!phoneOnly){
    if(!patient){const name=document.createElement('strong');name.textContent=contact.name||'Name not recorded';card.append(name);}
    if(role){const label=document.createElement('small');label.textContent=role;card.append(label);}
    if(contact.primary===true){const primary=document.createElement('small');primary.textContent='Primary contact';card.append(primary);}
    const location=[contact.facility,contact.unit].filter(Boolean).join(' · ');if(location){const label=document.createElement('small');label.textContent=location;card.append(label);}
    }
    const provenance=[contact.source,contact.sourceDate&&`Source date: ${contact.sourceDate}`,contact.verifiedDate&&`Verified: ${contact.verifiedDate}`].filter(Boolean).join(' · ');
    if(provenance)card.title=provenance;
    if(source){for(const text of [contact.email,provenance,contact.note])if(text){const line=document.createElement('small');line.textContent=text;card.append(line);}}
    return card;
  }
  function renderContacts(row,p){
    const groups=contactGroups(p.contacts),own=cell(row,'');own.className='clinic-patient-phone';
    if(groups.patient.length)for(const c of groups.patient)own.append(contactCard(c,{patient:true}));else own.textContent='Not recorded';
    const others=cell(row,'');others.className='clinic-contacts';
    const hospice=/\b(hospice|CMH)\b/i.test(patientLocation(p));
    for(const c of groups.family)others.append(contactCard(c));
    for(const c of groups.care)others.append(contactCard(c,{phoneOnly:hospice}));
    if(!groups.family.length&&!groups.care.length){const missing=document.createElement('span');missing.textContent='Not recorded';others.append(missing);}
    if(groups.other.length){const heading=document.createElement('small');heading.className='clinic-contact-heading';heading.textContent='Other contacts';others.append(heading);for(const c of groups.other)others.append(contactCard(c));}
  }
  function render(){
    body.replaceChildren();feedback.textContent=busy?'Saving MAID…':'';host.querySelector('.clinic-reload')?.toggleAttribute('disabled',busy||loadState==='loading');
    const loadStatus=host.querySelector('.clinic-load-status');loadStatus.hidden=!maid||!['loading','error'].includes(loadState);
    loadStatus.textContent=loadState==='error'?loadMessage+(loaded?' Showing the last loaded list; changes are disabled until reload succeeds.':''):loaded?'Refreshing MAID patients…':'Loading MAID patients…';
    const appPatients=maid?maidAppPatients(patients):patients;
    const inView=appPatients.map((patient,index)=>({patient,index})).filter(({patient})=>!maid||view==='all'||(isProvisionPending(patient)?'active':patient.status)===view);
    const visible=inView.filter(({patient:p})=>[p.name,p.phn,p.ava,patientLocation(p),...appContacts(p.contacts).map(c=>c.name)].join(' ').toLocaleLowerCase().includes(query));
    count.textContent=maid&&!loaded?(loadState==='loading'?'Loading patients…':loadState==='error'?'Patient list unavailable':'Patient list not loaded'):`${visible.length} of ${inView.length} patients`;
    empty.hidden=visible.length>0;
    if(!visible.length){
      empty.querySelector('h2').textContent=appPatients.length?'No patients match this view':'Waiting for your patient list';
      empty.querySelector('p').textContent=appPatients.length?'Try another search or patient view.':`${maid?'Your current patients will start in Active.':'Your patients will appear here in the supplied clinic order.'} Names will open Ava, with Copy PHN beside them.`;
      if(maid){
        if(loadState==='loading'){empty.querySelector('h2').textContent='Loading MAID patients…';empty.querySelector('p').textContent='Reading the existing patient list.';}
        else if(loadState==='error'){empty.querySelector('h2').textContent='MAID roster could not load';empty.querySelector('p').textContent=loadMessage;}
        else if(!loaded){empty.querySelector('h2').textContent='MAID patient list not loaded';empty.querySelector('p').textContent='Connect your workspace, then reload MAID.';}
        else if(!appPatients.length){empty.querySelector('h2').textContent='No MAID patients';empty.querySelector('p').textContent='There are no patients to show. Completed provisions are removed automatically after closeout.';}
      }
    }
    for(const {patient:p,index} of visible){
      const row=document.createElement('tr');cell(row,String(index+1));
      const name=cell(row,'');const url=avaChartUrl(p);
      if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=p.name;link.title='Open Ava chart';name.append(link);}
      else {name.textContent=p.name;const hint=document.createElement('small');hint.textContent='Ava number needed';name.append(hint);}
      const phn=cell(row,'');const digits=String(p.phn||'').replace(/\D/g,'');
      if(/^\d{10}$/.test(digits)){
        const value=document.createElement('span');value.textContent=digits;phn.append(value);
        const copy=document.createElement('button');copy.type='button';copy.className='clinic-phn-copy';copy.title='Copy PHN';copy.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg>';copy.setAttribute('aria-label',`Copy PHN for ${p.name}`);
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(digits);feedback.textContent='PHN copied.';}catch{feedback.textContent='Could not copy. Select the displayed PHN to copy it.';}};phn.append(copy);
      }else phn.textContent='Not recorded';
      if(maid)renderContacts(row,p);
      cell(row,patientLocation(p));
      if(maid){
        cell(row,p.assessmentDate||'Not recorded');cell(row,p.form1645===true?'Yes':p.form1645===false?'No':'Not verified');
        const detail=cell(row,'');const disclosure=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Details';disclosure.append(summary);
        const list=document.createElement('dl');
        for(const [label,value] of [['1632 signed',p.forms?.['1632']?.signedDate],['1633 signed',p.forms?.['1633']?.signedDate],['1633 doctor / NP',p.forms?.['1633']?.practitioner],['1634 completed',p.forms?.['1634']?.completedDate],['1645 signed',p.forms?.['1645']?.signedDate]]){
          const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value||'Not recorded';list.append(dt,dd);
        }
        disclosure.append(list);
        const contacts=document.createElement('div');contacts.className='clinic-contact-sources';
        if(appContacts(p.contacts).length)for(const c of appContacts(p.contacts))contacts.append(contactCard(c,{source:true}));else contacts.textContent='No contacts recorded';
        if(p.contactSourceNotes){const note=document.createElement('p');note.textContent=p.contactSourceNotes;contacts.append(note);}
        disclosure.append(contacts);detail.append(disclosure);
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
    state(){return {busy,ready,loading:loadState==='loading',dirty:false};},
    setPatients(records){if(busy)return;patients=structuredClone(records);ready=true;loaded=true;loadState='ready';loadMessage='';render();},
    loading({preserve=true}={}){ready=false;if(!preserve){patients=[];loaded=false;}loadState='loading';loadMessage='';render();},
    error(message){ready=false;loadState='error';loadMessage=message;render();}
  };
}
