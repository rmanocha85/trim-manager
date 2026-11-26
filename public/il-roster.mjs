import {bindIdentity, nameHTML, phnHTML} from './patient-identity.mjs?v=20261119-most-connection1';
import {facilityNames,pleasantviewGroups,fileForSite,sitePatients,FacilityRosterSession} from './il-data.mjs?v=20261126-il6';
export {facilityNames};
// Match the person-plus and person-minus symbols in the main roster.
const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const addIcon = icon('<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M19 8v6M16 11h6"/>');
const removeIcon = icon('<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 9h6"/>');

export function facilityRoster(host, connection, link) {
  host.innerHTML = `<div class="clinic-heading"><h1></h1><span class="clinic-count" hidden></span></div>
    <div class="clinic-toolbar"><input type="search" placeholder="Search name or PHN" aria-label="Search facility roster" autocomplete="off">
    <div class="facility-toolbar-actions"><button type="button" data-add class="facility-icon" aria-label="Add patient" title="Add patient" disabled>${addIcon}</button><button type="button" data-reload>Reload roster</button></div></div>
    <p class="facility-status" role="status"></p><button type="button" data-link hidden>Connect facility roster</button>
    <div data-groups></div>
    <dialog class="clinic-planning-dialog" aria-labelledby="il-add-title"><form>
      <h2 id="il-add-title"></h2>
      <label data-group-label>Care group<select name="group"><option value="pleasantview_rc">Residential Care (RC)</option><option value="pleasantview_al">Assisted Living (AL)</option></select></label>
      <label>Patient name<input name="name" required autocomplete="off" placeholder="Last name, First name"></label>
      <label>Ava chart number<input name="ava" required inputmode="numeric" pattern="[0-9]{6,10}" autocomplete="off"></label>
      <label>PHN (optional)<input name="phn" inputmode="numeric" autocomplete="off"></label>
      <label>Date of birth (optional)<input name="dob" type="date" data-native-date></label>
      <p class="planning-error" role="alert"></p>
      <div class="actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="facility-icon" aria-label="Add patient" title="Add patient">${addIcon}</button></div>
    </form></dialog>
    <dialog class="clinic-remove-dialog" aria-labelledby="il-remove-title">
      <h2 id="il-remove-title">Remove from roster?</h2><p data-remove-name></p>
      <p data-remove-site></p><p role="alert"></p>
      <div class="actions"><button type="button" data-remove-cancel>Cancel</button><button type="button" data-remove-confirm class="danger facility-icon" aria-label="Remove from roster" title="Remove from roster">${removeIcon}</button></div>
    </dialog>`;
  bindIdentity(host);
  const find = selector => host.querySelector(selector);
  const notice = find('.facility-status'), search = find('input'), count = find('.clinic-count');
  const linkButton = find('[data-link]'), groupHost = find('[data-groups]');
  const dialog = find('.clinic-planning-dialog'), removeDialog = find('.clinic-remove-dialog'), form = find('form'), addButton = find('[data-add]');
  const session = new FacilityRosterSession(connection);
  let currentSite, request = 0, patients = [], snapshot, loadedAdapter, loadedAccount, saving = false, editable = false, removedPatient;
  const account = adapter => String(adapter?.accountEmail || '').toLowerCase();
  function ready(enabled) {
    editable = enabled;
    addButton.disabled = !enabled;
    host.querySelectorAll('[data-patient-menu]').forEach(button => button.disabled = !enabled);
  }
  addButton.onclick = () => {
    form.reset();
    find('[data-group-label]').hidden = currentSite !== 'pleasantview';
    dialog.querySelector('h2').textContent = 'Add patient to ' + facilityNames.get(currentSite);
    form.querySelector('[role=alert]').textContent = '';
    dialog.showModal();
    form.elements.namedItem('name').focus();
  };
  find('[data-cancel]').onclick = () => dialog.close();
  find('[data-remove-cancel]').onclick = () => removeDialog.close();
  for (const modal of [dialog,removeDialog]) modal.oncancel = event => { if (saving) event.preventDefault(); };
  async function save(action, modal) {
    if (saving) return;
    const alert = modal.querySelector('[role=alert]'), controls = [...modal.querySelectorAll('button,input,select')];
    try {
      if (connection() !== loadedAdapter || account(connection()) !== loadedAccount) throw new Error('Connection changed. Close this form and reload the roster.');
      saving = true;
      controls.forEach(control => control.disabled = true);
      alert.textContent = 'Saving…';
      snapshot = await session.save(snapshot,currentSite,action);
      patients = sitePatients(snapshot.roster,currentSite);
      search.value = '';
      modal.close();
      render();
      notice.textContent = action.type === 'add' ? 'Patient added.' : 'Patient removed from roster.';
    } catch (error) {
      alert.textContent = error.message;
      if (error.reloadRequired) {
        ready(false);
        notice.textContent = 'Reload the roster before making more changes.';
      }
    }
    finally { saving = false; controls.forEach(control => control.disabled = false); }
  }
  form.onsubmit = event => {
    event.preventDefault();
    void save({type:'add',patient:Object.fromEntries(new FormData(form))},dialog);
  };
  find('[data-remove-confirm]').onclick = () => save({type:'remove',ava:removedPatient.ava,group:removedPatient.group},removeDialog);
  function patientRow(body, patient, index) {
    const row = body.insertRow();
    row.insertCell().textContent = String(index + 1);
    const name = row.insertCell(), identity = document.createElement('span');
    identity.className = 'facility-name';
    identity.innerHTML = nameHTML(patient);
    name.append(identity);
    row.insertCell().innerHTML = phnHTML(patient);
    const actions = row.insertCell(), menuId = 'facility-actions-' + currentSite + '-' + index;
    const button = document.createElement('button'), menu = document.createElement('div'), remove = document.createElement('button');
    button.type = 'button';
    button.textContent = '⋯';
    button.className = 'facility-menu-button';
    button.dataset.patientMenu = '';
    button.setAttribute('aria-label','Actions for ' + patient.name);
    button.setAttribute('popovertarget',menuId);
    menu.id = menuId;
    menu.setAttribute('popover','auto');
    menu.className = 'facility-menu';
    button.onclick = () => {
      const bounds = button.getBoundingClientRect();
      menu.style.top = Math.min(bounds.bottom + 4, innerHeight - 64) + 'px';
      menu.style.left = Math.max(8, Math.min(bounds.right - 62, innerWidth - 70)) + 'px';
    };
    remove.type = 'button';
    remove.innerHTML = removeIcon;
    remove.className = 'danger facility-icon';
    remove.setAttribute('aria-label','Remove from roster');
    remove.title = 'Remove from roster';
    remove.onclick = () => {
      menu.hidePopover();
      removedPatient = patient;
      find('[data-remove-name]').textContent = patient.name;
      find('[data-remove-site]').textContent = facilityNames.get(currentSite) + (currentSite === 'pleasantview' ? ' · ' + pleasantviewGroups.get(patient.group) : '');
      removeDialog.querySelector('[role=alert]').textContent = '';
      removeDialog.showModal();
    };
    menu.append(remove);
    actions.append(button,menu);
  }
  function render() {
    const query = search.value.trim().toLowerCase();
    groupHost.replaceChildren();
    const groups = currentSite === 'pleasantview' ? [...pleasantviewGroups] : [[currentSite,'']];
    for (const [key,title] of groups) {
      const section = document.createElement('section'), members = patients.filter(p => p.group === key);
      const visible = members.filter(p => [p.name,p.phn,p.ava].some(value => value?.toLowerCase().includes(query)));
      section.className = 'facility-group';
      if (title) {
        const heading = document.createElement('h2');
        heading.textContent = title + ' · ' + members.length;
        section.append(heading);
      }
      if (visible.length) {
        const wrapper = document.createElement('div');
        wrapper.className = 'clinic-table-wrap';
        wrapper.innerHTML = '<table class="clinic-table facility-table"><thead><tr><th scope="col">#</th><th scope="col">Patient</th><th scope="col">PHN</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody></tbody></table>';
        visible.forEach(patient => patientRow(wrapper.querySelector('tbody'),patient,patients.indexOf(patient)));
        section.append(wrapper);
      } else {
        const empty = document.createElement('p');
        empty.textContent = query ? 'No matching patients.' : 'No patients on this roster.';
        section.append(empty);
      }
      groupHost.append(section);
    }
    count.textContent = patients.length + (patients.length === 1 ? ' patient' : ' patients');
    count.hidden = false;
    notice.textContent = '';
  }
  async function load(site, options) {
    if (saving || dialog.open || removeDialog.open) return;
    const version = ++request, adapter = connection(), preserve = site === currentSite && adapter === loadedAdapter && account(adapter) === loadedAccount && snapshot;
    ready(false);
    linkButton.hidden = true;
    if (!preserve) {
      snapshot = loadedAdapter = null;
      patients = [];
      groupHost.replaceChildren();
      count.hidden = true;
      search.value = '';
    }
    currentSite = site;
    find('h1').textContent = facilityNames.get(site);
    notice.textContent = preserve ? 'Refreshing roster…' : 'Loading roster…';
    try {
      if (!adapter) throw new Error('Connect patient records, then reload the roster.');
      const result = await session.load(site,options);
      if (version !== request) return;
      patients = sitePatients(result.roster,site);
      snapshot = result;
      loadedAdapter = adapter;
      loadedAccount = account(adapter);
      render();
      ready(true);
    } catch (error) {
      if (version !== request) return;
      const access = [401,403,404].includes(error.status);
      linkButton.hidden = !access;
      linkButton.textContent = 'Connect ' + facilityNames.get(site) + ' roster';
      notice.textContent = access ? 'Connect this roster to Work OS to load it on your computers.' : error.message;
      if (preserve) notice.textContent += ' Showing the last loaded list.';
    }
  }
  search.oninput = () => {
    if (!snapshot) return;
    const message = notice.textContent;
    render();
    ready(editable);
    if (!editable) notice.textContent = message;
  };
  find('[data-reload]').onclick = () => load(currentSite,{refresh:true});
  linkButton.onclick = async () => {
    linkButton.disabled = true;
    try { await link(fileForSite(currentSite),() => load(currentSite,{refresh:true})); }
    catch (error) { notice.textContent = error.message; }
    finally { linkButton.disabled = false; }
  };
  async function refresh(options) {
    if (saving || dialog.open || removeDialog.open) return;
    // Start both private-file reads after connection, without delaying the main roster.
    // The selected tab joins the same pending read instead of issuing a second download.
    return Promise.allSettled(['carrington','pleasantview'].map(site =>
      currentSite && fileForSite(currentSite) === fileForSite(site)
        ? load(currentSite,options) : session.load(site,options)));
  }
  return {load,refresh,state:()=>({busy:saving,dirty:false})};
}
