import {escapeHTML as esc} from './core.mjs?v=20261119-export1';
import {phoneLink} from './clinic-contacts.mjs?v=20261108-closeout1';

import {phoneControls} from './roster-phone.mjs?v=20261119-export1';

export function familyContactsCell(patient) {
  const rows = (patient.familyContacts || []).map(contact => {
    const label = [contact.name, contact.relationship].filter(Boolean).join(' · ');
    const publicGuardian=/\b(?:PG\s*[\/&]?\s*T|Public\s+Guardian(?:ship)?(?:\s+(?:and|&)\s+Trustee)?)\b/i.test(label);
    const role=publicGuardian?'<span class="family-contact-role" title="Public Guardian and Trustee">PG/T</span>':'';
    return '<div class="family-contact">'+role+phoneControls(contact,label)+'</div>';
  });
  return '<td class="family-contacts">'+(rows.join('') || '—')+'</td>';
}

export function familyContactDialog(root, save) {
  const dialog = document.createElement('dialog');
  dialog.className = 'family-contact-dialog';
  dialog.setAttribute('aria-labelledby','contact-dialog-title');
  dialog.innerHTML = `<h2 id="contact-dialog-title"></h2><p class="contact-patient"></p><div class="contact-choices"></div><form>
    <label>Contact name<input name="name" required></label><label>Relationship<input name="relationship"></label>
    <label>Phone number<input name="phone" type="tel" required></label><p role="alert"></p>
    <div class="actions"><button type="button" class="btn btn-ghost">Cancel</button><button type="submit" class="btn btn-green">Save contact</button></div></form>`;
  root.append(dialog);
  const form = dialog.querySelector('form'), error = form.querySelector('[role=alert]');
  let target;
  form.querySelector('[type=button]').onclick = () => dialog.close();
  dialog.onclose = () => {form.reset(); target = null;};
  form.onsubmit = async event => {
    event.preventDefault();
    const fields = Object.fromEntries([...new FormData(form)].map(([key,value]) => [key,value.trim()]));
    if (!fields.name || !phoneLink(fields.phone,target.contact?.extension)) {
      error.textContent = 'Enter a contact name and one valid phone number.';
      return;
    }
    try {
      await save(target,fields);
      dialog.close();
    } catch (e) { error.textContent = e.message; }
  };
  function selectContact(patient,index){
    const contacts = patient.familyContacts || [];
    target = {id:patient.id, index, contact:contacts[index], expected:JSON.stringify(contacts)};
    dialog.querySelector('h2').textContent = index < 0 ? 'Add family contact' : 'Edit family contact';
    dialog.querySelector('.contact-patient').textContent = [patient.name,patient.room && 'Room '+patient.room].filter(Boolean).join(' · ');
    for (const key of ['name','relationship','phone']) form.elements[key].value = target.contact?.[key] || '';
    error.textContent = '';
    choices.hidden = true;
    form.hidden = false;
    form.elements.name.focus();
  }
  const choices = dialog.querySelector('.contact-choices');
  return {get open(){return dialog.open;}, show(patient){
    form.hidden = true;
    choices.hidden = false;
    dialog.querySelector('h2').textContent = 'Family contacts';
    dialog.querySelector('.contact-patient').textContent = [patient.name,patient.room && 'Room '+patient.room].filter(Boolean).join(' · ');
    choices.innerHTML = (patient.familyContacts || []).map((c,i) =>
      '<div class="contact-choice"><span><strong>'+esc(c.name)+'</strong> '+esc(c.relationship || '')+'<br>'+esc(c.phone || '')+(c.extension?' ext. '+esc(c.extension):'')+'</span><button class="btn btn-ghost" data-index="'+i+'">Edit</button></div>'
    ).join('')+'<div class="actions"><button class="btn btn-green" data-index="-1">Add contact</button><button class="btn btn-ghost" data-done>Done</button></div>';
    choices.onclick = e=>{
      const button = e.target.closest('button');
      if (button?.hasAttribute('data-index')) selectContact(patient,Number(button.dataset.index));
      else if (button?.hasAttribute('data-done')) dialog.close();
    };
    dialog.showModal();
  }};
}
