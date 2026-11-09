import test from 'node:test';import assert from 'node:assert/strict';
import {upcomingFriday,validateClinicDays,appointmentsForDate} from '../public/oat-schedule.mjs';
const patients=[{id:'one',name:'Synthetic One'}];
test('Friday defaults use the supplied Pacific calendar date',()=>{assert.equal(upcomingFriday('2026-11-08'),'2026-11-13');assert.equal(upcomingFriday('2026-11-13'),'2026-11-13');assert.equal(upcomingFriday('2026-11-14'),'2026-11-20');assert.throws(()=>upcomingFriday('2026-02-30'));});
test('clinic days reject invalid dates, unknown IDs, duplicate appointments and invalid times',()=>{
 const good={date:'2026-11-13',appointments:[{id:'a',time:'09:00',patientId:'one'}]};assert.deepEqual(validateClinicDays([good],patients),[good]);
 for(const days of [[{...good,date:'2026-02-30'}],[good,good],[{...good,appointments:[good.appointments[0],good.appointments[0]]}],[{...good,appointments:[{id:'a',time:'24:00',patientId:'one'}]}],[{...good,appointments:[{id:'a',time:'09:00',patientId:'missing'}]}]])assert.throws(()=>validateClinicDays(days,patients));
});
test('appointments sort by time without changing source order or guessing identities',()=>{
 const roster={patients,clinicDays:[{date:'2026-11-13',appointments:[{id:'late',time:'10:00',label:'Break'},{id:'match',time:'09:00',patientId:'one'},{id:'unmatched',time:'09:00',sourceName:'Synthetic New'}]}]};validateClinicDays(roster.clinicDays,patients);
 const slots=appointmentsForDate(roster,'2026-11-13');assert.deepEqual(slots.map(s=>s.id),['match','unmatched','late']);assert.equal(slots[0].patient.name,'Synthetic One');assert.equal(slots[1].patient,undefined);assert.equal(roster.clinicDays[0].appointments[0].id,'late');assert.equal(appointmentsForDate(roster,'2026-11-20'),null);
});
