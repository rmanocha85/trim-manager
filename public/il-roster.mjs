import {bindIdentity, nameHTML, phnHTML} from './patient-identity.mjs?v=20261119-most-connection1';

import {facilityNames, rosterFileId, sitePatients, readFacilityRosters, saveFacilityPatient} from './il-data.mjs';
export {facilityNames};

export function facilityRoster(host, connection, link) {
  host.innerHTML = `<div class="clinic-heading"><h1></h1><span class="clinic-count" hidden></span></div>
    <div class="clinic-toolbar"><input type="search" placeholder="Search name, PHN or Ava number" aria-label="Search facility roster" autocomplete="off">
    <button type="button" data-add disabled>Add patient</button><button type="button" data-reload>Reload roster</button></div>
    <p role="status"></p><button type="button" data-link hidden>Link facility rosters</button>
    <div class="clinic-table-wrap" hidden><table class="clinic-table"><thead><tr><th scope="col">Patient</th><th scope="col">PHN</th><th scope="col">Ava number</th></tr></thead><tbody></tbody></table></div>
    <dialog class="clinic-planning-dialog" aria-labelledby="il-add-title"><form>
      <h2 id="il-add-title"></h2>
      <label>Patient name<input name="name" required autocomplete="off" placeholder="Last name, First name"></label>
      <label>Ava chart number<input name="ava" required inputmode="numeric" pattern="[0-9]{6,10}" autocomplete="off"></label>
      <label>PHN (optional)<input name="phn" inputmode="numeric" autocomplete="off"></label>
      <label>Date of birth (optional)<input name="dob" type="date" data-native-date></label>
      <p class="planning-error" role="alert"></p>
      <div class="actions"><button type="button" data-cancel>Cancel</button><button type="submit">Add patient</button></div>
    </form></dialog>`;
  bindIdentity(host);
  const find = selector => host.querySelector(selector);
  const notice = find('p'), search = find('input'), table = find('.clinic-table-wrap'), count = find('.clinic-count');
  const linkButton = find('[data-link]');
  const dialog = find('dialog'), form = find('form'), addButton = find('[data-add]');
  let currentSite, request = 0, patients = [], snapshot, loadedAdapter, saving = false;
  addButton.onclick = () => {
    form.reset();
    dialog.querySelector('h2').textContent = 'Add patient to ' + facilityNames.get(currentSite);
    form.querySelector('[role=alert]').textContent = '';
    dialog.showModal();
    form.elements.namedItem('name').focus();
  };
  find('[data-cancel]').onclick = () => dialog.close();
  dialog.oncancel = event => { if (saving) event.preventDefault(); };
  form.onsubmit = async event => {
    event.preventDefault();
    if (saving) return;
    const alert = form.querySelector('[role=alert]');
    const buttons = [...form.querySelectorAll('button')];
    const input = Object.fromEntries(new FormData(form));
    try {
      if (connection() !== loadedAdapter) throw new Error('Connection changed. Close the form and reload this roster.');
      saving = true;
      buttons.forEach(button => button.disabled = true);
      alert.textContent = 'Saving…';
      const saved = await saveFacilityPatient(loadedAdapter,snapshot,currentSite,input);
      snapshot = saved;
      patients = sitePatients(saved.roster,currentSite);
      search.value = '';
      dialog.close();
      render();
      notice.textContent = 'Patient added to ' + facilityNames.get(currentSite) + '.';
    } catch (error) { alert.textContent = error.message; }
    finally { saving = false; buttons.forEach(button => button.disabled = false); }
  };
  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = patients.filter(p => [p.name,p.phn,p.ava].some(value => value?.toLowerCase().includes(query)));
    const body = find('tbody');
    body.replaceChildren();
    for (const patient of visible) {
      const row = body.insertRow();
      row.insertCell().innerHTML = nameHTML(patient);
      row.insertCell().innerHTML = phnHTML(patient);
      const cell = row.insertCell();
      cell.append(patient.ava + ' ');
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'identity-copy';
      copy.dataset.copyValue = patient.ava;
      copy.dataset.copyFeedback = 'Ava number copied';
      copy.setAttribute('aria-label', 'Copy Ava number for ' + patient.name);
      copy.title = 'Copy Ava number';
      copy.append(row.querySelector('.name-copy svg').cloneNode(true));
      cell.append(copy);
    }
    count.textContent = patients.length + (patients.length === 1 ? ' patient' : ' patients');
    count.hidden = false;
    notice.textContent = visible.length ? '' : (patients.length ? 'No matching patients.' : 'No patients on this roster.');
    table.hidden = !visible.length;
  }
  async function load(site) {
    if (dialog.open) return;
    const version = ++request;
    addButton.disabled = true;
    snapshot = loadedAdapter = null;
    if (currentSite !== site) search.value = '';
    currentSite = site;
    patients = [];
    find('tbody').replaceChildren();
    count.hidden = table.hidden = linkButton.hidden = true;
    find('h1').textContent = facilityNames.get(site);
    notice.textContent = 'Loading roster…';
    const adapter = connection();
    try {
      if (!adapter) throw new Error('Connect patient records, then reload the roster.');
      const result = await readFacilityRosters(adapter);
      if (version !== request) return;
      patients = sitePatients(result.roster,site);
      snapshot = result;
      loadedAdapter = adapter;
      addButton.disabled = false;
      render();
    } catch (error) {
      if (version !== request) return;
      linkButton.hidden = !(adapter?.hostedAccess && [403,404].includes(error.status));
      notice.textContent = linkButton.hidden ? error.message : 'Link the private roster file to open it in TRIM.';
    }
  }
  search.oninput = () => { if (!count.hidden) render(); };
  find('[data-reload]').onclick = () => load(currentSite);
  linkButton.onclick = async () => {
    linkButton.disabled = true;
    try { await link(rosterFileId, () => load(currentSite)); }
    catch (error) { notice.textContent = error.message; }
    finally { linkButton.disabled = false; }
  };
  return {load};
}
