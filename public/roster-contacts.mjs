import {patientName} from './patient-names.mjs?v=20261127-names1';
import {escapeHTML as esc} from './core.mjs';
import {phoneControls} from './roster-phone.mjs?v=20261127-menus2';
import {editablePhoneHTML,phoneAddIcon,patientFieldEditor} from './patient-field-controls.mjs?v=20261127-names1';

export function familyContactsCell(patient,{editable=false}={}) {
  const rows=(patient.familyContacts||[]).map((contact,index)=>{
    const label=[contact.name,contact.relationship].filter(Boolean).join(' · ');
    const publicGuardian=/\b(?:PG\s*[\/&]?\s*T|Public\s+Guardian(?:ship)?(?:\s+(?:and|&)\s+Trustee)?)\b/i.test(label);
    const role=publicGuardian?'<span class="family-contact-role" title="Public Guardian and Trustee">PG/T</span>':'';
    const controls=editable?editablePhoneHTML(contact,label,{action:'Edit contact'}).replace('class="roster-icon workos-phone-edit"','class="roster-icon workos-phone-edit" data-contact-index="'+index+'"'):phoneControls(contact,label);
    return '<div class="family-contact">'+role+controls+'</div>';
  });
  const add=editable?'<span class="roster-phone"><button type="button" class="roster-icon workos-phone-edit" data-contact-index="-1" title="Add family contact" aria-label="Add family contact for '+esc(patientName(patient))+'">'+phoneAddIcon+'</button></span>':'';
  return '<td class="family-contacts"><span class="family-contact-list">'+rows.join('')+add+(!rows.length&&!editable?'—':'')+'</span></td>';
}

export function familyContactDialog(root,save,{onChange=()=>{}}={}) {
  const editor=patientFieldEditor(root,{kind:'contact',className:'family-contact-dialog',onChange,onSave:(_patient,fields,target)=>save(target,fields)});
  const choices=document.createElement('dialog');choices.className='workos-field-dialog family-contact-choices';choices.setAttribute('aria-label','Family contacts');root.append(choices);
  choices.addEventListener('close',onChange);
  function edit(patient,index){
    const contacts=patient.familyContacts||[];
    editor.show(patient,{id:patient.id,index,contact:contacts[index],expected:JSON.stringify(contacts)});
  }
  return {get open(){return editor.open||choices.open;},show(patient,index){
    if(Number.isInteger(index)){edit(patient,index);return;}
    if(!patient.familyContacts?.length){edit(patient,-1);return;}
    choices.innerHTML='<h2>Family contacts</h2><p>'+esc(patientName(patient))+'</p>'+(patient.familyContacts||[]).map((c,i)=>'<div class="contact-choice"><span><strong>'+esc(c.name)+'</strong> '+esc(c.relationship||'')+'<br>'+esc(c.phone||'')+(c.extension?' ext. '+esc(c.extension):'')+'</span><button type="button" data-index="'+i+'">Edit</button></div>').join('')+'<div class="actions"><button type="button" data-index="-1">Add contact</button><button type="button" data-done>Done</button></div>';
    choices.onclick=event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-index')){choices.close();edit(patient,Number(button.dataset.index));}else choices.close();};
    choices.showModal();onChange();
  }};
}
