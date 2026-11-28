import test from 'node:test';import assert from 'node:assert/strict';
import {newPatientTasksPending,newPatient} from '../public/patient-identity.mjs';
import {setProfileDisplay} from '../public/profile-display.mjs?v=20261119-most-connection1';
import {setMedReconciliation,setPmhxUploaded} from '../public/patients-core.mjs';
const p={id:'synthetic',phn:'0000000001',name:'Example, Alex',newPanelPatient:true,panelAddedDate:'2026-11-01'};
test('priority remains until both tasks complete in either order, even after badge expiry',()=>{
 setProfileDisplay({patients:{}});
 for(const collection of ['patients','otherPatients'])for(const order of [[setMedReconciliation,setPmhxUploaded],[setPmhxUploaded,setMedReconciliation]]){
  const source={patients:[],otherPatients:[],units:[],[collection]:[p]};
  let roster=source;assert.equal(newPatientTasksPending(roster[collection][0],'2026-11-30'),true);
  roster=order[0](roster,p.id,true,'2026-11-30');assert.equal(newPatientTasksPending(roster[collection][0],'2026-11-30'),true);
  roster=order[1](roster,p.id,true,'2026-11-30');assert.equal(newPatientTasksPending(roster[collection][0],'2026-11-30'),false);
  roster=order[0](roster,p.id,false,'2026-11-30');assert.equal(newPatientTasksPending(roster[collection][0],'2026-11-30'),true);
  assert.deepEqual(source[collection],[p]);
 }
 assert.equal(newPatient(p,'2026-11-30'),false);
 assert.equal(newPatientTasksPending({...p,newPanelPatient:false},'2026-11-30'),false);
 assert.equal(newPatientTasksPending(p,'2026-10-31'),false);
 assert.equal(newPatientTasksPending({...p,panelAddedDate:''},'2026-11-30'),false);
});
test('verified imported history satisfies history task but never medication reconciliation',()=>{
 setProfileDisplay({patients:{[p.phn]:{historyImport:{sourceName:'Synthetic history',importedAt:'2026-11-02T00:00:00Z'}}}});
 assert.equal(newPatientTasksPending(p,'2026-11-30'),true);
 assert.equal(newPatientTasksPending({...p,medReconciliationDate:'2026-11-02'},'2026-11-30'),false);
 setProfileDisplay({patients:{}});
 assert.equal(newPatientTasksPending({...p,medReconciliationDate:'2026-11-02'},'2026-11-30'),true);
});
