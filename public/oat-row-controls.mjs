import {handset,phoneControls} from './roster-phone.mjs?v=20261119-export1';

export const moreIcon='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
export const phoneAddIcon=handset.replace('</svg>','<path d="M17 2v8m-4-4h8" stroke-linecap="round"/></svg>');
const phoneEditIcon=handset.replace('</svg>','<path d="m14 7 5-5 3 3-5 5-4 1z" fill="white"/></svg>');

// OAT uses the handset to edit; calling remains available inside the phone editor.
export function oatPhoneControls(patient,{onEdit,disabled=false}={}){
  const wrapper=document.createElement('span');
  wrapper.innerHTML=phoneControls({phone:patient.phone,role:'Patient'},patient.name);
  const controls=wrapper.firstElementChild;
  controls.querySelector('a')?.remove();
  if(!patient.phone)controls.replaceChildren();
  const edit=document.createElement('button');edit.type='button';edit.className='roster-icon oat-phone-edit';
  edit.innerHTML=patient.phone?phoneEditIcon:phoneAddIcon;
  edit.title=(patient.phone?'Edit':'Add')+' phone number';
  edit.setAttribute('aria-label',edit.title+' for '+patient.name);edit.disabled=disabled||!onEdit;
  edit.onclick=onEdit;controls.prepend(edit);return controls;
}
