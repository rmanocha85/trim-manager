import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleHospitalStay} from '../public/roster-hospital.mjs';
const p=returnedDate=>({hospitalStays:[{id:'stay',admittedDate:'2026-10-01',returnedDate}]});
test('hospital indicators remain throughout admission, expire 14 calendar days after return',()=>{
 assert.equal(visibleHospitalStay({},'2026-11-20'),null);
 assert.equal(visibleHospitalStay(p(null),'2026-11-20').active,true);
 assert.equal(visibleHospitalStay(p('2026-11-20'),'2026-11-20').active,false);
 assert.equal(visibleHospitalStay(p('2026-11-07'),'2026-11-20').active,false);
 const old=p('2026-11-06'),before=JSON.stringify(old);
 assert.equal(visibleHospitalStay(old,'2026-11-20'),null);assert.equal(JSON.stringify(old),before);
 assert.equal(visibleHospitalStay(p('2026-10-25'),'2026-11-08'),null);
});
test('readmission supersedes a recent return; future admissions have no indicator',()=>{
 const patient=p('2026-11-15');patient.hospitalStays.push({id:'second',admittedDate:'2026-11-19',returnedDate:null});
 assert.equal(visibleHospitalStay(patient,'2026-11-20').stay.id,'second');
 assert.equal(visibleHospitalStay(patient,'2026-09-30'),null);
});
