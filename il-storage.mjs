import {open, readFile, rename, unlink} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {addFacilityPatient} from './public/il-data.mjs';

export async function readFacilityFile(filename) {
  const bytes = await readFile(filename);
  return {roster:JSON.parse(bytes.toString('utf8')),etag:createHash('sha256').update(bytes).digest('hex')};
}

export async function addToFacilityFile(filename, expected, site, patient) {
  const conflict = () => Object.assign(new Error('Roster changed or is being updated. Reload before retrying.'),{status:409});
  const lockFile = filename + '.import-lock';
  let lock;
  try { lock = await open(lockFile,'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error; }
  const temp = filename + '.' + randomUUID() + '.tmp';
  try {
    const current = await readFacilityFile(filename);
    if (!expected || current.etag !== expected) throw conflict();
    const next = addFacilityPatient(current.roster,site,patient);
    const file = await open(temp,'wx');
    try { await file.writeFile(JSON.stringify(next,null,2)); await file.sync(); }
    finally { await file.close(); }
    if ((await readFacilityFile(filename)).etag !== expected) throw conflict();
    await rename(temp,filename);
    const saved = await readFacilityFile(filename);
    if (JSON.stringify(saved.roster) !== JSON.stringify(next)) throw conflict();
    return saved;
  } finally {
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(lockFile);
  }
}
