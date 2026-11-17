import test from 'node:test';
import assert from 'node:assert/strict';
import {organizePatient,fullProfileSummary,profileUpdate,clinicalLabs,validateProfileExtraction,editProfileBirthDate} from '../public/clinical-profile.mjs';
import {contextRecord,clinicalRecords,generationInput,markReviewed} from '../public/notes-core.mjs';
import {profileDisplay} from '../public/profile-display.mjs';
import {savePatientBirthDate} from '../public/notes-storage.mjs';
const phn='0000000001',key='phn:'+phn,patient={key,phn,name:'Synthetic',custom:'retained'};
const legacy={
  patient,summaryMarkdown:'DOB: 1941-02-03\nDOB source: confirmed on intake\n\n## PMHx and significant investigations\n- Prior surgery. Stable function.\n\n## Function and allergies\n- Uses a walker. Admission documents NKDA.\n\n## Allergies\n- Bee venom: anaphylaxis. No known food allergies documented.\n\n## Active issues\n- Review mobility.',
  labs:[{test:'Synthetic test',value:'<0.5',unit:'mg/L',note:'Repeat sample',date:null,dateBasis:'Collection date unavailable',sourcePath:'private-path'},{date:'2025-02',datePrecision:'month',results:['Synthetic result']},{date:'2025-02-03',test:'Synthetic count',value:0,unit:'/L'}],
  mostStatus:'CPR C2',medicationSnapshot:{sourceDate:'2025-01-01',scheduled:['Synthetic A']}
};
test('historical profiles split without losing clinical wording, dates, scope, or unknown fields',()=>{
  const c=organizePatient(legacy,{dob:'1941-02-03'});
  assert.equal(c.patient.dateOfBirth,'1941-02-03');assert.equal(c.patient.dateOfBirthSource,'confirmed on intake');assert.equal(c.patient.custom,'retained');
  assert.doesNotMatch(c.summaryMarkdown,/DOB|NKDA|anaphylaxis|surgery/);assert.match(c.summaryMarkdown,/Uses a walker/);assert.match(c.summaryMarkdown,/Review mobility/);
  assert.equal(c.medicalHistory.status,'documented');assert.match(c.medicalHistory.text,/Prior surgery/);
  assert.deepEqual(c.allergies.entries.map(r=>r.status),['noneKnown','documented']);assert.match(c.allergies.entries[1].text,/No known food allergies/);
  assert.deepEqual(c.labs,legacy.labs);assert.deepEqual(c.medicationSnapshot,legacy.medicationSnapshot);assert.equal(c.mostStatus,legacy.mostStatus);
  assert.deepEqual(organizePatient(c),c);const manual=profileUpdate(c,fullProfileSummary(c));assert.deepEqual(manual.medicalHistory,c.medicalHistory);assert.deepEqual(manual.allergies,c.allergies);
  assert.throws(()=>organizePatient(legacy,{dob:'1942-02-03'}),/DOB conflict/);
});
test('missing history, absent documentation, scoped negatives and unassessable allergies stay distinct',()=>{
  const c=organizePatient({patient,summaryMarkdown:'DOB: 1941-02-03',historyPreparation:{completed:true},importStatus:{clinicalReviewStatus:'pending'}});
  assert.equal(c.medicalHistory.status,'notDocumented');assert.deepEqual(c.allergies,{status:'notDocumented',entries:[]});
  for(const [text,state] of [
    ['No known drug allergies, not verified.','noneKnown'],['Unable to assess at admission.','unableToAssess'],
    ['No allergy information provided.','notDocumented'],['No known drug allergies and a bee-sting allergy with unknown reaction.','documented'],
    ['Drug X: rash. No known food allergy.','documented']
  ])assert.equal(organizePatient({summaryMarkdown:'## Allergies\n- '+text}).allergies.status,state,text);
  assert.equal(organizePatient({summaryMarkdown:'## PMHx\nMother allergic to honey. Patient has allergic rhinitis.'}).allergies.entries.length,0);
});
test('labs preserve inequalities, zero, dates and qualifiers through the actual generation input',()=>{
  const c=organizePatient(legacy),data=contextRecord('test');data.patients[key]=c;
  const input=generationInput({patient,confirmed:true,reportMode:'nursing',input:'Follow-up'},data,'2026-01-02');
  assert.deepEqual(input.clinicalRecords.labs,[
    {date:null,results:['Synthetic test: <0.5 mg/L','Repeat sample','Date basis: Collection date unavailable']},
    {date:'2025-02',results:['Synthetic result','Date precision: month']},
    {date:'2025-02-03',results:['Synthetic count: 0 /L']}
  ]);
  assert.equal(clinicalLabs([{date:null,results:'Positive'}])[0].results[0],'Positive');
  assert.doesNotMatch(JSON.stringify(input),/private-path|1941-02-03|0000000001/);
});
test('a silent upload and reviewed visit preserve demographics, established PMHx and allergy evidence',()=>{
  const c=organizePatient(legacy),update=profileUpdate(c,'',{medicalHistory:null,allergies:[],dateOfBirth:null});
  assert.deepEqual(update.allergies,c.allergies);assert.deepEqual(update.medicalHistory,c.medicalHistory);assert.equal(update.summaryMarkdown,c.summaryMarkdown);
  const addition={medicalHistory:'Documented prior fracture.',allergies:[{status:'noneKnown',text:'Source reports no known medication allergies.'}],dateOfBirth:null};
  const added=profileUpdate(c,'',addition);assert.match(added.medicalHistory.text,/Prior surgery/);assert.match(added.medicalHistory.text,/prior fracture/);
  assert.equal(added.allergies.status,'documented');assert.deepEqual(profileUpdate(added,'',addition),added);
  assert.throws(()=>profileUpdate(c,'',{dateOfBirth:'1941-03-02'}),/DOB conflict/);
  assert.throws(()=>validateProfileExtraction({allergies:[]}),/Incomplete/);
  const data=contextRecord('synthetic');data.patients[key]=c;
  markReviewed({patient:{key,phn,name:'Synthetic',room:'2'},confirmed:true,assessment:'Synthetic review',version:1,proposedSummary:'Current plan.'},data,'2026-01-02');
  const saved=data.patients[key];assert.equal(saved.patient.dateOfBirth,'1941-02-03');assert.equal(saved.patient.custom,'retained');assert.equal(saved.patient.room,'2');
  assert.deepEqual(clinicalRecords(saved).allergies,c.allergies);
});
test('DOB corrections use the saved patient identity, expected value, and conditional file/projection writes',async()=>{
  const c=organizePatient(legacy),datasetId='synthetic';
  const doc={app:'trim-notes',schema:1,kind:'patient-context',datasetId,context:c};
  const display={app:'trim-patient-display',datasetId,patients:{[phn]:profileDisplay(c)}};
  const index={app:'trim-notes',kind:'patient-index',context:{datasetId},patients:{[key]:{phn,path:'patients/'+phn+'.json'}}};
  const docs=new Map([['index.json',index],['patients/'+phn+'.json',doc],['patient-display.json',display]]),revisions=new Map();
  const repo={mode:'cloud',load:async name=>({data:structuredClone(docs.get(name)),etag:revisions.get(name)||'initial'}),save:async(name,data,etag)=>{assert.equal(etag,revisions.get(name)||'initial');docs.set(name,data);revisions.set(name,'updated');}};
  await savePatientBirthDate(repo,datasetId,phn,'1941-02-03','1941-02-04');
  assert.equal(docs.get('patients/'+phn+'.json').context.patient.dateOfBirth,'1941-02-04');assert.equal(docs.get('patient-display.json').patients[phn].dateOfBirth,'1941-02-04');
  await savePatientBirthDate(repo,datasetId,phn,'1941-02-03','1941-02-04');
  await assert.rejects(savePatientBirthDate(repo,datasetId,phn,'1941-02-03','1941-02-05'),/changed/);
  assert.throws(()=>editProfileBirthDate(c,'0000000002','1941-02-03','1941-03-03'),/identity/);
  assert.equal(await savePatientBirthDate(repo,datasetId,'0000000002','','1941-02-04'),false);
});
