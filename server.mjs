import {ServiceLifecycle} from './service-lifecycle.mjs';
import {DocumentIntake} from './intake-local.mjs';
import {refreshProfileDisplay} from './profile-display-local.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {BillingStore,digest} from './storage.mjs';
import {normalizeRoster} from './public/core.mjs';
import {ChatGPTConnection} from './notes-auth.mjs';
import {LocalNotesStore} from './notes-local.mjs';
import {validateHandoff} from './public/notes-core.mjs';
import {RosterStore} from './roster-storage.mjs';
import {LocalBackupStore} from './backup-storage.mjs';
import {snapshot,hash} from './public/backups.mjs';
import {MaidStore} from './maid-storage.mjs';
import {OatStore} from './oat-storage.mjs';
import {finishAppointment} from './public/oat-schedule.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const home=os.homedir();
const testRoot=process.env.TRIM_TEST_MODE==='1'?path.join(os.tmpdir(),'trim-isolated-no-live-data'):null;
export const defaults={
  roster:path.join(home,'My Drive','02. TRIM','TRIM AI','Data','Roster','trim-patients-data.json'),
  billing:path.join(home,'My Drive','02. TRIM','TRIM AI','Data','Billing','trim-billing-data-v1.json')
};
export function createServer({rosterPath=process.env.TRIM_ROSTER_PATH||(testRoot?path.join(testRoot,'roster.json'):defaults.roster),billingPath=process.env.TRIM_BILLING_PATH||(testRoot?path.join(testRoot,'billing.json'):defaults.billing),lockPath=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMBilling',`${digest(billingPath)}.lock`),notesPath=process.env.TRIM_NOTES_PATH,maidPath,oatPath,snapshotPaths,chatgpt,onDemand=false,lifecycleOptions={}}={}) {
  const live=path.resolve(rosterPath)===path.resolve(defaults.roster)&&path.resolve(billingPath)===path.resolve(defaults.billing);
  maidPath ||= live?path.join(home,'My Drive','00. MAID','00. MAID info','MAID AI','maid-roster.json'):path.join(path.dirname(rosterPath),'maid-roster.json');
  const maidStore=new MaidStore(maidPath);
  oatPath ||= live?path.join(home,'My Drive','01. Active List','05. OAT','OAT AI','oat-fh-roster.json'):path.join(path.dirname(rosterPath),'oat-fh-roster.json');
  const oatStore=new OatStore(oatPath);
  notesPath ||= live?path.join(home,'My Drive','02. TRIM','TRIM AI','Working records','Routine notes'):path.join(path.dirname(billingPath),'notes');
  chatgpt ||= live?new ChatGPTConnection():{status:async()=>({connected:false,planEnabled:false}),models:async()=>[],generate:async()=>{throw new Error('AI is disabled for isolated data. Inject a test connection.');}};
  if(path.resolve(rosterPath)===path.resolve(billingPath))throw new Error('Roster and billing paths must be different.');
  const store=new BillingStore(billingPath,lockPath,digest(`${os.hostname()}|${os.userInfo().username}`).slice(0,24));
  const backups=new LocalBackupStore(live?path.join(home,'My Drive','02. TRIM','TRIM AI','Backups','Billing'):path.join(path.dirname(billingPath),'billing-backups'));
  const rosterStore=new RosterStore(rosterPath,path.dirname(lockPath),snapshotPaths||(rosterPath===defaults.roster?[path.join(home,'My Drive','02. TRIM','TRIM AI','Backups','Roster'),path.join(home,'My Drive','TRIM Snapshots')]:[path.join(path.dirname(rosterPath),'roster-snapshots')]));
  const session=randomBytes(32).toString('hex');
  const notes=new LocalNotesStore(notesPath,path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMNotes','locks'));
  const types={'.js':'text/javascript','.gz':'application/gzip','.txt':'text/plain','.html':'text/html','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
  const allowed=new Set(['index.html','app.mjs','core.mjs','adapters.mjs','recovery.mjs','reports.mjs','styles.css','balanced.css','favicon.svg','workspace.mjs','time-entry.mjs','dates.mjs','ocr.mjs','workspace.css','vendor/ocr/tesseract.esm.min.js','vendor/ocr/worker.min.js','vendor/ocr/eng.traineddata.gz',...['','-simd','-relaxedsimd','-lstm','-simd-lstm','-relaxedsimd-lstm'].map(s=>`vendor/ocr/tesseract-core${s}.wasm.js`)]);
  const intake=new DocumentIntake({root:notesPath,notes,roster:async()=>(await rosterStore.load()).roster,ledger:async()=>(await store.load()).ledger,ai:chatgpt});
  allowed.add('context-refresh.mjs');allowed.add('service-lifecycle.mjs');
  allowed.add('clinic-roster.mjs');
  allowed.add('maid-lifecycle.mjs');
  allowed.add('maid-assessment.mjs');
  allowed.add('maid-provision.mjs');
  allowed.add('maid-date-calendar.mjs');
  allowed.add('clinic-contacts.mjs');
  allowed.add('clinic-roster.css');
  allowed.add('clinic-roster-repository.mjs');
  allowed.add('oat-roster-repository.mjs');
  allowed.add('oat-workspace.mjs');allowed.add('oat-schedule.mjs');
  allowed.add('visit-list.mjs');
  allowed.add('hosted-billing-access.mjs');
  let profileTask;const profiles=()=>profileTask||(profileTask=refreshProfileDisplay(notes,notesPath).finally(()=>{profileTask=null;}));
  const background=()=>{void intake.tick().then(profiles).catch(e=>{intake.service.error=e.message;});};
  const lifecycle=new ServiceLifecycle({...lifecycleOptions,onDemand});let activeRequests=0,closing=false;
  const busy=()=>activeRequests>0||intake.running||Boolean(chatgpt.aborters?.size);
  const idleCheck=()=>{if(!closing&&server.listening&&lifecycle.shouldStop(busy())){closing=true;server.close();}};
  const server=http.createServer(async(req,res)=>{
    activeRequests++;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client; connect-src 'self' https://www.googleapis.com https://accounts.google.com; frame-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' data: blob:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const port=req.socket.localPort;const origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
    const json=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
    try {
      if(!origins.some(o=>o.slice(7)===req.headers.host))return json(403,{error:'Invalid host.'});
      const url=new URL(req.url,origins[0]);
      if(url.pathname==='/health'&&req.method==='GET')return json(200,{app:'trim-app',version:'20261105-intake1',intakePolicy:'best-effort-v1',service:lifecycle.status(),intakeRunning:intake.running,aiRunning:chatgpt.aborters?.size||0});
      if(url.pathname==='/auth/callback'&&req.method==='GET'){
        let message='ChatGPT connected. Return to TRIM Billing and Notes.',ok=true;
        try{await chatgpt.callback(url.searchParams);}catch(e){ok=false;message=e.message;}
        res.writeHead(ok?200:400,{'Content-Type':'text/html; charset=utf-8'});
        const escaped=message.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        return res.end('<!doctype html><meta charset="utf-8"><title>TRIM ChatGPT connection</title><h1>'+escaped+'</h1><p>You can close this tab and return to the app.</p>');
      }
      if(url.pathname.startsWith('/api/')) {
        if(req.headers.origin&&!origins.includes(req.headers.origin))return json(403,{error:'Cross-origin requests are not allowed.'});
        if(['cross-site'].includes(req.headers['sec-fetch-site']))return json(403,{error:'Cross-site request denied.'});
        if(req.url==='/api/connect'&&req.method==='POST') {
          if(req.headers['x-trim-local']!=='1'||!origins.includes(req.headers.origin))return json(403,{error:'Open the local app to connect.'});
          res.setHeader('Set-Cookie',`trim_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
          return json(200,{connected:true,csrf:session});
        }
        if(!req.headers.cookie?.split(';').some(c=>c.trim()===`trim_session=${session}`)||req.headers['x-trim-session']!==session)return json(401,{error:'Connect this laptop first.'});
        if(!['GET','HEAD'].includes(req.method)&&!origins.includes(req.headers.origin))return json(403,{error:'Origin required.'});
        const readJSON=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>20000000)throw Object.assign(new Error('Clinical request is too large.'),{status:413});}return JSON.parse(raw||'{}');};
        if(url.pathname==='/api/service/heartbeat'&&req.method==='POST'){const value=await readJSON();lifecycle.heartbeat(value.id,value.release===true);return json(200,lifecycle.status());}
        if(url.pathname==='/api/service/stop'&&req.method==='POST'){
          if(activeRequests>1||intake.running||chatgpt.aborters?.size)return json(409,{error:'TRIM is still processing or saving. Let it finish, then stop it.'});
          lifecycle.stopRequested=true;res.once('finish',()=>setImmediate(idleCheck));return json(200,{stopping:true});
        }
        if(url.pathname==='/api/oat-fh/roster'){
          if(req.method==='GET')return json(200,await oatStore.load());
          if(req.method==='POST'){const action=await readJSON();return json(200,await oatStore.update(req.headers['if-match'],roster=>finishAppointment(roster,action)));}
          return json(405,{error:'Unsupported OAT FH action.'});
        }
        if(url.pathname==='/api/maid/roster'){
          if(req.method==='GET')return json(200,await maidStore.load());
          if(req.method==='POST'){
            const action=await readJSON();if(!['status','remove','assessment-planning','provision-planning'].includes(action.type))return json(400,{error:'Unsupported MAID app action.'});
            return json(200,await maidStore.mutate(action,req.headers['if-match']));
          }
        }
        if(url.pathname.startsWith('/api/backups')){
          const dataset=await hash((await store.load()).ledger.datasetId);
          if(req.method==='GET'&&url.searchParams.get('dataset')!==dataset)throw new Error('Wrong backup dataset.');
          if(url.pathname==='/api/backups'&&req.method==='GET')return json(200,await backups.list(dataset));
          if(url.pathname==='/api/backups/file'&&req.method==='GET')return json(200,{text:await backups.read(url.searchParams.get('name'),dataset)});
          const value=await readJSON();if(value.dataset!==dataset)throw new Error('Wrong backup dataset.');
          if(url.pathname==='/api/backups'&&req.method==='POST')return json(200,await backups.ensure(value));
          if(url.pathname==='/api/backups/prune'&&req.method==='POST'){await backups.prune(dataset,value.keep);return json(200,{ok:true});}
        }
        if(url.pathname==='/api/billing/restore'&&req.method==='POST'){
          const current=await store.load();if(current.etag!==req.headers['if-match'])throw Object.assign(new Error('Billing changed before restore. Nothing replaced.'),{status:409});
          await backups.ensure(await snapshot(current.ledger));return json(200,await store.save(await readJSON(),current.etag,{restore:true}));
        }
        if(url.pathname==='/api/patient-display'&&req.method==='GET')return json(200,await profiles());
        if(url.pathname==='/api/intake'&&req.method==='GET')return json(200,{jobs:await intake.list(url.searchParams.get('phn')),requests:await intake.incomingRequests(),service:{...intake.service,running:intake.running}});
        if(url.pathname==='/api/intake'&&req.method==='POST')return json(200,await intake.submit(await readJSON()));
        if(url.pathname==='/api/intake/incoming'&&req.method==='POST')return json(200,await intake.requestIncoming(await readJSON()));
        if(url.pathname==='/api/intake/retry'&&req.method==='POST')return json(200,await intake.retry((await readJSON()).id));
        if(url.pathname==='/api/intake/accept'&&req.method==='POST'){const saved=await intake.accept((await readJSON()).id);await profiles();return json(200,saved);}
        if(url.pathname==='/api/ai/status'&&req.method==='GET')return json(200,await chatgpt.status());
        if(url.pathname==='/api/ai/connect'&&req.method==='POST')return json(200,await chatgpt.begin(origins[0]));
        if(url.pathname==='/api/ai/disconnect'&&req.method==='POST')return json(200,await chatgpt.logout());
        if(url.pathname==='/api/ai/models'&&req.method==='GET')return json(200,{models:await chatgpt.models()});
        if(url.pathname==='/api/ai/generate'&&req.method==='POST')return json(200,await chatgpt.generate(await readJSON()));
        if(url.pathname==='/api/notes/document'){
          const name=url.searchParams.get('name');
          if(req.method==='GET')return json(200,await notes.load(name));
          if(req.method==='PUT'){const data=await readJSON();if(name?.startsWith('handoffs/')){validateHandoff(data);if(name!==`handoffs/${data.serviceDate}.json`)throw new Error('Handoff date mismatch.');}return json(200,await notes.save(name,data,req.headers['if-match']));}
        }
        if(url.pathname==='/api/roster'&&req.method==='GET')return json(200,normalizeRoster(JSON.parse(await readFile(rosterPath,'utf8'))));
        if(url.pathname==='/api/roster/document'&&req.method==='GET')return json(200,await rosterStore.load());
        if(url.pathname==='/api/roster/document'&&req.method==='PUT')return json(200,await rosterStore.save(await readJSON(),req.headers['if-match']));
        if(url.pathname==='/api/roster/snapshots'&&req.method==='GET')return json(200,await rosterStore.snapshots());
        if(url.pathname==='/api/roster/snapshot'&&req.method==='GET')return json(200,await rosterStore.snapshot(url.searchParams.get('id')));
        if(url.pathname==='/api/billing'&&req.method==='GET')return json(200,await store.load());
        if(url.pathname==='/api/billing'&&req.method==='PUT') {
          if(!origins.includes(req.headers.origin))return json(403,{error:'Origin required.'});
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8_000_000)return json(413,{error:'Billing file too large.'});}
          return json(200,await store.save(JSON.parse(raw),req.headers['if-match']));
        }
        return json(404,{error:'Not found.'});
      }
      if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Method not allowed.'});
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(process.env.TRIM_VERIFICATION==='1'&&['drive-live-check.html','drive-live-check.mjs'].includes(file)){
        res.writeHead(200,{'Content-Type':types[path.extname(file)]+'; charset=utf-8'});return res.end(await readFile(path.join(root,'tests',file)));
      }
      if(!allowed.has(file)&&!['roster-merge.mjs','merge.mjs','backups.mjs','backup-ui.mjs','notes-core.mjs','notes-storage.mjs','notes-ui.mjs','notes.css','patients-core.mjs','patient-links.mjs','patient-identity.mjs','patient-identity.css','profile-display.mjs','most-designations.mjs','intake-core.mjs','intake-sources.mjs','incoming-request.mjs','intake-ui.mjs','intake-drive.mjs','roster-print.mjs','roster-repository.mjs','patients-ui.mjs','patients.html','patients.css','billing-ui.mjs','session.mjs','shell.css','runtime.mjs','hospital.mjs','hospital-ui.mjs','hospital-entry.mjs'].includes(file))return json(404,{error:'Not found.'});
      res.writeHead(200,{'Content-Type':types[path.extname(file)]+'; charset=utf-8'});
      res.end(req.method==='HEAD'?undefined:await readFile(path.join(root,'public',file)));
    } catch(e) {json(e.status||400,{error:e.code==='ENOENT'?'The source file is not available on this laptop. Check Drive sync.':e.message});} finally {activeRequests--;}
  });
  const timer=setInterval(background,15000),idleTimer=setInterval(idleCheck,lifecycleOptions.intervalMs||5000);timer.unref();idleTimer.unref();server.once('listening',background);server.once('close',()=>{clearInterval(timer);clearInterval(idleTimer);});return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||4317);const server=createServer({onDemand:process.argv.includes('--on-demand')});
  server.listen(port,'127.0.0.1',()=>console.log(`TRIM: http://127.0.0.1:${port} (loopback only)`));
}
