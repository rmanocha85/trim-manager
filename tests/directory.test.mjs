import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankLedger,normalizeRoster,rosterView,upsertEntry,dueState} from '../public/core.mjs';
import {matchesPatientSearch,routineCandidates,coveragePatient} from '../public/workspace.mjs';
const own={id:'own',name:'EXAMPLE, Panel',phn:'0000000001',codes:'401',unit:'a'};
const other={id:'directory',name:'EXAMPLE, Coverage',phn:'0000000002',codes:'250',unit:'b',room:'200'};
const raw=()=>({patients:[own],otherPatients:[other],units:[]});
test('directory residents are searchable but never enter routine billing',()=>{
 const source=raw(),before=structuredClone(source),r=normalizeRoster(source),l=blankLedger(),people=rosterView(r,l);
 assert.equal(r.patients.length,1);assert.equal(r.otherPatients.length,1);
 for(const q of ['Coverage','Coverage Example','000 000 0002','200'])assert.equal(people.filter(p=>matchesPatientSearch(p,q))[0].key,'phn:0000000002');
 assert.equal(people[0].panel,false);
 assert.deepEqual(routineCandidates(l,people,'2026-10-13').map(c=>c.patient.key),['phn:0000000001']);
 assert.notEqual(dueState(l,people[0],'2026-10-13').kind,'due');
 assert.deepEqual(source,before);
});
test('directory identity joins existing coverage history without rewriting bills',()=>{
 const old=coveragePatient({name:'EXAMPLE, Old spelling',phn:other.phn},[],'manual');
 const l=upsertEntry(blankLedger(),old,'2026-10-01',[{code:'00114',units:1,reason:'Synthetic concern',diagnosis:'250'}]);
 l.nonPanel.push(old);const before=structuredClone(l),people=rosterView(normalizeRoster(raw()),l);
 const matched=people.filter(p=>p.phn===other.phn);assert.equal(matched.length,1);
 assert.equal(matched[0].name,other.name);assert.equal(matched[0].room,'200');
 assert.equal(matched[0].key,l.entries[0].patientKey);assert.equal(matched[0].panel,false);
 assert.deepEqual(l,before);assert.throws(()=>coveragePatient(other,people,'another'),/already/);
});
test('active panel wins cross-list identity overlap; names alone do not merge',()=>{
 const r=normalizeRoster({...raw(),otherPatients:[{...own,unit:'old'},{...other,name:own.name}]});
 const people=rosterView(r,blankLedger());assert.equal(people.length,2);
 assert.equal(people.find(p=>p.phn===own.phn).panel,true);
 assert.equal(people.find(p=>p.phn===own.phn).unit,'a');
 assert.equal(people.find(p=>p.phn===other.phn).panel,false);
});
test('older rosters remain compatible; malformed directory and duplicate identities fail visibly',()=>{
 assert.deepEqual(normalizeRoster({patients:[own],units:[]}).otherPatients,[]);
 assert.throws(()=>normalizeRoster({...raw(),otherPatients:{}}),/directory/);
 assert.throws(()=>normalizeRoster({...raw(),otherPatients:[other,other]}),/Duplicate/);
 assert.throws(()=>normalizeRoster({...raw(),otherPatients:[{name:'Incomplete'}]}),/identity/);
 assert.equal(rosterView({patients:[],units:[]},blankLedger()).length,0);
});
