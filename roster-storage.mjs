import {readFile, writeFile, mkdir, open, rename, unlink, readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {normalize, expire, today} from './public/patients-core.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
const conflict = message => Object.assign(new Error(message), {status:409});
const snapshotName = () => `trim-patients-${today()}.json`;
const validSnapshot = name => /^trim-patients-\d{4}-(?:\d{2}|[A-Z]{3})-\d{2}\.json$/.test(name);

export class RosterStore {
  constructor(filename, lockDirectory, snapshotDirectories) {
    this.filename = filename; this.lock = path.join(lockDirectory, hash(path.resolve(filename)) + '.roster.lock');
    this.snapshotDirectories = snapshotDirectories;
  }
  async load() {
    const text = await readFile(this.filename, 'utf8');
    const roster = JSON.parse(text); normalize(roster);
    return {roster, etag:hash(text)};
  }
  async save(roster, expected) {
    if (!expected) throw conflict('A verified roster revision is required.');
    const next = expire(roster); // Expiry is staged only by an explicit Save to Drive.
    await mkdir(path.dirname(this.lock), {recursive:true});
    let lock;
    try { lock = await open(this.lock, 'wx'); } catch (e) { if(e.code === 'EEXIST') throw conflict('Another roster save is running. Retry when it finishes.'); throw e; }
    const temporary = this.filename + '.' + randomUUID() + '.tmp';
    try {
      const current = await this.load();
      if(JSON.stringify(normalize(current.roster))===JSON.stringify(next))return current;
      if (current.etag !== expected) throw conflict('The roster changed elsewhere. Your local changes are retained. Review or reload TRIM Patients before saving.');
      const folder = this.snapshotDirectories[0]; await mkdir(folder, {recursive:true});
      const snapshot = path.join(folder, snapshotName());
      try { await writeFile(snapshot, JSON.stringify({...current.roster, snapshotDate:snapshotName()}), {flag:'wx'}); }
      catch(e) { if(e.code !== 'EEXIST') throw e; }
      const text = JSON.stringify(next, null, 2);
      const file = await open(temporary, 'wx');
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      if ((await this.load()).etag !== expected) throw conflict('The roster changed during saving. No replacement was made.');
      await rename(temporary, this.filename);
      const saved = await this.load();
      if (saved.etag !== hash(text)) throw conflict('Roster readback differs. Keep this tab open and reconcile before saving again.');
      return saved;
    } finally { await unlink(temporary).catch(() => {}); await lock.close(); await unlink(this.lock).catch(() => {}); }
  }
  async snapshots() {
    const files = [];
    for (let index = 0; index < this.snapshotDirectories.length; index++) {
      const folder = this.snapshotDirectories[index];
      let names; try { names = await readdir(folder); } catch(e) { if(e.code === 'ENOENT') continue; throw e; }
      for (const name of names.filter(validSnapshot)) files.push({id:`${index}:${name}`, name});
    }
    return files.sort((a,b) => b.name.localeCompare(a.name));
  }
  async snapshot(id) {
    const match = /^(\d+):(.+)$/.exec(id || '');
    if (!match || !validSnapshot(match[2]) || !this.snapshotDirectories[Number(match[1])]) throw new Error('Invalid snapshot identifier.');
    return JSON.parse(await readFile(path.join(this.snapshotDirectories[Number(match[1])], match[2]), 'utf8'));
  }
}
