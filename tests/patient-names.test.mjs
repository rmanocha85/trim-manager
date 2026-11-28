import test from 'node:test';
import assert from 'node:assert/strict';
import {patientName,formatNameInput,rosterName} from '../public/patient-names.mjs';
import {nameHTML} from '../public/patient-identity.mjs';
import {rosterName as intakeName} from '../scripts/clinic-patient-names.mjs';
test('shared display and intake preserve surname order, punctuation, accents and established casing',()=>{
 for(const [raw,expected] of [['SMITH, ALEX','Smith, Alex'],['smith,alex','Smith, Alex'],["O’NEILL, ÉLISE-MARIE","O’Neill, Élise-Marie"],['McDonald, Jean-Luc','McDonald, Jean-Luc'],['deVries, Alex III','deVries, Alex III'],['LEE CHAN, ANNE MARIE','Lee Chan, Anne Marie'],['Unknown Order','Unknown Order']])assert.equal(patientName(raw),expected);
 assert.equal(patientName({name:'Old, Name',lastName:'ÉLAN',firstName:'ALEX'}),'Élan, Alex');
 assert.equal(patientName(null),'');assert.equal(patientName({}),'');
 assert.equal(intakeName,rosterName);assert.equal(intakeName('SMITH','ALEX'),'Smith, Alex');
 assert.equal(formatNameInput('smith, alex '),'Smith, Alex ');
});
test('name display and copy agree without mutating source identity',()=>{
 const p={name:'EXAMPLE, ALEX',phn:'0000000001',ava:'123456'},before=structuredClone(p),html=nameHTML(p);
 assert.match(html,/>Example, Alex<\/a>/);assert.match(html,/data-copy-value="Example, Alex"/);assert.match(html,/patients\/123456/);assert.deepEqual(p,before);
});
