import test from 'node:test';
import assert from 'node:assert/strict';
import {familyMessageText,familyMessageContact,rosterMessageText} from '../public/roster-messages.mjs';
const patient={name:'Example, Mary',familyContacts:[{name:'Alex Example',relationship:'Son',phone:'604-555-0100'}]};
test('family message uses the patient name for every relationship and the contact first name',()=>{
  assert.equal(familyMessageText(patient),'Hi Alex,\n\nThis is Dr Manocha from TRIM. I’d like to speak with you urgently about Mary Example.\nCould you please let me know when you’re available for a call?\n\nDr Rahul Manocha');
  for(const relationship of ['Daughter','Mother','Wife','Brother','Grandson'])assert.match(familyMessageText({...patient,familyContacts:[{name:'Example, Élodie Jane',relationship}]}),/Hi Élodie,[\s\S]*about Mary Example\./);
});
test('single primary contact wins; missing or ambiguous contacts remain copyable without guessing a recipient',()=>{
  const primary={name:'Jamie Example',relationship:'Daughter',primary:true};
  assert.equal(familyMessageContact({...patient,familyContacts:[...patient.familyContacts,primary]}),primary);
  for(const contacts of [[],[...patient.familyContacts,{name:'Jamie Example',relationship:'Daughter'}],[{...primary},{...primary,name:'Another',relationship:'Son'}],[{name:'Public Guardian and Trustee',primary:true,relationship:'PG/T'}],[{name:'Nurse Smith',role:'Nurse',primary:true}]])assert.equal(familyMessageText({...patient,familyContacts:contacts}),'Hi,\n\nThis is Dr Manocha from TRIM. I’d like to speak with you urgently about Mary Example.\nCould you please let me know when you’re available for a call?\n\nDr Rahul Manocha');
});
test('unknown relationship retains a known contact first name and uses patient name',()=>{
  assert.match(familyMessageText({...patient,familyContacts:[{name:'Example, Alex'}]}),/^Hi Alex,[\s\S]*about Mary Example\./);
});
test('both message types work for ordinary patients without palliative flags or active issues and do not mutate records',()=>{
  const before=structuredClone(patient);assert.match(rosterMessageText('nurse',patient),/^Re: Example, Mary\n\nCould you please/);assert.match(rosterMessageText('family',patient),/^Hi Alex,/);assert.deepEqual(patient,before);assert.throws(()=>rosterMessageText('invalid',patient),/Unknown message/);
});
