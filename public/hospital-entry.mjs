import {hospitalAt,hospitalBlocks114,latestHospitalStay} from './hospital.mjs?v=20261024-hospital2';
import {hospitalSummary} from './hospital-ui.mjs?v=20261024-hospital2';
import {today,escapeHTML as esc} from './core.mjs?v=20261031-compact1';
export function hospitalEditor({patients,guard,notify}){
  const dialog=document.createElement('dialog');dialog.id='hospital-dialog';document.body.append(dialog);
  let target=null;
  function open(patient,date,stay=null,returning=false){
    guard();const raw=patients.roster(),records=['patients','otherPatients','removedPatients'].flatMap(c=>raw[c]||[]);
    const current=records.find(p=>'phn:'+String(p.phn||'').replace(/\D/g,'')===patient.key);
    if(!current)throw new Error('Add or correct this patient in TRIM Patient before recording hospital dates.');
    target={key:patient.key,id:stay?.id||null,expected:JSON.stringify(current.hospitalStays||[])};
    dialog.innerHTML=`<form id="hospital-form" class="dialog-body"><h2>${returning?'Record return to TRIM':stay?'Edit hospital dates':'Admitted to hospital'}</h2><p>${esc(patient.name)} · Room ${esc(patient.room||'—')}</p><div class="fields"><label>Admitted to hospital<input id="hospital-admitted" type="date" required max="${today()}" value="${esc(stay?.admittedDate||date)}"></label><label>Returned to TRIM<input id="hospital-returned" type="date" max="${today()}" value="${esc(stay?.returnedDate||(returning?date:''))}"></label></div><p class="hint">Leave return date blank while the patient is in hospital. A manual 114 may be entered on admission day for a visit before transfer. 114 is blocked from the next day until return; routine rounds exclude hospital patients. 14077 stays available.</p><p id="hospital-error" role="alert"></p><div class="actions"><button type="submit" class="primary">Save hospital dates</button><button type="button" id="hospital-close">Cancel</button></div></form>`;
    dialog.querySelector('#hospital-close').onclick=()=>dialog.close();
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const submit=dialog.querySelector('[type=submit]');submit.disabled=true;
      try{guard();await patients.setHospitalStay(target.key,{id:target.id,admittedDate:dialog.querySelector('#hospital-admitted').value,returnedDate:dialog.querySelector('#hospital-returned').value||null},target.expected);dialog.close();notify('Hospital dates saved locally. Choose Save to Drive to finish.');}
      catch(error){dialog.querySelector('#hospital-error').textContent=error.message;}
      finally{submit.disabled=false;}
    };
    dialog.showModal();dialog.querySelector(returning?'#hospital-returned':'#hospital-admitted').focus();
  }
  return {mount(editor,patient,date){
    const title=editor.querySelector('.patient-title');if(!title)return;
    const active=hospitalAt(patient,date),stay=latestHospitalStay(patient,date);
    const menu=document.createElement('details');menu.className='hospital-menu';menu.innerHTML='<summary>More ⋯</summary><div>'+(active?'':'<button type="button" data-hospital-new>Admitted to hospital…</button>')+(stay?'<button type="button" data-hospital-edit>Edit hospital dates…</button>':'')+'</div>';title.append(menu);
    const safe=fn=>()=>{try{fn();}catch(error){notify(error.message);}};
    menu.querySelector('[data-hospital-new]')?.addEventListener('click',safe(()=>{menu.open=false;open(patient,date);}));
    menu.querySelector('[data-hospital-edit]')?.addEventListener('click',safe(()=>{menu.open=false;open(patient,date,stay);}));
    if(stay){const banner=document.createElement('section');banner.className='hospital-banner';banner.innerHTML=hospitalSummary(patient,date)+(active?`<p>${hospitalBlocks114(patient,date)?'114 blocked':'Admission day: manual 114 available for a visit before transfer; excluded from routine rounds'} · 14077 available for provider conferences.</p><button type="button" data-hospital-return>Record return to TRIM</button>`:'');editor.querySelector('.editor-head').after(banner);banner.querySelector('[data-hospital-return]')?.addEventListener('click',safe(()=>open(patient,date,stay,true)));}
  }};
}
