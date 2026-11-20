import {hospitalAt,latestHospitalStay} from './hospital.mjs';
import {isCalendarDate} from './dates.mjs';

// Display lifetime only. Never discard hospital history or change billing rules.
export function visibleHospitalStay(patient,date){
  if(!isCalendarDate(date))return null;
  const active=hospitalAt(patient,date);
  if(active)return {stay:active,active:true};
  const stay=latestHospitalStay(patient,date);
  if(!stay?.returnedDate||stay.returnedDate>date)return null;
  const days=(Date.parse(date+'T12:00:00Z')-Date.parse(stay.returnedDate+'T12:00:00Z'))/86400000;
  return days<14?{stay,active:false}:null;
}
const attrs='viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
export const hospitalSymbol=`<svg ${attrs}><path d="M6 21V3h12v18M6 9H3v12h18V9h-3M10 21v-4h4v4M10 7h4m-2-2v4M9 12h1m4 0h1"/></svg>`;
export const returnSymbol=`<svg ${attrs}><path d="M9 10 4 15l5 5M4 15h11a5 5 0 0 0 5-5V4"/></svg>`;
export function hospitalShortDate(value,today){
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...(value.slice(0,4)!==today.slice(0,4)?{year:'numeric'}:{}),timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
}
