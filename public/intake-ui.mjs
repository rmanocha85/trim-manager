import {incomingLabel,incomingMessage} from './incoming-request.mjs?v=20261111-intake-status1';
import {typedHistorySource,clipboardImages} from './intake-sources.mjs?v=20261111-roster1';
import {identityHTML} from './patient-identity.mjs?v=20261119-most-connection1';
import {DriveIntake} from './intake-drive.mjs?v=20261111-best-effort1';
import {DriveNotesRepository,LocalNotesRepository,savePatientBirthDate} from './notes-storage.mjs?v=20261117-profile1';
import {setProfileDisplay} from './profile-display.mjs?v=20261119-most-connection1';
import {MAX_UPLOAD_BYTES,signatureMatches} from './intake-core.mjs?v=20261117-profile1';
import {escapeHTML as esc} from './core.mjs?v=20261119-export1';
import {LocalAdapter,DriveAdapter} from './adapters.mjs?v=20261119-most-connection1';
import {laptopRuntime} from './runtime.mjs';
export const PROFILE_FILE_ID='1UEPiPwQyd9wMswfem8lL6LIKwMn_ST3r';
const digest=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
const dataURL=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the selected file.'));reader.readAsDataURL(file);});
const needsAttention=item=>['held','error','identity-review','attention'].includes(item.status)||(item.status==='waiting'&&item.attempts>0)||(item.status!=='completed'&&((item.issues||[]).length||(item.items||[]).some(i=>i.status==='attention')));
export function documentIntakeUI({state,notes,onProfiles=()=>{},onProfileStatus=()=>{},onRecordsConnected=()=>{}}){
 let patient,files=[],busy=false,upload=null,timer=null,cloud,adapter,recordsAdapter,epoch=0,recordsNeeded=false;let previews=[];let incomingAttempt=null,trackedRequestId=null,processingPending=false;
 const dialog=document.createElement('dialog');dialog.id='document-intake';dialog.className='document-intake';document.body.append(dialog);
 function repo(){const a=state().adapter;if(!a)throw new Error('Connect your workspace first.');if(adapter!==a){adapter=a;recordsAdapter=null;cloud=a.mode==='cloud'&&!laptopRuntime()?new DriveIntake(a):null;}return a;}
 let localConnection;
 function local(){
   if(!localConnection){
     const connection=new LocalAdapter();
     localConnection=connection.connect().then(()=>connection).catch(error=>{localConnection=null;throw error;});
   }
   return localConnection;
 }
 const post=async(route,body)=>{let a=repo();if(a.mode!=='local'){if(!laptopRuntime())throw new Error('Open the laptop app to apply or retry analysis.');a=await local();}return a.request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});};
 const connectButton=document.createElement('button');connectButton.id='connect-patient-records';connectButton.className='text-button';connectButton.textContent='Connect patient records';connectButton.hidden=true;document.querySelector('.app-utility').append(connectButton);
 const permission=document.createElement('dialog');permission.id='patient-records-connection';permission.innerHTML='<div class="dialog-body"><h2>Connect patient records</h2><p>Load the existing MAID, OAT FH and OAT Purple rosters, read age and MOST from patient summaries, and upload documents to Routine notes / Incoming.</p><p>Google will ask for permission to see, edit, create and delete files in your Google Drive. This permission covers your whole Drive; TRIM uses it for your existing private TRIM, MAID and OAT clinic folders.</p><p>You can use the laptop app with its existing Drive folder instead.</p><p data-records-message role="status"></p><div class="actions"><button data-records-continue class="primary">Continue to Google</button><a href="http://127.0.0.1:4317/" target="_blank" rel="noopener">Open laptop app</a><button data-records-cancel>Cancel</button></div></div>';document.body.append(permission);
 connectButton.onclick=()=>permission.showModal();permission.querySelector('[data-records-cancel]').onclick=()=>permission.close();
 permission.querySelector('[data-records-continue]').onclick=async()=>{const button=permission.querySelector('[data-records-continue]'),out=permission.querySelector('[data-records-message]');button.disabled=true;out.textContent='Connecting…';try{const a=repo();if(a.mode!=='cloud'||!a.accountEmail)throw new Error('Reconnect billing with your usual Google account first.');const candidate=new DriveAdapter(a.fileId,{rosterId:a.rosterId});candidate.accountEmail=a.accountEmail;await candidate.connect({patientRecords:true});if(state().adapter!==a)throw new Error('Workspace changed. Connect patient records again.');recordsAdapter=candidate;recordsNeeded=false;cloud=new DriveIntake(candidate);await profiles();await onRecordsConnected();if(dialog.open)message('');await updateFooterQueue();if(dialog.open)await refresh();out.textContent='Connected.';permission.close();}catch(e){out.textContent=e.message;}finally{button.disabled=false;}};
 const message=(text,error=false,source='action')=>{const el=dialog.querySelector('[data-intake-message]');if(el){el.textContent=text;el.classList.toggle('error',error);el.dataset.source=source;}};
 function queueUnavailable(error){
  if(laptopRuntime()){queueState('Document intake · connection needed',true,error.message);return;}
  const label='Open TRIM Notes to process documents';
  queueState('');
  queueButton.setAttribute('aria-description',error.message);
  queueButton.setAttribute('aria-label',label);
  queueButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6M8 12h3m-3 4h6M14 3h7v7m0-7-8 8"/></svg>';
  queueButton.onclick=()=>document.getElementById('open-laptop-notes').click();
 }
 const queueState=(text,attention=false,title='')=>{queueButton.onclick=openQueue;queueButton.removeAttribute('aria-label');queueButton.removeAttribute('aria-description');queueButton.textContent=text;queueButton.classList.toggle('intake-attention',attention);queueButton.title=title;};
 const readQueue=async phn=>cloud?{jobs:await cloud.list(phn),requests:phn?[]:await cloud.incomingRequests()}:await (await local()).request('/api/intake'+(phn?'?phn='+phn:''));
 function updateQueue(result){
  const own=items=>(items||[]).filter(j=>j.datasetId===state().ledger?.datasetId),jobs=own(result.jobs),requests=own(result.requests);
  const attention=result.service?.error||jobs.some(needsAttention)||requests.some(needsAttention),pending=jobs.filter(j=>j.status!=='accepted').length;
  queueState(attention?'Document intake · needs attention':pending?'Document intake · '+pending+' processing':requests.some(r=>!['completed','attention'].includes(r.status))?'Document intake · waiting / processing':'Document intake',!!attention,result.service?.error||'');
 }
 let profileRequest=0,profileOwner,profileDataset;
 async function profiles({required=false}={}){
  const a=repo(),dataset=state().ledger?.datasetId,request=++profileRequest;
  const current=()=>request===profileRequest&&state().adapter===a&&state().ledger?.datasetId===dataset;
  if(profileOwner!==a||profileDataset!==dataset){
    profileOwner=a;profileDataset=dataset;setProfileDisplay(null,'loading');onProfiles();onProfileStatus('Loading MOST from patient histories…');
  }
  connectButton.hidden=!recordsNeeded;
  try{
    let data;
    if(laptopRuntime())data=await (await local()).request('/api/patient-display');
    else if(a.hostedAccess){
      // MOST must work through the renewable workspace connection. A separate
      // in-memory, broader document connection must not mask a missing file grant.
      const url='https://www.googleapis.com/drive/v3/files/'+PROFILE_FILE_ID;
      const file=await a.request(url+'?fields=name,trashed,permissions(role,type)');
      if(file.name!=='patient-display.json'||file.trashed||!file.permissions?.length||file.permissions.some(p=>p.role!=='owner'||p.type!=='user'))throw new Error('Check the private patient display file.');
      data=await a.request(url+'?alt=media');
    }else data=(await new DriveNotesRepository(recordsAdapter||a).load('patient-display.json')).data;
    if(!current()){if(required)throw new Error('The workspace changed while verifying MOST. Retry the connection.');return false;}
    if(!dataset||data?.datasetId!==dataset||data.app!=='trim-patient-display'||data.schema!==1||data.mostSchema!==1||!data.patients||typeof data.patients!=='object'||Array.isArray(data.patients))throw new Error('Patient display file is not synced for this workspace.');
    setProfileDisplay(data);onProfiles();onProfileStatus('');return true;
  }catch(error){
    if(!current()){if(required)throw error;return false;}
    setProfileDisplay(null,'unavailable');onProfiles();
    const link=!!(a.hostedAccess&&[403,404].includes(error.status));
    connectButton.hidden=laptopRuntime()||link;
    const reason=link?'TRIM cannot access the saved MOST file with this Google connection. Link MOST to restore it after reopening.':'MOST could not be loaded. '+error.message;
    onProfileStatus(reason,link?'link':'retry');
    if(required)throw new Error(reason);
    return false;
  }
 }
 function lock(value){busy=value;dialog.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=value);}
 function showFiles(){previews.forEach(url=>URL.revokeObjectURL(url));previews=[];dialog.querySelector('[data-intake-files]').innerHTML=files.map((f,i)=>{const url=f.type.startsWith('image/')?URL.createObjectURL(f):null;if(url)previews.push(url);return `<li>${url?'<img class="intake-preview" src="'+url+'" alt="Image selected for upload">':''}<span>${esc(f.name)} <small>${Math.ceil(f.size/1024)} KB</small></span> <button type="button" data-remove-file="${i}" aria-label="Remove ${esc(f.name)}">×</button></li>`;}).join('');dialog.querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=()=>{if(upload){message('Retry the current upload before changing its sources.',true);return;}files.splice(Number(b.dataset.removeFile),1);showFiles();});}
 async function pasteImage(){
  if(busy||upload)return;
  try{if(!navigator.clipboard?.read)throw new Error();const items=await navigator.clipboard.read(),incoming=[];
   for(const item of items){const type=item.types.find(t=>['image/png','image/jpeg','image/webp'].includes(t));if(type){const blob=await item.getType(type);incoming.push(new File([blob],'pasted-image-'+(files.length+incoming.length+1)+'.'+(type==='image/jpeg'?'jpg':type.split('/')[1]),{type}));}}
   if(!incoming.length){message('No image found. Copy a photo or screenshot, then paste it here.',true);return;}addFiles(incoming);
  }catch{message('Click the paste area and press Ctrl+V (or ⌘V on Mac) to paste your image.',true);dialog.querySelector('.intake-drop').focus();}
 }
 function hasDraft(){return files.length||dialog.querySelector('[data-intake-history]')?.value.trim();}
 function canClose(){return !busy&&(!hasDraft()||confirm('Discard this history and the selected attachments? They have not been submitted.'));}
 function addFiles(next){if(busy||upload)return;const all=[...files,...next];if(all.length>6||all.reduce((n,f)=>n+f.size,0)>MAX_UPLOAD_BYTES){message('Choose up to six files, 10 MB total.',true);return;}if(all.some(f=>!['application/pdf','image/png','image/jpeg','image/webp'].includes(f.type))){message('Choose PDF, PNG, JPG or WebP files.',true);return;}files=all;showFiles();message('');}
 async function refresh(){
  const ticket=epoch,phn=patient?.phn;if(!dialog.open)return;
  repo();let result;try{result=await readQueue(phn);}catch(e){queueUnavailable(e);e.intakeConnection=true;throw e;}const jobs=result.jobs;if(ticket!==epoch||!dialog.open)return;if(!phn)updateQueue(result);if(result.service?.error)message(result.service.error,true,'service');
  const requests=dialog.querySelector('[data-incoming-requests]'),ownRequests=(result.requests||[]).filter(r=>r.datasetId===state().ledger.datasetId);
  processingPending=ownRequests.some(r=>!['completed','attention'].includes(r.status))||jobs.some(j=>j.datasetId===state().ledger.datasetId&&!['accepted','held','error','identity-review'].includes(j.status));
  const tracked=ownRequests.find(r=>r.id===trackedRequestId),source=dialog.querySelector('[data-intake-message]')?.dataset.source;
  if(requests&&tracked&&!result.service?.error&&['request','service','connection'].includes(source))message(incomingLabel(tracked.status,!cloud)+': '+incomingMessage(tracked,!cloud),!!needsAttention(tracked),'request');
  else if(!result.service?.error&&['service','connection'].includes(source))message('');
  if(requests){requests.innerHTML=ownRequests.map(r=>'<article class="intake-job" data-intake-attention="'+!!needsAttention(r)+'" data-incoming-status="'+esc(r.status)+'"><strong>'+esc(incomingLabel(r.status,!cloud))+(needsAttention(r)&&r.status!=='attention'?' · Needs attention':'')+'</strong><p>'+esc(incomingMessage(r,!cloud))+'</p><small>'+esc(new Date(r.createdAt).toLocaleString())+'</small>'+[...r.issues,...(r.items||[]).filter(i=>i.message).map(i=>i.name+': '+i.message)].map(t=>'<p>'+esc(t)+'</p>').join('')+'</article>').join('');}
  const list=dialog.querySelector('[data-intake-jobs]');list.innerHTML=jobs.filter(j=>j.datasetId===state().ledger.datasetId).map(j=>'<article class="intake-job" data-intake-attention="'+!!needsAttention(j)+'" data-intake-status="'+esc(j.status)+'"><strong>'+esc(j.files.map(f=>f.name).join(', '))+'</strong>'+(needsAttention(j)?'<p class="intake-status">Needs attention'+(j.status==='waiting'?' · retrying automatically':'')+'</p>':'')+'<p>'+esc(j.message)+'</p>'+(j.proposal?'<details><summary>View extraction · '+(j.status==='accepted'?'saved; clinical review pending':'processing or attention needed')+'</summary><p>'+esc(j.proposal.sourceSummary)+'</p><pre>'+esc(j.proposal.summaryMarkdown)+'</pre></details>':'')+(['held','error','waiting','identity-review'].includes(j.status)?'<button data-retry-intake="'+j.id+'">Retry processing</button>':'')+'</article>').join('')||'<p class="hint">No documents in this queue.</p>';
  list.querySelectorAll('[data-retry-intake]').forEach(b=>b.onclick=()=>run(async()=>{if(cloud)await processIncoming([b.dataset.retryIntake]);else await post('/api/intake/retry',{id:b.dataset.retryIntake});await refresh();}));
  if(jobs.some(j=>j.status==='accepted')){await notes.refreshImported?.();await profiles();}
 }
 async function run(fn){if(busy)return;lock(true);try{await fn();}catch(e){message(e.message,true,e.intakeConnection?'connection':'action');}finally{lock(false);if(upload){dialog.querySelector('[data-intake-history]').disabled=true;dialog.querySelector('[data-intake-input]').disabled=true;dialog.querySelector('[data-intake-paste]').disabled=true;}}}
 async function processIncoming(retryJobs=[]){
  repo();const datasetId=state().ledger.datasetId;
  if(!incomingAttempt||incomingAttempt.datasetId!==datasetId||JSON.stringify(incomingAttempt.retryJobs)!==JSON.stringify(retryJobs))incomingAttempt={id:crypto.randomUUID(),datasetId,retryJobs};
  message(retryJobs.length?'Requesting a retry…':'Checking Incoming and saving the processing request…');
  const result=cloud?await cloud.requestIncoming(incomingAttempt):await post('/api/intake/incoming',incomingAttempt);
  incomingAttempt=null;trackedRequestId=result.id;message(incomingMessage(result,!cloud),false,'request');await refresh();
 }
 async function submit(){
  const history=typedHistorySource(patient,dialog.querySelector('[data-intake-history]').value);
  const sources=[...files,...(history?[new File([history],'typed-history.txt',{type:'text/plain'})]:[])];
  if(!sources.length)throw new Error('Type some history, paste a photo, or choose a document first.');
  if(sources.length>6||sources.reduce((n,f)=>n+f.size,0)>MAX_UPLOAD_BYTES)throw new Error('Use up to six sources, 10 MB total. Typed history counts as one source.');
  const a=repo();
  if(!upload){const id=crypto.randomUUID(),metadata=[],documents=[];for(let i=0;i<sources.length;i++){const f=sources[i],bytes=new Uint8Array(await f.arrayBuffer());if(!signatureMatches(bytes,f.type))throw new Error('The file contents do not match its type: '+f.name);metadata.push({name:f.name,mime:f.type,size:f.size,sha256:await digest(bytes),file:id+'-'+i+'.'+({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp','text/plain':'txt'}[f.type])});documents.push(await dataURL(f));}upload={job:{app:'trim-document-intake',schema:1,id,phn:patient.phn,datasetId:state().ledger.datasetId,model:localStorage.getItem('trim-notes:model')||'',files:metadata},documents};}
  message('Uploading and verifying originals…');const job=cloud?await cloud.submit(upload):await post('/api/intake',upload);files=[];upload=null;dialog.querySelector('[data-intake-history]').value='';showFiles();message(job.message);await refresh();
 }
 async function open(p){
  if(busy||(dialog.open&&!canClose()))return;repo();epoch++;patient={...p,phn:String(p.phn||'').replace(/\D/g,'')};files=[];upload=null;
  if(!/^\d{10}$/.test(patient.phn))throw new Error('Save a valid PHN before uploading patient documents.');
  dialog.innerHTML=`<div class="dialog-body"><div class="intake-heading"><h2>Patient history & documents</h2><button data-intake-close aria-label="Close documents">Close</button></div>${identityHTML(patient)}<p>Type history, paste a photo, or upload documents. You can combine these in one submission; all originals are retained.</p><label class="intake-history">Patient history<textarea data-intake-history rows="6" maxlength="80000" placeholder="Enter past medical history, relevant dates, and any other patient context…"></textarea></label><div class="intake-drop" tabindex="0" aria-label="Drop files here or paste a screenshot"><label>Choose documents<input data-intake-input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple></label><button type="button" data-intake-paste>Paste photo</button><p>Or click here and press Ctrl+V / ⌘V. Drop PDF or image files here.</p><small>Six sources, 10 MB total · typed history counts as one source</small></div><ul data-intake-files></ul><button data-intake-upload class="primary">Submit history & documents</button><p class="hint">The laptop matches the source PHN, reconciles and saves the patient context, verifies the save, then archives the original. No second confirmation is needed. Cloud uploads wait for Drive sync and the laptop service. Start it with the TRIM desktop shortcut. Clinical review remains pending.</p><p data-intake-message role="status"></p><section data-intake-jobs></section></div>`;
  dialog.querySelector('[data-intake-close]').onclick=()=>{if(canClose())dialog.close();};dialog.querySelector('[data-intake-paste]').onclick=pasteImage;dialog.querySelector('[data-intake-history]').oninput=()=>{if(upload)message('Retrying will use the original submitted history. Complete the upload before adding more.',true);};dialog.querySelector('[data-intake-input]').onchange=e=>{addFiles([...e.target.files]);e.target.value='';};dialog.querySelector('[data-intake-upload]').onclick=()=>run(submit);
  dialog.ondragover=e=>{e.preventDefault();};dialog.ondrop=e=>{e.preventDefault();addFiles([...e.dataTransfer.files]);};dialog.onpaste=e=>{const incoming=clipboardImages(e.clipboardData);if(incoming.length){e.preventDefault();addFiles(incoming);}};dialog.oncancel=e=>{if(!canClose())e.preventDefault();};
  if(!laptopRuntime()){const button=document.createElement('button');button.type='button';button.textContent='Connect patient records';button.dataset.intakeConnect='';button.onclick=()=>permission.showModal();dialog.querySelector('[data-intake-message]').before(button);}
  if(!dialog.open)dialog.showModal();await refresh().catch(e=>message(e.message,true,'connection'));clearInterval(timer);timer=setInterval(()=>{if(!busy&&(!cloud||processingPending))void refresh().catch(e=>message(e.message,true,'connection'));},10000);
 }
 dialog.onclose=()=>{trackedRequestId=null;epoch++;clearInterval(timer);files=[];upload=null;previews.forEach(url=>URL.revokeObjectURL(url));previews=[];dialog.onpaste=null;dialog.ondrop=null;dialog.ondragover=null;dialog.oncancel=null;};
 document.addEventListener('click',e=>{const b=e.target.closest('[data-upload-patient]');if(b){const p=state().people.find(p=>p.key===b.dataset.uploadPatient);if(p)void open(p).catch(e=>alert(e.message));}});
 const queueButton=document.createElement('button');queueButton.id='document-intake-queue';queueButton.className='text-button';queueButton.textContent='Document intake';document.querySelector('.app-utility').append(queueButton);
 queueButton.onclick=openQueue;
 async function openQueue(){if(busy||(dialog.open&&!canClose()))return;repo();epoch++;files=[];upload=null;patient=null;dialog.onpaste=null;dialog.ondrop=null;dialog.ondragover=null;dialog.oncancel=null;dialog.innerHTML='<div class="dialog-body"><div class="intake-heading"><h2>Document intake</h2><button data-intake-close>Close</button></div><p>Put documents in the shared Drive Incoming folder, let Drive finish syncing, then click Process Incoming. Only the files present at that click are included. Keep TRIM Notes open on this laptop while starting processing. You can open it from the TRIM website Notes button or the desktop shortcut. Active processing can finish after its window closes; the laptop service then stops automatically.</p><div class="actions"><button class="primary" data-process-incoming>Process Incoming</button><button data-refresh-incoming>Refresh status</button></div><p data-intake-message role="status"></p><section data-incoming-requests></section><h3>Documents</h3><section data-intake-jobs></section></div>';dialog.querySelector('[data-intake-close]').onclick=()=>{if(!busy)dialog.close();};dialog.oncancel=e=>{if(busy)e.preventDefault();};dialog.querySelector('[data-process-incoming]').onclick=()=>run(()=>processIncoming());dialog.querySelector('[data-refresh-incoming]').onclick=()=>run(refresh);if(!laptopRuntime()){const b=document.createElement('button');b.textContent='Connect patient records';b.onclick=()=>permission.showModal();dialog.querySelector('[data-process-incoming]').after(b);}dialog.showModal();await refresh().catch(e=>message(e.message,true,'connection'));clearInterval(timer);timer=setInterval(()=>{if(!busy&&(!cloud||processingPending))void refresh().catch(e=>message(e.message,true,'connection'));},5000);}
 let queuePolling=false;
 setInterval(async()=>{if(!laptopRuntime()||queuePolling||!state().adapter||document.hidden)return;queuePolling=true;try{repo();updateQueue(await readQueue());await notes.refreshImported?.();}catch(e){queueUnavailable(e);}finally{queuePolling=false;}},15000);
 async function updateFooterQueue(){try{repo();updateQueue(await readQueue());}catch(e){queueUnavailable(e);}}
 async function refreshQueue(){if(!state().adapter)return;if(dialog.open){try{await refresh();}catch(e){queueUnavailable(e);}}else await updateFooterQueue();}
 async function updateBirthDate(phn,expected,next){
  const adapter=repo(),dataset=state().ledger?.datasetId;
  const connection=laptopRuntime()?await local():null;
  const target=connection?new LocalNotesRepository((...args)=>connection.request(...args)):new DriveNotesRepository(recordsAdapter||adapter);
  try{await savePatientBirthDate(target,dataset,phn,expected,next);}
  catch(error){if(!connection&&!recordsAdapter&&adapter.hostedAccess){recordsNeeded=true;connectButton.hidden=false;}throw error;}
  await profiles();
 }
 return {updateBirthDate,open,profiles,refreshQueue,recordsConnection(){return adapter===state().adapter?recordsAdapter:null;},offerConnection(){recordsNeeded=true;connectButton.hidden=false;}};
}
