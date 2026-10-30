import {identityHTML} from './patient-identity.mjs?v=20261030-workspace3';
import {DriveIntake} from './intake-drive.mjs?v=20261030-workspace3';
import {DriveNotesRepository} from './notes-storage.mjs?v=20261030-workspace3';
import {setProfileDisplay} from './profile-display.mjs?v=20261030-workspace3';
import {MAX_UPLOAD_BYTES,signatureMatches} from './intake-core.mjs?v=20261030-workspace3';
import {escapeHTML as esc} from './core.mjs?v=20261030-workspace3';
import {LocalAdapter,DriveAdapter} from './adapters.mjs?v=20261030-workspace3';
import {laptopRuntime} from './runtime.mjs';
const digest=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
const dataURL=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the selected file.'));reader.readAsDataURL(file);});
export function documentIntakeUI({state,notes,onProfiles=()=>{}}){
 let patient,files=[],busy=false,upload=null,timer=null,cloud,adapter,recordsAdapter,epoch=0;
 const dialog=document.createElement('dialog');dialog.id='document-intake';dialog.className='document-intake';document.body.append(dialog);
 function repo(){const a=state().adapter;if(!a)throw new Error('Connect your workspace first.');if(adapter!==a){adapter=a;recordsAdapter=null;cloud=a.mode==='cloud'&&!laptopRuntime()?new DriveIntake(a):null;}return a;}
 let localAdapter;
 const post=async(route,body)=>{let a=repo();if(a.mode!=='local'){if(!laptopRuntime())throw new Error('Open the laptop app to apply or retry analysis.');if(!localAdapter){localAdapter=new LocalAdapter();try{await localAdapter.connect();}catch(e){localAdapter=null;throw e;}}a=localAdapter;}return a.request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});};
 async function local(){if(!localAdapter){localAdapter=new LocalAdapter();try{await localAdapter.connect();}catch(e){localAdapter=null;throw e;}}return localAdapter;}
 const connectButton=document.createElement('button');connectButton.id='connect-patient-records';connectButton.className='text-button';connectButton.textContent='Connect patient records';connectButton.hidden=true;document.querySelector('#session-status').after(connectButton);
 const permission=document.createElement('dialog');permission.id='patient-records-connection';permission.innerHTML='<div class="dialog-body"><h2>Connect patient records</h2><p>Read age and MOST from the existing patient summaries and upload documents to Routine notes / Incoming.</p><p>Google will ask for permission to see, edit, create and delete files in your Google Drive. This permission covers your whole Drive; TRIM uses it for your existing private TRIM folders.</p><p>You can use the laptop app with its existing Drive folder instead.</p><p data-records-message role="status"></p><div class="actions"><button data-records-continue class="primary">Continue to Google</button><a href="http://127.0.0.1:4317/" target="_blank" rel="noopener">Open laptop app</a><button data-records-cancel>Cancel</button></div></div>';document.body.append(permission);
 connectButton.onclick=()=>permission.showModal();permission.querySelector('[data-records-cancel]').onclick=()=>permission.close();
 permission.querySelector('[data-records-continue]').onclick=async()=>{const button=permission.querySelector('[data-records-continue]'),out=permission.querySelector('[data-records-message]');button.disabled=true;out.textContent='Connecting…';try{const a=repo();if(a.mode!=='cloud'||!a.accountEmail)throw new Error('Reconnect billing with your usual Google account first.');const candidate=new DriveAdapter(a.fileId,{rosterId:a.rosterId});candidate.accountEmail=a.accountEmail;await candidate.connect({patientRecords:true});if(state().adapter!==a)throw new Error('Workspace changed. Connect patient records again.');const checked=new DriveNotesRepository(candidate);await checked.root(false);recordsAdapter=candidate;cloud=new DriveIntake(candidate);await profiles();if(dialog.open){message('');await refresh();}out.textContent='Connected.';permission.close();}catch(e){out.textContent=e.message;}finally{button.disabled=false;}};
 const message=(text,error=false)=>{const el=dialog.querySelector('[data-intake-message]');if(el){el.textContent=text;el.classList.toggle('error',error);}};
 async function profiles(){
  const a=repo();setProfileDisplay(null);onProfiles();
  connectButton.hidden=true;
  try{const data=laptopRuntime()?await (await local()).request('/api/patient-display'):(await new DriveNotesRepository(recordsAdapter||a).load('patient-display.json')).data;if(state().adapter!==a)return;if(data?.datasetId===state().ledger?.datasetId){setProfileDisplay(data);onProfiles();}else throw new Error('Patient display file is not synced for this workspace yet.');}
  catch{if(state().adapter===a){setProfileDisplay(null);onProfiles();connectButton.hidden=laptopRuntime();}}
 }
 function lock(value){busy=value;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value);}
 function showFiles(){dialog.querySelector('[data-intake-files]').innerHTML=files.map((f,i)=>`<li>${esc(f.name)} <small>${Math.ceil(f.size/1024)} KB</small> <button type="button" data-remove-file="${i}" aria-label="Remove ${esc(f.name)}">×</button></li>`).join('');dialog.querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=()=>{files.splice(Number(b.dataset.removeFile),1);upload=null;showFiles();});}
 function addFiles(next){if(busy||upload)return;const all=[...files,...next];if(all.length>6||all.reduce((n,f)=>n+f.size,0)>MAX_UPLOAD_BYTES){message('Choose up to six files, 10 MB total.',true);return;}if(all.some(f=>!['application/pdf','image/png','image/jpeg','image/webp'].includes(f.type))){message('Choose PDF, PNG, JPG or WebP files.',true);return;}files=all;showFiles();message('');}
 async function refresh(){
  const ticket=epoch,phn=patient?.phn;if(!dialog.open||!phn)return;
  repo();const jobs=cloud?await cloud.list(phn):(await (await local()).request('/api/intake?phn='+phn)).jobs;if(ticket!==epoch||!dialog.open)return;
  const list=dialog.querySelector('[data-intake-jobs]');list.innerHTML=jobs.filter(j=>j.datasetId===state().ledger.datasetId).map(j=>`<article class="intake-job"><strong>${esc(j.files.map(f=>f.name).join(', '))}</strong><p>${esc(j.message)}</p>${j.proposal?`<details><summary>View analysis · ${esc(j.status==='accepted'?'saved for clinical review':'review needed')}</summary><p>${esc(j.proposal.sourceSummary)}</p><pre>${esc(j.proposal.summaryMarkdown)}</pre><ul>${j.proposal.reviewIssues.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></details>`:''}${laptopRuntime()&&j.status==='ready'?`<button data-accept-intake="${j.id}">Use proposed patient summary</button>`:''}${laptopRuntime()&&['error','waiting','identity-review','ready'].includes(j.status)?`<button data-retry-intake="${j.id}">Retry analysis</button>`:''}${!laptopRuntime()&&['ready','error','identity-review'].includes(j.status)?'<p>Open the laptop app to review and apply or retry this analysis.</p>':''}</article>`).join('')||'<p class="hint">No uploaded documents for this patient yet.</p>';
  list.querySelectorAll('[data-retry-intake]').forEach(b=>b.onclick=()=>run(async()=>{await post('/api/intake/retry',{id:b.dataset.retryIntake});await refresh();}));
  list.querySelectorAll('[data-accept-intake]').forEach(b=>b.onclick=()=>run(async()=>{const s=notes.status?.();if(s?.dirty||s?.busy||s?.error)throw new Error('Save your current Notes changes before applying this proposal.');await post('/api/intake/accept',{id:b.dataset.acceptIntake});await notes.connect?.();await profiles();await refresh();}));
 }
 async function run(fn){if(busy)return;lock(true);try{await fn();}catch(e){message(e.message,true);}finally{lock(false);}}
 async function submit(){
  if(!files.length)throw new Error('Choose a PDF or screenshot first.');
  const a=repo();
  if(!upload){const id=crypto.randomUUID(),metadata=[],documents=[];for(let i=0;i<files.length;i++){const f=files[i],bytes=new Uint8Array(await f.arrayBuffer());if(!signatureMatches(bytes,f.type))throw new Error('The file contents do not match its type: '+f.name);metadata.push({name:f.name,mime:f.type,size:f.size,sha256:await digest(bytes),file:id+'-'+i+'.'+({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[f.type])});documents.push(await dataURL(f));}upload={job:{app:'trim-document-intake',schema:1,id,phn:patient.phn,datasetId:state().ledger.datasetId,model:localStorage.getItem('trim-notes:model')||'',files:metadata},documents};}
  message('Uploading and verifying originals…');const job=cloud?await cloud.submit(upload):await post('/api/intake',upload);files=[];upload=null;showFiles();message(job.message);await refresh();
 }
 async function open(p){
  if(busy)return;repo();epoch++;patient={...p,phn:String(p.phn||'').replace(/\D/g,'')};files=[];upload=null;
  if(!/^\d{10}$/.test(patient.phn))throw new Error('Save a valid PHN before uploading patient documents.');
  dialog.innerHTML=`<div class="dialog-body"><div class="intake-heading"><h2>Patient documents</h2><button data-intake-close aria-label="Close documents">Close</button></div>${identityHTML(patient)}<p>Upload PDFs or screenshots. Originals are retained in Routine notes / Incoming.</p><div class="intake-drop" tabindex="0" aria-label="Drop files here or paste a screenshot"><label>Choose documents<input data-intake-input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple></label><p>Drop files here or paste a screenshot · six files, 10 MB total</p></div><ul data-intake-files></ul><button data-intake-upload class="primary">Upload & analyze</button><p class="hint">AI analysis uses the laptop’s ChatGPT connection. Cloud uploads wait for the laptop service and Drive sync. Analysis does not change the patient summary until you apply it.</p><p data-intake-message role="status"></p><section data-intake-jobs></section></div>`;
  dialog.querySelector('[data-intake-close]').onclick=()=>dialog.close();dialog.querySelector('[data-intake-input]').onchange=e=>{addFiles([...e.target.files]);e.target.value='';};dialog.querySelector('[data-intake-upload]').onclick=()=>run(submit);
  dialog.ondragover=e=>{e.preventDefault();};dialog.ondrop=e=>{e.preventDefault();addFiles([...e.dataTransfer.files]);};dialog.onpaste=e=>{const incoming=[...e.clipboardData.files];if(incoming.length){e.preventDefault();addFiles(incoming);}};dialog.oncancel=e=>{if(busy)e.preventDefault();};
  if(!laptopRuntime()){const button=document.createElement('button');button.type='button';button.textContent='Connect patient records';button.dataset.intakeConnect='';button.onclick=()=>permission.showModal();dialog.querySelector('[data-intake-message]').before(button);}
  if(!dialog.open)dialog.showModal();await refresh().catch(e=>message(e.message,true));clearInterval(timer);timer=setInterval(()=>{if(!busy)void refresh().catch(e=>message(e.message,true));},10000);
 }
 dialog.onclose=()=>{epoch++;clearInterval(timer);files=[];upload=null;};
 document.addEventListener('click',e=>{const b=e.target.closest('[data-upload-patient]');if(b){const p=state().people.find(p=>p.key===b.dataset.uploadPatient);if(p)void open(p).catch(e=>alert(e.message));}});
 return {open,profiles};
}
