export const facilityNames = new Map([
  ['carrington', 'Carrington'],
  ['cedarbrook', 'Cedarbrooke'],
  ['the-cedars', 'The Cedars'],
  ['pleasantview', 'Pleasantview']
]);
export const rosterFileId = '1F5HLYKiPHbZb0u5amzTkfnwJKgO0wa8E';
export const pleasantviewFileId = '1Kj6NwI4nFLj2Hjhs4OJx7wq5V79KVx8c';
export const pleasantviewGroups = new Map([
  ['pleasantview_rc', 'Residential Care (RC)'],
  ['pleasantview_al', 'Assisted Living (AL)']
]);
export const fileForSite = site => site === 'pleasantview' ? pleasantviewFileId : rosterFileId;
export const pathForSite = site => site === 'pleasantview' ? '/api/pleasantview/roster' : '/api/il/rosters';

function containers(data, site) {
  if (!facilityNames.has(site) || data?.schemaVersion !== 1) throw new Error('Unrecognized facility roster.');
  const entries = site === 'pleasantview' ? [...pleasantviewGroups.keys()].map(key => [key,data.groups?.[key]]) : [[site,data.sites?.[site]]];
  if (entries.some(([,value]) => !Array.isArray(value?.patients))) throw new Error('A verified roster is unavailable for this site.');
  return entries;
}
function displayPatient(patient, group) {
  return {...patient,ava:String(patient.ava ?? patient.emrNumber ?? '').trim(),phn:patient.phn || null,group};
}
export function sitePatients(data, site) {
  const rows = containers(data,site).flatMap(([group,value]) => value.patients.map(p => displayPatient(p,group)));
  for (const row of rows) {
    if (typeof row.name !== 'string' || !row.name.trim() || !/^\d{6,10}$/.test(row.ava) ||
        (row.phn != null && (typeof row.phn !== 'string' || !/^\d{10}$/.test(row.phn)))) {
      throw new Error('The site roster contains an invalid patient record.');
    }
  }
  return rows;
}
function groupContainer(data, site, group) {
  const entry = containers(data,site).find(([key]) => key === (site === 'pleasantview' ? group : site));
  if (!entry) throw new Error('Choose Residential Care or Assisted Living.');
  return entry[1];
}
export function addFacilityPatient(data, site, input) {
  const rows = sitePatients(data,site);
  const name = String(input?.name ?? '').trim(), ava = String(input?.ava ?? '').trim();
  const phn = String(input?.phn ?? '').replace(/[\s-]/g,'') || null;
  const dob = String(input?.dob ?? '').trim() || null;
  if (!name || !/^\d{6,10}$/.test(ava)) throw new Error('Enter a name and a valid Ava chart number.');
  if (phn && !/^\d{10}$/.test(phn)) throw new Error('Enter a ten-digit PHN or leave it blank.');
  if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) ||
      new Date(dob).toISOString().slice(0,10) !== dob || dob > new Date().toISOString().slice(0,10))) throw new Error('Enter a valid date of birth.');
  if (rows.some(p => p.ava === ava || (phn && p.phn === phn))) throw new Error('A patient with this Ava number or PHN is already on this site roster.');
  const next = structuredClone(data);
  const target = groupContainer(next,site,input.group);
  target.patients.push({name,...(site === 'pleasantview' ? {emrNumber:ava} : {ava}),phn,dob,source:'manual'});
  for (const [,value] of containers(next,site)) {
    if (value.removedPatients) value.removedPatients = value.removedPatients.filter(p => String(p.ava ?? p.emrNumber) !== ava);
  }
  return next;
}
export function applyFacilityAction(data, site, action) {
  if (action.type === 'add') return addFacilityPatient(data,site,action.patient);
  if (action.type !== 'remove') throw new Error('Unknown roster action.');
  const patient = sitePatients(data,site).find(p => p.ava === action.ava && p.group === action.group);
  if (!patient) throw new Error('This patient is no longer on the roster. Reload the list.');
  const next = structuredClone(data), target = groupContainer(next,site,patient.group);
  const index = target.patients.findIndex(p => String(p.ava ?? p.emrNumber) === patient.ava);
  const [removed] = target.patients.splice(index,1);
  target.removedPatients = [...(target.removedPatients || []),removed];
  return next;
}
export async function readFacilityRosters(adapter, site = 'carrington') {
  await adapter.ensureConnected?.();
  if (adapter.mode === 'local') return adapter.request(pathForSite(site));
  const url = 'https://www.googleapis.com/drive/v2/files/' + fileForSite(site);
  for (let i = 0; i < 3; i++) {
    const before = await adapter.request(url + '?fields=id,etag');
    const roster = await adapter.request(url + '?alt=media');
    const after = await adapter.request(url + '?fields=id,etag');
    if (before.etag && before.etag === after.etag) return {roster,etag:after.etag};
  }
  throw new Error('The roster changed while loading. Reload and try again.');
}
export async function saveFacilityAction(adapter, snapshot, site, action) {
  if (!snapshot?.etag) throw new Error('Reload the roster before editing.');
  const roster = applyFacilityAction(snapshot.roster,site,action);
  await adapter.ensureConnected?.();
  const headers = {'Content-Type':'application/json','If-Match':snapshot.etag};
  if (adapter.mode === 'local') return adapter.request(pathForSite(site),{method:'POST',headers,body:JSON.stringify({site,...action})});
  await adapter.request('https://www.googleapis.com/upload/drive/v2/files/' + fileForSite(site) + '?uploadType=media',
    {method:'PUT',headers,body:JSON.stringify(roster)});
  const saved = await readFacilityRosters(adapter,site);
  const actual = sitePatients(saved.roster,site).find(p => p.ava === (action.ava || action.patient.ava.trim()));
  if (action.type === 'remove' ? !!actual : !actual || ['name','phn','dob'].some(key =>
      actual[key] !== sitePatients(roster,site).find(p => p.ava === actual.ava)[key])) {
    throw new Error('The change could not be verified. Reload before retrying.');
  }
  return saved;
}
export function saveFacilityPatient(adapter,snapshot,site,patient) {
  return saveFacilityAction(adapter,snapshot,site,{type:'add',patient});
}
