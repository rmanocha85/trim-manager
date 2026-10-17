import {BackupManager,DriveBackups,LocalBackups,snapshot,validateSnapshot,writeLocal} from './backups.mjs?v=20261012-backup1';
import {loadRecovery,saveRecovery,getBackupDirectory,setBackupDirectory} from './recovery.mjs?v=20261012-backup1';
import {validateLedger,escapeHTML as esc} from './core.mjs?v=20261011-review1';
export function backupUI({state,restore,showSettings}){
  const card=document.createElement('section');card.className='card';card.id='backup-settings';
  card.innerHTML=`<h2>Billing backups</h2><p id="backup-state" role="status">Connect Google Drive to check backups.</p><p>Each saved version is backed up as a complete private JSON. Backups run in the background. Older copies are removed after three calendar months, only after a successful backup. Billing history is not deleted.</p><p>Drive: TRIM AI / Backups / Billing</p><p id="backup-folder">Independent backup: not enabled on this computer.</p><div class="actions"><button id="backup-enable">Enable laptop backup…</button><button id="backup-retry">Retry / catch up backups</button><button id="backup-disable" hidden>Stop laptop backups here</button></div><p class="hint">Enable only on your laptop. Choose C:\\Users\\rmano\\TRIM-Backups\\Billing, outside Drive and OneDrive. Use an encrypted, locked computer. Chrome may ask for folder permission again.</p><details><summary>Restore a billing backup</summary><p>Recovery replaces the complete billing file, including history and batch status. Save or discard local edits first. A safety copy is made before replacement.</p><button id="backup-list">Load Drive backups</button><label>Saved version<select id="backup-choice"><option value="">Choose a backup</option></select></label><button id="backup-preview">Review selected backup</button><label>Or choose a local billing JSON<input id="backup-upload" type="file" accept=".json,application/json"></label><p id="backup-preview-info"></p><button id="backup-restore" class="danger" disabled>Restore this version…</button></details>`;
  document.querySelector('#settings .settings-grid').append(card);
  const shortcut=document.createElement('button');shortcut.className='nav';shortcut.dataset.tab='settings';shortcut.textContent='Backups';shortcut.addEventListener('click',()=>{showSettings();card.scrollIntoView({block:'nearest'});});document.querySelector('aside nav').append(shortcut);
  const $=id=>card.querySelector('#'+id);let manager,files=[],preview=null;
  const driveLocation=[...card.querySelectorAll('p')].find(p=>p.textContent.startsWith('Drive:'));
  driveLocation.textContent='Drive: TRIM AI / Backups / Billing when accessible; otherwise a private TRIM Billing Backups folder in My Drive.';
  const report=(text,warn=false)=>{if(state().adapter?.mode==='local')text=text.replace('Drive backup verified','Drive-folder backup verified')+(text.includes('verified')?' · cloud sync unverified':'');$('backup-state').textContent=text;shortcut.textContent=warn?'Backups · needs attention':text.startsWith('Backing')?'Backups · working':'Backups';shortcut.style.color=warn?'#9a4a12':'';if(manager?.drive.rootId){driveLocation.innerHTML='<a target="_blank" rel="noopener" href="https://drive.google.com/drive/folders/'+encodeURIComponent(manager.drive.rootId)+'">Open private Drive backup folder</a>';}};
  const safe=fn=>async()=>{try{await fn();}catch(e){report(e.message,true);}};
  function folderLabel(){const enabled=Boolean(manager?.directory);$('backup-folder').textContent=enabled?'Independent backup folder on this computer: '+manager.directory.name:'Independent backup: not enabled on this computer.';$('backup-disable').hidden=!enabled;}
  async function capture(ledger){if(!manager)return;try{await manager.capture(ledger);}catch(e){report('Billing saved, but backup queue failed: '+e.message,true);}}
  async function connected(adapter,ledger){
    manager?.stop();manager=null;preview=null;$('backup-restore').disabled=true;
    driveLocation.textContent=adapter.mode==='local'?'Laptop Drive folder: TRIM AI / Backups / Billing. Cloud sync is unverified.':'Drive: use the private backup folder link.';
    try{
      manager=await new BackupManager({drive:adapter.mode==='local'?new LocalBackups(adapter):new DriveBackups(adapter),load:loadRecovery,save:saveRecovery,directory:await getBackupDirectory(),onStatus:report}).init(ledger);
      folderLabel();await capture(ledger);
    }catch(e){report('Backup setup needs attention: '+e.message,true);}
  }
  $('backup-enable').onclick=safe(async()=>{
    if(!manager)throw new Error('Open the workspace first.');
    if(!window.showDirectoryPicker)throw new Error('Use Chrome on your laptop, or download a private backup in Settings.');
    const directory=await window.showDirectoryPicker({id:'trim-billing-backups',mode:'readwrite'});
    if(!confirm('Use this folder for independent patient-data backups? Confirm it is outside Google Drive / OneDrive and on your trusted encrypted laptop.'))return;
    await setBackupDirectory(directory);manager.directory=directory;manager.localVerified.clear();folderLabel();await capture(state().saved);
  });
  $('backup-disable').onclick=safe(async()=>{if(!confirm('Stop independent backups on this computer? Existing backup files will be kept.'))return;await setBackupDirectory(null);manager?.stop();await connected(state().adapter,state().saved);});
  $('backup-retry').onclick=safe(async()=>{
    if(!manager)throw new Error('Open the workspace first.');
    if(manager.directory&&await manager.directory.queryPermission({mode:'readwrite'})!=='granted')await manager.directory.requestPermission({mode:'readwrite'});
    manager.localVerified.clear();await capture(state().saved);
  });
  $('backup-list').onclick=safe(async()=>{
    if(!manager)throw new Error('Open the workspace first.');
    files=(await manager.drive.list(manager.dataset)).sort((a,b)=>b.appProperties.date.localeCompare(a.appProperties.date));
    $('backup-choice').innerHTML='<option value="">Choose a backup</option>'+files.map((f,i)=>`<option value="${i}">${esc(new Date(f.appProperties.date).toLocaleString('en-CA',{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</option>`).join('');
  });
  function showPreview(l){preview=l;$('backup-preview-info').textContent=`Saved ${l.updatedAt?new Date(l.updatedAt).toLocaleString(): 'date unknown'} · ${l.entries.length} patient/date entries · ${l.entries.reduce((n,e)=>n+e.items.length,0)} charges · ${l.batches.length} closed batches. This will replace, not merge, current billing.`;$('backup-restore').disabled=false;}
  const clearPreview=()=>{preview=null;$('backup-restore').disabled=true;$('backup-preview-info').textContent='';};
  $('backup-choice').onchange=clearPreview;
  $('backup-preview').onclick=safe(async()=>{clearPreview();const f=files[$('backup-choice').value];if(!f)throw new Error('Choose a backup first.');showPreview(await validateSnapshot(await manager.drive.read(f),manager.dataset,f.appProperties.sha));});
  $('backup-upload').onchange=safe(async()=>{clearPreview();const file=$('backup-upload').files[0];if(!file)return;if(file.size>8_000_000)throw new Error('File too large.');if(!manager)throw new Error('Connect the billing file first.');showPreview(await validateSnapshot(await file.text(),manager.dataset));});
  $('backup-restore').onclick=safe(async()=>{
    if(!preview||!manager)throw new Error('Review a backup first.');
    const s=state();if(s.dirty||s.busy)throw new Error('Save or discard local changes and finish the current save first.');
    validateLedger(preview);
    if(!confirm('Replace the COMPLETE billing file with this reviewed backup? Later billing and handoff status will be replaced. The current saved file will be backed up first.'))return;
    const selected=structuredClone(preview),active=manager;
    await restore(selected,async current=>{const safety=await snapshot(current);await active.drive.ensure(safety);if(active.directory)await writeLocal(active.directory,safety);});
    clearPreview();report('Backup restored. New backup is being prepared.');
  });
  return {connected,capture,busy:()=>Boolean(manager&&(manager.running||manager.pending?.length))};
}
