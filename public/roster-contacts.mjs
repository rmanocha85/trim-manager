import {escapeHTML as esc} from './core.mjs';
import {phoneLink} from './clinic-contacts.mjs?v=20261108-closeout1';

export function familyContactsCell(patient, historical) {
  const edit = (index, label) => historical ? '' : `<button type="button" class="btn btn-ghost btn-sm contact-edit" data-roster-edit-action data-contact-index="${index}" data-click="editFamilyContact(this)">${label}</button>`;
  const rows = (patient.familyContacts || []).map((contact, index) => {
    const phone = phoneLink(contact.phone, contact.extension);
    const call = phone ? `<a class="btn btn-ghost btn-sm" href="${esc(phone.href)}" aria-label="Call ${esc(contact.name)}" title="Call through your phone app${phone.extension ? '; enter extension ' + esc(phone.extension) + ' after connection' : ''}">Call</a>` : '';
    return `<div class="family-contact"><div><strong>${esc(contact.name)}</strong>${contact.relationship ? ' (' + esc(contact.relationship) + ')' : ''} ${edit(index,'Edit')}</div>
      <div class="contact-number"><span>${esc(contact.phone)}${contact.extension ? ' ext. ' + esc(contact.extension) : ''}</span>
      ${contact.phone ? `<button type="button" class="btn btn-ghost btn-sm" data-copy-value="${esc(contact.phone)}" data-copy-feedback="Number copied">Copy number</button>` : ''} ${call}</div></div>`;
  }).join('');
  return `<td class="family-contacts">${rows}${edit(-1,'+ Add contact')}</td>`;
}

export function familyContactDialog(root, save) {
  const dialog = document.createElement('dialog');
  dialog.className = 'family-contact-dialog';
  dialog.setAttribute('aria-labelledby','contact-dialog-title');
  dialog.innerHTML = `<form><h2 id="contact-dialog-title"></h2><p class="contact-patient"></p>
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
  return {get open(){return dialog.open;}, show(patient,index){
    const contacts = patient.familyContacts || [];
    target = {id:patient.id, index, contact:contacts[index], expected:JSON.stringify(contacts)};
    form.querySelector('h2').textContent = index < 0 ? 'Add family contact' : 'Edit family contact';
    form.querySelector('.contact-patient').textContent = [patient.name,patient.room && 'Room '+patient.room].filter(Boolean).join(' · ');
    for (const key of ['name','relationship','phone']) form.elements[key].value = target.contact?.[key] || '';
    error.textContent = '';
    dialog.showModal();
    form.elements.name.focus();
  }};
}
