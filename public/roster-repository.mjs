import {normalize, expire, today} from './patients-core.mjs';
const ROSTER = '1AaGORl08dctBiZiLAEshmnIMJ6U_GBX3';
const V2 = 'https://www.googleapis.com/drive/v2/files';
const V3 = 'https://www.googleapis.com/drive/v3/files';
export class RosterRepository {
  constructor(adapter) { this.adapter=adapter; this.mode=adapter.mode; }
  request(url, options) { return this.adapter.request(url, options); }
  async load() {
    if(this.mode==='local') return this.request('/api/roster/document');
    for(let attempt=0;attempt<3;attempt++) {
      const before=await this.request(`${V2}/${ROSTER}?fields=id,etag`);
      const roster=await this.request(`${V2}/${ROSTER}?alt=media`);
      const after=await this.request(`${V2}/${ROSTER}?fields=id,etag`);
      if(before.etag && before.etag===after.etag) { normalize(roster); return {roster,etag:after.etag}; }
    }
    throw new Error('Roster changed while loading. Retry.');
  }
  async save(roster,etag) {
    if(!etag) throw new Error('A verified roster revision is required.');
    const next=expire(roster);
    if(this.mode==='local') return this.request('/api/roster/document',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(next)});
    const current=await this.load();
    if(JSON.stringify(normalize(current.roster))===JSON.stringify(next))return current;
    if(current.etag!==etag) throw Object.assign(new Error('Roster changed elsewhere. Your local changes are retained.'),{status:409});
    await this.saveSnapshot(current.roster);
    await this.request(`https://www.googleapis.com/upload/drive/v2/files/${ROSTER}?uploadType=media`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(next)});
    const result=await this.load();
    if(JSON.stringify(result.roster)!==JSON.stringify(next)) throw Object.assign(new Error('Roster save could not be verified. Your local copy is retained.'),{status:409});
    return result;
  }
  async snapshotFolder(create=false) {
    if(this.folder) return this.folder;
    const q=encodeURIComponent("name = 'TRIM Snapshots' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const result=await this.request(`${V3}?q=${q}&fields=files(id,name),nextPageToken`);
    if(result.nextPageToken || result.files?.length>1) throw new Error('Multiple snapshot folders found. Resolve their locations before saving the roster.');
    if(result.files?.length) return this.folder=result.files[0].id;
    if(!create) return null;
    const folder=await this.request(V3,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'TRIM Snapshots',mimeType:'application/vnd.google-apps.folder'})});
    return this.folder=folder.id;
  }
  async snapshots() {
    if(this.mode==='local') return this.request('/api/roster/snapshots');
    const folder=await this.snapshotFolder(); if(!folder) return [];
    const files=[]; let token;
    do { const q=encodeURIComponent(`'${folder}' in parents and trashed = false`); const result=await this.request(`${V3}?q=${q}&fields=files(id,name),nextPageToken&pageSize=1000${token?'&pageToken='+encodeURIComponent(token):''}`); files.push(...result.files||[]); token=result.nextPageToken; } while(token);
    return files.sort((a,b)=>b.name.localeCompare(a.name));
  }
  snapshot(id) { return this.mode==='local'?this.request('/api/roster/snapshot?id='+encodeURIComponent(id)):this.request(`${V3}/${encodeURIComponent(id)}?alt=media`); }
  async saveSnapshot(roster) {
    const folder=await this.snapshotFolder(true), name=`trim-patients-${today()}.json`;
    if((await this.snapshots()).some(f=>f.name===name)) return;
    const boundary='trim_'+crypto.randomUUID();
    const data=JSON.stringify({...roster,snapshotDate:name});
    const metadata=JSON.stringify({name,mimeType:'application/json',parents:[folder]});
    const body=`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${data}\r\n--${boundary}--`;
    const saved=await this.request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`,{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
    if(JSON.stringify(await this.snapshot(saved.id))!==data) throw new Error('Daily roster snapshot could not be verified.');
  }
}
