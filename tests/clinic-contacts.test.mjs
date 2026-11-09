import test from 'node:test';
import assert from 'node:assert/strict';
import {contactGroup,contactGroups,contactRole,phoneLink} from '../public/clinic-contacts.mjs';

test('patient preferred contact stays separate from family, clinical primary contacts and witnesses',()=>{
  const contacts=[
    {role:'Patient - preferred contact on 1632',primary:true},
    {role:'Son - MAID referral contact',primary:false},
    {role:'Preferred contact',relationship:'Daughter',primary:true},
    {role:'Primary health care provider',primary:true},
    {role:'MMH social worker - referral contact'},
    {role:'Inpatient team',facility:'Synthetic hospital',unit:'Unit A'},
    {role:'Witness',primary:true},
    {name:'Unknown relationship'},
    {role:"Patient's son"}
  ];
  const original=structuredClone(contacts),groups=contactGroups(contacts);
  assert.deepEqual(groups.patient,[contacts[0]]);
  assert.deepEqual(groups.family,[contacts[1],contacts[2],contacts[8]]);
  assert.deepEqual(groups.care,[contacts[5]]);
  assert.deepEqual(groups.other,contacts.slice(6,8));
  assert.deepEqual(contacts,original);
  assert.equal(contactGroup({role:'Self'}),'patient');
  assert.equal(contactRole(contacts[2]),'Preferred contact · Daughter');
});

test('phone links accept one number and keep extension separate for manual entry',()=>{
  assert.deepEqual(phoneLink('(604) 555-0101'),{href:'tel:6045550101',extension:''});
  assert.deepEqual(phoneLink('+1 (604) 555-0102 ext. 123'),{href:'tel:+16045550102',extension:'123'});
  assert.deepEqual(phoneLink('604-555-0103','456'),{href:'tel:6045550103',extension:'456'});
  for(const number of ['',null,'Not recorded','604-555-0101 / 604-555-0102','javascript:alert(1)','tel:6045550101','6045550101;123','6045550101?call=yes','1234'])assert.equal(phoneLink(number),null);
  assert.equal(phoneLink('6045550101 ext 12','34'),null);
  assert.equal(phoneLink('6045550101','1;call'),null);
});
