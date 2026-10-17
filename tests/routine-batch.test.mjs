import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger,upsertEntry,cancelBillingCodes,clone} from '../public/core.mjs';
import {routineCandidates,addRoutineBatch,undoRoutineBatch,sessionChanges,changedBillCount} from '../public/workspace.mjs';
import {diagnosisForItem} from '../public/reports.mjs';
const pts=Array.from({length:7},(_,n)=>({id:'test-'+n,key:'phn:'+String(n).padStart(10,'0'),phn:String(n).padStart(10,'0'),name:'SYNTHETIC '+n,unit:n<3?'a':'b',room:String(n),panel:n!==6,codes:n===4?'':n===5?'bad':'401, 250'}));
function fixture(){const l=blankLedger();for(const p of pts){l.patients[p.key]=p;if(p!==pts[3])l.baselines[p.key]={date:'2026-09-24'};}return l;}
test('routine review separates active due, unknown, missing/invalid diagnosis, coverage, and same-day records',()=>{
 let l=fixture();l=upsertEntry(l,pts[1],'2026-10-08',[{code:'13121',units:1}]);
 const c=routineCandidates(l,pts,'2026-10-08');assert.equal(c.length,6);
 assert.deepEqual(c.map(x=>x.status),['due','billed','due','review','review','review']);
 assert.equal(c[0].diagnosis,'401');assert.equal(c[0].usualCodes,'401, 250');
 assert.equal(routineCandidates(l,pts,'2026-10-07')[0].status,'later');
});
test('batch atomic add, selected patients only, one daily bonus, no duplicate second click',()=>{
 const l=fixture(),before=clone(l);const r=addRoutineBatch(l,pts,'2026-10-08',[pts[0].key,pts[2].key]);
 assert.deepEqual(l,before);assert.equal(r.ledger.entries.length,2);assert.equal(r.ledger.entries.flatMap(e=>e.items).filter(i=>i.code==='13334').length,1);
 assert.ok(r.ledger.entries.every(e=>!e.items[0].diagnosis&&r.ledger.patients[e.patientKey].codes==='401, 250'));
 for(const e of r.ledger.entries)for(const i of e.items)assert.equal(diagnosisForItem(i,e,r.ledger.patients[e.patientKey].codes),'401, 250');
 assert.throws(()=>addRoutineBatch(r.ledger,pts,'2026-10-08',[pts[0].key]),/not eligible/);
 assert.throws(()=>addRoutineBatch(l,pts,'2026-10-08',[pts[0].key,pts[3].key]),/not eligible/);assert.deepEqual(l,before);
 assert.throws(()=>addRoutineBatch(l,pts,'2026-10-08',[pts[6].key]),/not eligible/);
 assert.throws(()=>addRoutineBatch(l,pts,'2099-01-01',[pts[0].key]),/earlier/);
 assert.deepEqual(undoRoutineBatch(r.ledger,r.receipt).entries,[]);
 const changed=clone(r.ledger);changed.entries[0].items[0].reason='edited';assert.throws(()=>undoRoutineBatch(changed,r.receipt),/edited/);
});
test('Thursday batch resets due dates, Saturday remainder stays due, imported charges are excluded',()=>{
 let l=fixture();l=addRoutineBatch(l,pts,'2026-10-08',[pts[0].key]).ledger;
 assert.equal(routineCandidates(l,pts,'2026-10-10')[0].status,'later');assert.equal(routineCandidates(l,pts,'2026-10-10')[1].status,'due');
 l.historicalBillings=[{id:'old',patientKey:pts[1].key,date:'2026-10-10',codes:['00114'],status:'already_billed'}];
 assert.equal(routineCandidates(l,pts,'2026-10-10')[1].status,'billed');
 const r=addRoutineBatch(l,pts,'2026-10-08',[pts[2].key]);assert.equal(r.ledger.entries.flatMap(e=>e.items).filter(i=>i.code==='13334').length,1);
});
test('pending counts are individual changed codes including removals, not patients or audit metadata',()=>{
 const base=fixture(),r=addRoutineBatch(base,pts,'2026-10-08',[pts[0].key]);
 assert.equal(changedBillCount(sessionChanges(base,r.ledger)),2);
 const next=clone(r.ledger);next.entries[0].items[0].reason='changed';assert.equal(changedBillCount(sessionChanges(r.ledger,next)),1);
 const removed=cancelBillingCodes(r.ledger,r.ledger.entries[0].id,'00114');
 assert.equal(changedBillCount(sessionChanges(r.ledger,removed)),2);assert.ok(!sessionChanges(r.ledger,removed).some(r=>r.name==='Workspace'));
 assert.equal(changedBillCount(sessionChanges(base,removed)),0);
});
