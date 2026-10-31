import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionChanges,extractDemographics,coveragePatient,matchesPatientSearch,newestBillingFirst} from '../public/workspace.mjs';
import {blankLedger,upsertEntry,entryIssues,rosterView,normalizeRoster} from '../public/core.mjs';
const p={id:'synthetic',key:'phn:0000000001',phn:'0000000001',name:'SYNTHETIC, Person',panel:true};
test('History sorts by billing date despite later creation or edits, including missing timestamps',()=>{
 const entries=[
  {id:'older',date:'2026-10-08',createdAt:'2026-10-08T10:00:00Z',updatedAt:'2026-10-08T20:00:00Z'},
  {id:'newer',date:'2026-10-08',createdAt:'2026-10-08T11:00:00Z'},
  {id:'backdated',date:'2026-09-22',createdAt:'2026-10-08T12:00:00Z'},
  {id:'legacy',date:'2026-10-07'},
  {id:'latest-legacy',date:'2026-10-09'},
  {id:'invalid',date:'2026-09-01',createdAt:'unknown'}
 ];
 const before=structuredClone(entries);
 assert.deepEqual(newestBillingFirst(entries).map(e=>e.id),['latest-legacy','newer','older','legacy','backdated','invalid']);
 assert.deepEqual(entries,before);
 assert.deepEqual(newestBillingFirst([{id:'b',date:'2026-10-01'},{id:'a',date:'2026-10-01'}]).map(e=>e.id),['a','b']);
});
test('patient search accepts either name order, separated tokens, room and PHN',()=>{
 const patient={name:'Example, Alex',room:'1234',phn:'0000000001'};
 for(const query of ['Alex Example','example, alex','EXAMPLE','1234','000 000 0001',''])assert.equal(matchesPatientSearch(patient,query),true,query);
 assert.equal(matchesPatientSearch(patient,'Jordan'),false);
});
test('local review includes adds, edits, removals, coverage patients and settings, not revision metadata',()=>{
 const base=upsertEntry(blankLedger(),p,'2026-09-22',[{code:'00114',units:1}]),next=structuredClone(base);next.revision++;next.updatedAt='2026-10-06';assert.equal(sessionChanges(base,next).length,0);
 next.entries[0].items[0].reason='SYNTHETIC concern';assert.equal(sessionChanges(base,next)[0].kind,'Edited billing');next.entries=[];assert.equal(sessionChanges(base,next)[0].kind,'Removed billing');
 const added=upsertEntry(base,p,'2026-09-23',[{code:'00127',units:1}]);assert.equal(sessionChanges(base,added)[0].kind,'Added billing');
 const coverage=coveragePatient({name:'SYNTHETIC, Coverage',phn:'0000000002'},[p],'s2');next.nonPanel.push(coverage);next.patients[coverage.key]=coverage;next.settings.parallel=false;const rows=sessionChanges(base,next);assert.ok(rows.some(r=>r.kind==='Added patient'));assert.ok(rows.some(r=>r.kind==='Settings'));assert.equal(new Set(rows.filter(r=>r.patientKey).map(r=>r.patientKey)).size,2);
});
test('OCR parser uses explicitly identifiable fields and refuses ambiguous or corrupted identities',()=>{
 assert.deepEqual(extractDemographics('SYNTHETIC, Alex A.\n1952-Dec-10\n(604) 222-3333\n0000000001 | BC'),{name:'SYNTHETIC, Alex A.',phn:'0000000001',warnings:[]});
 assert.equal(extractDemographics('Name: Example Person\nPHN: 000 000 0002').phn,'0000000002');
 assert.equal(extractDemographics('PHN: 0000000001\nPHN: 0000000002').phn,'');
 assert.equal(extractDemographics('SYNTHETIC, One\nSYNTHETIC, Two').name,'');
 assert.equal(extractDemographics('PHN: 00000O0001\nPhone: 6042223333').phn,'');
 assert.equal(extractDemographics('Chart: 1234567890').phn,'');
});
test('manual identity validation, duplicates and future roster matching use the same PHN',()=>{
 assert.throws(()=>coveragePatient({name:'X',phn:p.phn},[p],'new'),/already/);
 assert.throws(()=>coveragePatient({name:'X',phn:'00000O0001'},[],'new'),/10 digits/);
 const other=coveragePatient({name:'Example',phn:'0000000002'},[],'new'),ledger=blankLedger();ledger.nonPanel.push(other);ledger.patients[other.key]=other;
 assert.equal(rosterView({patients:[],units:[]},ledger)[0].panel,false);
 const joined=rosterView(normalizeRoster({patients:[{...other,id:'roster-record'}],units:[]}),ledger);assert.equal(joined.length,1);assert.equal(joined[0].panel,true);
});
test('new Concern 114 requires reason without retroactively changing existing charges',()=>{
 const ledger=upsertEntry(blankLedger(),p,'2026-09-22',[{code:'00114',units:1,concernBilling:true}]);assert.ok(entryIssues(ledger.entries[0],ledger,p).some(s=>s.includes('reason required')));delete ledger.entries[0].items[0].concernBilling;assert.ok(!entryIssues(ledger.entries[0],ledger,p).some(s=>s.includes('reason required')));
});
