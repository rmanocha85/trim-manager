import test from 'node:test';
import assert from 'node:assert/strict';
import {familyMessageText,familyMessageContact,rosterMessageText} from '../public/roster-messages.mjs';
const patient={name:'Example, Mary',familyContacts:[{name:'Alex Example',relationship:'Son',phone:'604-555-0100'}]};
test('family message uses first name and reverses the contact relationship without guessing gender',()=>{
  assert.equal(familyMessageText(patient),'Hi Alex,\n\nThis is Dr Manocha from TRIM calling about your parent.\nCould I please speak to you urgently?\n\n-Dr Rahul Manocha');
  for(const [relation,subject] of [['Daughter','parent'],['Mother','child'],['Wife','spouse'],['Brother','sibling'],['Grandson','grandparent']])assert.match(familyMessageText({...patient,familyContacts:[{name:'Example, Élodie Jane',relationship:relation}]}),new RegExp('Hi Élodie,[\\s\\S]*about your '+subject+'\\.'));
});
test('single primary contact wins; missing or ambiguous contacts remain copyable without guessing a recipient',()=>{
  const primary={name:'Jamie Example',relationship:'Daughter',primary:true};
  assert.equal(familyMessageContact({...patient,familyContacts:[...patient.familyContacts,primary]}),primary);
  for(const contacts of [[],[...patient.familyContacts,{name:'Jamie Example',relationship:'Daughter'}],[{...primary},{...primary,name:'Another',relationship:'Son'}],[{name:'Public Guardian and Trustee',primary:true,relationship:'PG/T'}],[{name:'Nurse Smith',role:'Nurse',primary:true}]])assert.equal(familyMessageText({...patient,familyContacts:contacts}),'Hi,\n\nThis is Dr Manocha from TRIM calling about Mary Example.\nCould I please speak to you urgently?\n\n-Dr Rahul Manocha');
});
test('unknown relationship retains a known contact first name and uses patient name',()=>{
  assert.match(familyMessageText({...patient,familyContacts:[{name:'Example, Alex'}]}),/^Hi Alex,[\s\S]*about Mary Example\./);
});
test('both message types work for ordinary patients without palliative flags or active issues and do not mutate records',()=>{
  const before=structuredClone(patient);assert.match(rosterMessageText('nurse',patient),/^Re: Example, Mary\n\nCould you please/);assert.match(rosterMessageText('family',patient),/^Hi Alex,/);assert.deepEqual(patient,before);assert.throws(()=>rosterMessageText('invalid',patient),/Unknown message/);
});
