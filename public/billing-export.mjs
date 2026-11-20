// Durable export state. Clinical content and delivery evidence are separate.
import {clone,addDays,validDate,validateLedger} from './core.mjs?v=20261119-export1';
export const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function sha256(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function billingContent(e){const copy=clone(e);for(const k of ['batchId','updatedAt','createdAt'])delete copy[k];return copy;}
export function suggestedDates(ledger,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),to=addDays(today,-1);
 return {from:[...ledger.entries,...ledger.corrections||[]].filter(e=>!e.batchId&&e.date<=to).map(e=>e.date).sort()[0]||to,to};
}
export async function freezeExport(ledger,roster,entries,{layout='patient',recipient}={}){
 if(!entries.length||new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('Choose a nonempty, unique billing selection.');
 if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient||''))throw Error('Save Suzy’s verified email in Settings first.');
 for(const e of entries)if(e.batchId||stable(e)!==stable([...ledger.entries,...ledger.corrections||[]].find(x=>x.id===e.id)))throw Error('Billing selection changed. Reload before exporting.');
 const people=new Map([...Object.values(ledger.patients),...(roster.otherPatients||[]),...roster.patients].map(p=>[p.key,p]));
 const snapshots=await Promise.all(entries.map(async e=>{const p=people.get(e.patientKey)||ledger.patients[e.patientKey],identity={name:p.name,phn:p.phn||'',codes:p.codes||''};return {entry:clone(e),identity,fingerprint:await sha256(stable({entry:billingContent(e),identity}))};}));
 const dates=entries.map(e=>e.date).sort(),id=crypto.randomUUID();
 return {id,datasetId:ledger.datasetId,createdAt:new Date().toISOString(),from:dates[0],to:dates.at(-1),layout,recipient,filename:`TRIM Billing ${dates[0]} to ${dates.at(-1)}.pdf`,state:'prepared',roster:clone(roster),parallel:ledger.settings.parallel,snapshots};
}
export function putExport(ledger,record){
 if(record.datasetId!==ledger.datasetId)throw Error('Wrong export dataset.');
 const next=clone(ledger);next.exports??=[];const old=next.exports.find(x=>x.id===record.id);
 if(old?.state==='sent'&&stable(old)!==stable(record))throw Error('Sent export evidence cannot be changed.');
 next.exports=next.exports.filter(x=>x.id!==record.id);next.exports.push(clone(record));return validateLedger(next);
}
export async function matchingEntries(ledger,record){
 if(record.datasetId!==ledger.datasetId)throw Error('Wrong export dataset.');
 const matches=[],changed=[];
 for(const snapshot of record.snapshots){const e=[...ledger.entries,...ledger.corrections||[]].find(x=>x.id===snapshot.entry.id);if(e&&!e.batchId&&stable(billingContent(e))===stable(billingContent(snapshot.entry)))matches.push(e);else if(!e?.batchId)changed.push(snapshot.entry.id);}
 return {matches,changed};
}
export async function completeExport(ledger,record,evidence){
 const existing=ledger.exports?.find(x=>x.id===record.id);if(existing?.state==='sent')return clone(ledger);
 if(!['user-confirmed-existing','user-confirmed-email'].includes(evidence?.basis)||!evidence.at)throw Error('Delivery evidence is required.');
 if(evidence.basis==='user-confirmed-email'&&(!record.pdfHash||!record.verification?.passed))throw Error('Verified PDF is required before confirming this export.');
 const {matches,changed}=await matchingEntries(ledger,record),next=putExport(ledger,{...record,error:null,state:'sent',delivery:clone(evidence),changedEntryIds:changed});
 if(matches.length){const batch={id:record.id,from:record.from,to:record.to,layout:record.layout,entryIds:matches.map(e=>e.id),handedOverAt:evidence.at,deliveryBasis:evidence.basis,exportId:record.id};next.batches.push(batch);for(const e of [...next.entries,...next.corrections||[]])if(batch.entryIds.includes(e.id))e.batchId=batch.id;}
 return validateLedger(next);
}
export function validateExportRecords(l){
 if(l.exports!==undefined&&!Array.isArray(l.exports))throw Error('Invalid export records.');
 const ids=new Set();for(const x of l.exports||[]){if(!x.id||ids.has(x.id)||x.datasetId!==l.datasetId||!validDate(x.from)||!validDate(x.to)||x.from>x.to||!['prepared','verified','downloaded','sent','cancelled'].includes(x.state)||!Array.isArray(x.snapshots)||!x.snapshots.length||new Set(x.snapshots.map(s=>s.entry?.id)).size!==x.snapshots.length)throw Error('Invalid export record.');ids.add(x.id);if(x.state==='sent'&&!x.delivery?.basis)throw Error('Missing delivery evidence.');}
}
