import {assessmentDateLabel,assessmentToday,assessmentTimeZone} from './maid-assessment.mjs?v=20261112-provision1';

const text=v=>typeof v==='string'&&v.trim().length>0;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const validTime=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const fields=['date','time','location','address'];

// Older workflow records may be incomplete. Read them without inventing missing facts;
// every newly saved booking must meet the full scheduling contract.
export function validateProvisionSchedule(s,{strict=false}={}){
  if(s==null)return;
  if(typeof s!=='object'||Array.isArray(s))throw new Error('Invalid provision schedule.');
  if(!strict&&s.status===undefined)return;
  if(!['scheduled','cancelled'].includes(s.status)||s.timeZone!==assessmentTimeZone||!text(s.source))throw new Error('Invalid provision status, time zone or source.');
  if(s.status==='scheduled'&&(!validDate(s.date)||!validTime(s.time)||!text(s.location)||!text(s.address)))throw new Error('Provision requires a valid date, start time, venue and full address.');
}

export function updateProvisionSchedule(old,action,now){
  if(action.cancel===true){
    if(action.schedule||!text(action.source))throw new Error('Cancellation requires a source and no replacement schedule.');
    if(!old||old.status==='cancelled')throw new Error('No provision appointment to cancel.');
    return {...old,status:'cancelled',timeZone:assessmentTimeZone,source:action.source,updatedAt:now,cancelledAt:now};
  }
  const s=action.schedule;
  if(!s||typeof s!=='object'||Array.isArray(s)||!text(s.source)||!fields.some(k=>Object.hasOwn(s,k))||Object.keys(s).some(k=>![...fields,'source'].includes(k)))throw new Error('Supply confirmed provision fields and their source.');
  if(old?.status==='cancelled'&&!Object.hasOwn(s,'date'))throw new Error('Choose a new date to schedule a cancelled provision.');
  if(Object.hasOwn(s,'location')&&s.location?.trim()!==(old?.location||old?.venue)&&!Object.hasOwn(s,'address'))throw new Error('Confirm the full address when changing the provision venue.');
  const next={...old,status:'scheduled',timeZone:assessmentTimeZone,source:s.source,updatedAt:now};
  for(const key of fields)if(Object.hasOwn(s,key))next[key]=typeof s[key]==='string'?s[key].trim():s[key];
  delete next.timezone;delete next.cancelledAt;
  validateProvisionSchedule(next,{strict:true});return next;
}

export function provisionDefaults(patient){
  const s=patient.plannedProvision||{},current=patient.currentLocation||{};
  const verified=text(current.source)&&text(current.verified_date);
  const venue=s.location||s.venue||'';
  const currentVenue=current.display_name||current.label||'';
  // An established procedure venue must never acquire an address from a different care site.
  const sameVenue=!venue||[current.display_name,current.label].includes(venue);
  return {date:s.status!=='cancelled'&&validDate(s.date)?s.date:'',time:s.status!=='cancelled'&&validTime(s.time)?s.time:'',location:venue||(verified?currentVenue:''),address:typeof s.address==='string'?s.address:verified&&sameVenue&&typeof current.address==='string'?current.address:''};
}

export function provisionPlanningText(patient,now=new Date()){
  if(validDate(patient.provisionDate))return {label:`Completed: ${assessmentDateLabel(patient.provisionDate)}`,past:false};
  const s=patient.plannedProvision;
  if(s?.status==='cancelled')return {label:'Cancelled',past:false};
  if(!validDate(s?.date))return {label:'Not scheduled',past:false};
  const time=validTime(s.time)?`${Number(s.time.slice(0,2))%12||12}:${s.time.slice(3)} ${Number(s.time.slice(0,2))<12?'AM':'PM'}`:'';
  return {label:`${assessmentDateLabel(s.date)}${time?` · ${time}`:''}`,past:s.date<assessmentToday(now),incomplete:!time||!text(s.address)||!text(s.location||s.venue)};
}

export function provisionMapUrl(address){return text(address)?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address.trim()):null;}
