// Physician-directed helper. Input is a PRIVATE JSON operation file, never a
// roster overwrite. Defaults to preview; --apply is required to persist.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {defaults} from './server.mjs';
import {BillingStore,digest} from './storage.mjs';
import {normalizeRoster,rosterView,upsertEntry,removeEntry,validateLedger,entryIssues} from './public/core.mjs';
const args=process.argv.slice(2);const opPath=args.find(a=>!a.startsWith('--'));
if(!opPath)throw new Error('Usage: node edit-billing.mjs <private-operation.json> [--apply]. Operations: upsert/remove/baseline.');
const request=JSON.parse(await readFile(opPath,'utf8'));
const billingPath=process.env.TRIM_BILLING_PATH||defaults.billing;
const roster=normalizeRoster(JSON.parse(await readFile(process.env.TRIM_ROSTER_PATH||defaults.roster,'utf8')));
const lockPath=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'TRIMBilling',`${digest(billingPath)}.lock`);
const store=new BillingStore(billingPath,lockPath,digest(`${os.hostname()}|${os.userInfo().username}`).slice(0,24));
const current=await store.load();let next=structuredClone(current.ledger);
if(request.expectedRevision!==undefined&&request.expectedRevision!==next.revision)throw new Error('Expected revision no longer matches. Re-read before editing.');
for(const op of request.operations||[]) {
  if(op.type==='remove'){if(!op.entryId)throw new Error('An exact entry ID is required for removal.');next=removeEntry(next,op.entryId);}
  else if(op.type==='upsert'||op.type==='baseline') {
    const matches=rosterView(roster,next).filter(p=>p.key===op.patientKey);if(matches.length!==1)throw new Error('Patient selector must resolve exactly once.');const p=matches[0];
    if(op.type==='baseline'){next.baselines[p.key]={date:op.date,enteredAt:new Date().toISOString()};next.patients[p.key]=p;}
    else next=upsertEntry(next,p,op.date,op.items,op.comment||'',op.entryId||null);
  } else throw new Error('Unsupported operation. This helper cannot finalize or submit billing.');
}
validateLedger(next);const people=rosterView(roster,next);const missing=next.entries.filter(e=>!e.batchId&&entryIssues(e,next,people.find(p=>p.key===e.patientKey)).length).length;
if(args.includes('--apply')){const saved=await store.save(next,current.etag);console.log(JSON.stringify({saved:true,revision:saved.ledger.revision,entries:saved.ledger.entries.length,incompleteDrafts:missing,cloudSyncVerified:false}));}
else console.log(JSON.stringify({previewOnly:true,baseRevision:current.ledger.revision,entriesBefore:current.ledger.entries.length,entriesAfter:next.entries.length,incompleteDrafts:missing}));
