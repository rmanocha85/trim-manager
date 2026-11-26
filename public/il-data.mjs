export const facilityNames = new Map([
  ['carrington', 'Carrington'],
  ['cedarbrook', 'Cedarbrook'],
  ['the-cedars', 'The Cedars']
]);
export const rosterFileId = '1F5HLYKiPHbZb0u5amzTkfnwJKgO0wa8E';

export function sitePatients(data, site) {
  const rows = data?.sites?.[site]?.patients;
  if (!facilityNames.has(site) || data?.schemaVersion !== 1 || !Array.isArray(rows)) {
    throw new Error('A verified roster is unavailable for this site.');
  }
  for (const row of rows) {
    if (typeof row?.name !== 'string' || !row.name.trim() || typeof row.ava !== 'string' ||
        !/^\d{6,10}$/.test(row.ava) || (row.phn != null && (typeof row.phn !== 'string' || !/^\d{10}$/.test(row.phn)))) {
      throw new Error('The site roster contains an invalid patient record.');
    }
  }
  return rows;
}

export function addFacilityPatient(data, site, input) {
  const rows = sitePatients(data, site);
  const name = String(input?.name ?? '').trim();
  const ava = String(input?.ava ?? '').trim();
  const phn = String(input?.phn ?? '').replace(/[\s-]/g, '') || null;
  const dob = String(input?.dob ?? '').trim() || null;
  if (!name || !/^\d{6,10}$/.test(ava)) throw new Error('Enter a name and a valid Ava chart number.');
  if (phn && !/^\d{10}$/.test(phn)) throw new Error('Enter a ten-digit PHN or leave it blank.');
  if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) ||
      new Date(dob).toISOString().slice(0,10) !== dob || dob > new Date().toISOString().slice(0,10))) {
    throw new Error('Enter a valid date of birth.');
  }
  if (rows.some(p => p.ava === ava || (phn && p.phn === phn))) {
    throw new Error('A patient with this Ava number or PHN is already on this site roster.');
  }
  const next = structuredClone(data);
  next.sites[site].patients.push({name,ava,phn,dob,source:'manual'});
  return next;
}

const localUrl = '/api/il/rosters';
const driveUrl = 'https://www.googleapis.com/drive/v2/files/' + rosterFileId;
export async function readFacilityRosters(adapter) {
  if (adapter.mode === 'local') return adapter.request(localUrl);
  const revision = () => adapter.request(driveUrl + '?fields=id,etag');
  for (let i = 0; i < 3; i++) {
    const before = await revision();
    const roster = await adapter.request(driveUrl + '?alt=media');
    if (before.etag && before.etag === (await revision()).etag) return {roster,etag:before.etag};
  }
  throw new Error('The roster changed while loading. Reload and try again.');
}
export async function saveFacilityPatient(adapter, snapshot, site, input) {
  const roster = addFacilityPatient(snapshot.roster,site,input);
  const headers = {'Content-Type':'application/json','If-Match':snapshot.etag};
  if (adapter.mode === 'local') {
    return adapter.request(localUrl,{method:'POST',headers,body:JSON.stringify({site,patient:input})});
  }
  await adapter.request('https://www.googleapis.com/upload/drive/v2/files/' + rosterFileId + '?uploadType=media',
    {method:'PUT',headers,body:JSON.stringify(roster)});
  const saved = await readFacilityRosters(adapter);
  const expected = roster.sites[site].patients.at(-1);
  const actual = sitePatients(saved.roster,site).find(p => p.ava === expected.ava);
  if (!actual || ['name','phn','dob'].some(key => actual[key] !== expected[key])) {
    throw new Error('The saved patient could not be verified. Reload the roster before retrying.');
  }
  return saved;
}
