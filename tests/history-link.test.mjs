import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patientHistoryGroups} from '../public/workspace.mjs';
import {blankLedger,upsertEntry,entryIssues} from '../public/core.mjs';
const old={id:'synthetic',key:'roster:synthetic',name:'EXAMPLE, Alex',phn:'',ava:'synthetic-ava'};
const current={...old,key:'phn:0000000001',phn:'0000000001',panel:true,codes:'V66.7'};
function fixture(){
 const ledger=blankLedger();
 ledger.baselines[current.key]={date:'2026-09-19',identityCorrection:{previousPatientKey:old.key,rosterId:old.id,previousPhn:'',correctedPhn:current.phn,confirmedInChat:true}};
 return ledger;
}
test('confirmed matching roster and Ava identities combine without mutating originals',()=>{
 const ledger=fixture(),patients=[old,current],before=structuredClone({ledger,patients});
 const groups=patientHistoryGroups(ledger,patients);
 assert.equal(groups.length,1);assert.equal(groups[0].patient.key,current.key);
 assert.deepEqual([...groups[0].keys],[old.key,current.key]);
 assert.deepEqual({ledger,patients},before);
 assert.equal(patientHistoryGroups(ledger,[current,old])[0].patient.key,current.key);
});
test('name matches, unconfirmed corrections and differing PHNs or Ava never merge',()=>{
 for(const mutate of [
  (l,p)=>{l.baselines={};},
  (l,p)=>{l.baselines[current.key].identityCorrection.confirmedInChat=false;},
  (l,p)=>{p[0].phn='0000000002';},
  (l,p)=>{p[0].ava='another';},
  (l,p)=>{p[1].id='another';},
  (l,p)=>{l.baselines[current.key].identityCorrection.correctedPhn='0000000002';}
 ]){
  const l=fixture(),p=structuredClone([old,current]);mutate(l,p);
  assert.equal(patientHistoryGroups(l,p).length,2);
 }
});
test('conflicting correction destinations stay separate',()=>{
 const l=fixture(),other={...current,key:'phn:0000000002',phn:'0000000002'};
 l.baselines[other.key]=structuredClone(l.baselines[current.key]);l.baselines[other.key].identityCorrection.correctedPhn=other.phn;
 assert.equal(patientHistoryGroups(l,[old,current,other]).length,3);
});
test('127 does not require narrative reason for own or coverage patients',()=>{
 for(const panel of [true,false]){
  const p={...current,panel},l=upsertEntry(blankLedger(),p,'2026-10-09',[{code:'00127',units:1,diagnosis:'V66.7',concernBilling:true}]);
  assert.deepEqual(entryIssues(l.entries[0],l,p),[]);
 }
});
test('portal confirmation is external; timed-service checks remain',()=>{
 let l=upsertEntry(blankLedger(),current,'2026-10-09',[{code:'14077',units:1,start:'10:00',end:'10:10',diagnosis:'V66.7'}]);
 assert.deepEqual(l.settings.portalYears,[]);assert.deepEqual(entryIssues(l.entries[0],l,current),[]);
 l.entries[0].items[0].end='';
 assert.ok(entryIssues(l.entries[0],l,current).some(x=>x.includes('start/end')));
 assert.ok(!entryIssues(l.entries[0],l,current).some(x=>x.includes('portal')));
});
