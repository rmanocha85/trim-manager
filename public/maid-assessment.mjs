export const assessmentTimeZone='America/Vancouver';
export const urgencyLevels=['unknown','routine','semi-urgent','urgent'];
const hasText=v=>typeof v==='string'&&v.trim().length>0;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export function validateAssessmentPlanning(patient){
  const s=patient.assessmentSchedule,u=patient.assessmentUrgency;
  if(s&&((s.date!==null&&!validDate(s.date))||(s.time!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))||(!s.date&&s.time)||s.timeZone!==assessmentTimeZone||!hasText(s.source)))throw new Error('Invalid 1634 schedule: use a valid date, optional time and source.');
  if(u&&(!urgencyLevels.includes(u.level)||!hasText(u.source)))throw new Error('Invalid assessment urgency or missing source.');
}
export function assessmentPlanningText(patient,now=new Date()){
  const s=patient.assessmentSchedule;
  if(patient.assessmentDate&&(!s?.date||patient.assessmentDate>=s.date))return {label:`Completed ${patient.assessmentDate}`,past:false};
  if(!s?.date)return {label:'Not scheduled',past:false};
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:assessmentTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  return {label:`${s.date} · ${s.time?`${s.time} Pacific`:'Time not set'}`,past:s.date<today};
}
