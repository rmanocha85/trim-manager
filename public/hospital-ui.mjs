import {hospitalAt,latestHospitalStay} from './hospital.mjs?v=20261024-hospital1';
import {formatDate} from './dates.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function hospitalFlag(patient,date){
  const stay=hospitalAt(patient,date);if(!stay)return '';
  const label='In hospital since '+formatDate(stay.admittedDate);
  return `<span class="hospital-flag" title="${esc(label)}" aria-label="${esc(label)}">H</span>`;
}
export function hospitalSummary(patient,date){
  const stay=latestHospitalStay(patient,date);if(!stay)return '';
  return `<span class="hospital-dates">Hospital admission ${esc(formatDate(stay.admittedDate))} · ${stay.returnedDate&&stay.returnedDate<=date?'Returned '+esc(formatDate(stay.returnedDate)):'In hospital'}</span>`;
}
