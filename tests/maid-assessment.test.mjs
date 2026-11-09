import test from 'node:test';import assert from 'node:assert/strict';
import {applyMaidAction,MaidRepository} from '../public/clinic-roster-repository.mjs';
import {assessmentPlanningText} from '../public/maid-assessment.mjs';
const sample=()=>({schemaVersion:1,patients:[{id:'one',name:'Synthetic',status:'active',assessmentDate:'2026-01-01',forms:{'1634':{signedDate:'2026-01-01'}},contacts:[{role:'Patient',phone:'604-555-0101'}]},{id:'two',name:'Other',status:'history'}]});
const plan={type:'assessment-planning',patientId:'one',schedule:{date:'2026-11-15',time:'09:30',source:'Synthetic confirmed referral appointment'},urgency:{level:'urgent',source:'Synthetic referral explicitly urgent'}};
test('planning edits preserve assessment completion, other facts and independent urgency',()=>{
 const old=sample(),next=applyMaidAction(old,plan,'2026-11-08T20:00:00Z');
 for(const key of ['forms','contacts','assessmentDate','status'])assert.deepEqual(next.patients[0][key],old.patients[0][key]);assert.deepEqual(next.patients[1],old.patients[1]);
 assert.equal(next.patients[0].assessmentSchedule.timeZone,'America/Vancouver');
 const cleared=applyMaidAction(next,{type:'assessment-planning',patientId:'one',schedule:{date:null,time:null,source:'Physician cleared appointment'}});
 assert.equal(cleared.patients[0].assessmentSchedule.date,null);assert.deepEqual(cleared.patients[0].assessmentUrgency,next.patients[0].assessmentUrgency);
 const urgent=applyMaidAction(next,{type:'assessment-planning',patientId:'one',urgency:{level:'semi-urgent',source:'Explicit referral wording'}});assert.deepEqual(urgent.patients[0].assessmentSchedule,next.patients[0].assessmentSchedule);
});
test('invalid dates, time without date and unsupported urgency are rejected for every writer',()=>{
 for(const date of ['2026-02-30','2026-13-01','not a date'])assert.throws(()=>applyMaidAction(sample(),{...plan,schedule:{...plan.schedule,date}}),/Invalid 1634/);
 for(const time of ['25:00','09:99','9:30'])assert.throws(()=>applyMaidAction(sample(),{...plan,schedule:{...plan.schedule,time}}),/Invalid 1634/);
 assert.throws(()=>applyMaidAction(sample(),{...plan,schedule:{...plan.schedule,date:null}}),/Invalid 1634/);
 assert.throws(()=>applyMaidAction(sample(),{...plan,urgency:{level:'critical',source:'test'}}),/Invalid assessment/);
 assert.throws(()=>applyMaidAction(sample(),{type:'update',patientId:'one',changes:{assessmentSchedule:{date:'2026-02-30',time:null,timeZone:'America/Vancouver',source:'test'}}}),/Invalid 1634/);
});
test('past dates request confirmation without marking assessment complete; date-only plans supported',()=>{
 const now=new Date('2026-11-08T20:00:00Z');const p={assessmentSchedule:{date:'2026-11-07',time:null}};
 assert.deepEqual(assessmentPlanningText(p,now),{label:'Sat, NOV 7, 2026',past:true});assert.equal(p.assessmentDate,undefined);
 assert.equal(assessmentPlanningText({...p,assessmentDate:'2026-11-07'},now).label,'Completed Sat, NOV 7, 2026');
 assert.equal(assessmentPlanningText({assessmentSchedule:{date:'2026-11-08',time:'09:30'}},now).past,false);
 assert.equal(assessmentPlanningText({},now).label,'Not scheduled');
});
test('cloud planning saves reject stale editors and read back the exact saved plan',async()=>{
 let data=sample(),revision=1;const adapter={mode:'cloud',request:async(url,options={})=>{if(url.includes('upload/')){assert.equal(options.headers['If-Match'],'v'+revision);data=JSON.parse(options.body);revision++;return {};}return url.includes('alt=media')?structuredClone(data):{etag:'v'+revision};}};
 const repo=new MaidRepository(adapter),before=await repo.load();const after=await repo.mutate(plan,before);assert.equal(after.roster.patients[0].assessmentSchedule.date,plan.schedule.date);
 await assert.rejects(()=>repo.mutate({...plan,schedule:{...plan.schedule,date:'2026-11-16'}},before),e=>e.status===409);assert.equal(data.patients[0].assessmentSchedule.date,'2026-11-15');
});
