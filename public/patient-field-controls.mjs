import {escapeHTML as esc} from './core.mjs';
import {handset,phoneControls} from './roster-phone.mjs?v=20261127-shared1';
import {phoneLink} from './clinic-contacts.mjs';

export const phoneAddIcon=handset.replace('</svg>','<path d="M17 2v8m-4-4h8" stroke-linecap="round"/></svg>');
export const phoneEditIcon=handset.replace('</svg>','<path d="m14 7 5-5 3 3-5 5-4 1z" fill="white"/></svg>');
const chartIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="14" height="18" rx="2"/><path d="M6 7h7M6 11h5m3 7 6-6 2 2-6 6-3 1z"/></svg>';
export function avaEditHTML(patient,{disabled=false}={}){
  const label=(patient.ava?'Edit':'Add')+' Ava EMR number';
  return `<button type="button" class="workos-field-icon ava-edit" title="${label}" aria-label="${label} for ${esc(patient.name)}" ${disabled?'disabled':''}>${chartIcon}</button>`;
}
export function avaEditControl(patient,{onEdit,disabled=false}={}){
  const wrap=document.createElement('span');wrap.innerHTML=avaEditHTML(patient,{disabled:disabled||!onEdit});
  const button=wrap.firstElementChild;button.onclick=onEdit;return button;
}
export function editablePhoneHTML(contact,label,{disabled=false,action='Edit phone number'}={}){
  const wrapper=phoneControls(contact,label);
  const edit=`<button type="button" class="roster-icon workos-phone-edit" title="${esc(action)}" aria-label="${esc(action+' for '+label)}" ${disabled?'disabled':''}>${contact.phone?phoneEditIcon:phoneAddIcon}</button>`;
  return wrapper.replace(/<a\b[^>]*>[\s\S]*?<\/a>/,'').replace(/<span tabindex="0"[^>]*>—<\/span>/,'').replace(/(<span class="roster-phone"[^>]*>)/,'$1'+edit);
}
export function editablePhoneControls(patient,{onEdit,disabled=false}={}){
  const wrapper=document.createElement('span');wrapper.innerHTML=editablePhoneHTML(patient,patient.name,{disabled:disabled||!onEdit,action:(patient.phone?'Edit':'Add')+' phone number'});
  const button=wrapper.querySelector('button');button.onclick=onEdit;
  // Retained for existing OAT layout and consumers while sharing the implementation.
  button.classList.add('oat-phone-edit');return wrapper.firstElementChild;
}

// All owners provide a scoped, verified save. This component never writes a roster itself.
export function patientFieldEditor(root,{kind,onSave,onChange=()=>{},duplicateAva=()=>false,className=''}={}){
  const ava=kind==='ava',contact=kind==='contact';
  const dialog=document.createElement('dialog');dialog.className='workos-field-dialog '+className;
  dialog.setAttribute('aria-label',ava?'Ava EMR number':contact?'Family contact':'Patient phone');
  dialog.innerHTML=`<form><h2></h2><p class="ava-patient-name contact-patient"></p><p class="ava-patient-identity"></p>${contact?'<label>Contact name<input name="name" required maxlength="160"></label><label>Relationship<input name="relationship" maxlength="100"></label>':''}${ava?'<label>Ava EMR number<input name="ava" inputmode="numeric" required pattern="[0-9]{6,10}" maxlength="10" autocomplete="off"></label><p class="planning-help">Enter the number from this patient’s Ava chart address.</p>':'<label>Phone number<input name="phone" type="tel" required maxlength="80"></label>'+(contact?'<label>Extension (optional)<input name="extension" inputmode="numeric" pattern="[0-9]{1,8}" maxlength="8"></label>':'')+'<a class="oat-phone-call" hidden></a>'}<p role="alert"></p><div class="actions"><button type="button">Cancel</button><button type="submit">${ava?'Save Ava number':contact?'Save contact':'Save phone'}</button></div></form>`;
  root.append(dialog);const form=dialog.querySelector('form'),error=form.querySelector('[role=alert]');let target,busy=false,opener,openerRoot,openerLabel;
  form.querySelector('[type=button]').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{target=null;form.reset();onChange();const restore=opener?.isConnected?opener:openerLabel&&openerRoot?.querySelector('[aria-label="'+CSS.escape(openerLabel)+'"]');restore?.focus();});
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!target)return;
    const fields=Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,v.trim()]));
    if(ava){
      if(!/^\d{6,10}$/.test(fields.ava)){error.textContent='Enter an Ava EMR number containing 6–10 digits.';return;}
      if(duplicateAva(target.patient,fields.ava)){error.textContent='This Ava EMR number is already assigned to another patient. Review the patient records before saving.';return;}
    }else if(!phoneLink(fields.phone,fields.extension)){error.textContent='Enter one valid phone number and, if needed, an extension.';return;}
    if(contact)fields.extension=fields.extension||null;
    busy=true;error.textContent='';dialog.setAttribute('aria-busy','true');onChange();
    const controls=form.querySelectorAll('input,button');controls.forEach(el=>el.disabled=true);
    try{await onSave(target.patient,fields,target.context);dialog.close();}
    catch(e){error.textContent=e.message;}
    finally{busy=false;dialog.removeAttribute('aria-busy');controls.forEach(el=>el.disabled=false);onChange();}
  };
  return {dialog,get open(){return dialog.open;},get busy(){return busy;},show(patient,context={}){
    if(dialog.open||busy)return;opener=document.activeElement;while(opener?.shadowRoot?.activeElement)opener=opener.shadowRoot.activeElement;openerRoot=opener?.getRootNode();openerLabel=opener?.getAttribute('aria-label');target={patient:structuredClone(patient),context};
    const source=contact?context.contact||{}:patient;
    form.querySelector('h2').textContent=ava?(patient.ava?'Edit':'Add')+' Ava EMR number':contact?(context.contact?'Edit':'Add')+' family contact':(patient.phone?'Edit':'Add')+' patient phone';
    form.querySelector('.ava-patient-name').textContent=patient.name;
    form.querySelector('.ava-patient-identity').textContent=['PHN: '+(patient.phn||'Not recorded'),(patient.dob||patient.dateOfBirth)&&'DOB: '+(patient.dob||patient.dateOfBirth),contact&&'Family contact'].filter(Boolean).join(' · ');
    for(const input of form.querySelectorAll('input'))input.value=source[input.name]||'';
    if(!ava){const call=form.querySelector('a'),number=phoneLink(source.phone,source.extension);call.hidden=!number;if(number){call.href=number.href;call.textContent='Call '+source.phone+(number.extension?' · extension '+number.extension:'');call.setAttribute('aria-label','Call '+(source.name||patient.name)+' at '+source.phone);}else call.removeAttribute('href');}
    error.textContent='';dialog.showModal();form.querySelector('input').focus();onChange();
  }};
}
