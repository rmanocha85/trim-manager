const datePattern=/^\d{4}-\d{2}-\d{2}$/;
export function validClinicDate(value){return typeof value==='string'&&datePattern.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function pacificDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function upcomingFriday(today=pacificDate()){
  if(!validClinicDate(today))throw new Error('Choose a valid clinic date.');
  const day=new Date(today+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+(5-day.getUTCDay()+7)%7);return day.toISOString().slice(0,10);
}
export function validateClinicDays(days,patients){
  if(!Array.isArray(days))throw new Error('OAT clinic days must be a list.');
  const dates=new Set(),known=new Set(patients.map(p=>p.id));
  for(const day of days){
    if(!day||!validClinicDate(day.date)||dates.has(day.date)||!Array.isArray(day.appointments))throw new Error('Invalid or duplicate OAT clinic date.');
    dates.add(day.date);const ids=new Set();
    for(const slot of day.appointments){
      if(!slot||typeof slot.id!=='string'||!slot.id||ids.has(slot.id)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)||slot.patientId&&!known.has(slot.patientId)||!slot.patientId&&![slot.sourceName,slot.label].some(v=>typeof v==='string'&&v.trim())||['sourceName','label','note'].some(k=>slot[k]!=null&&typeof slot[k]!=='string'))throw new Error('Invalid OAT appointment or unmatched roster ID.');
      ids.add(slot.id);
    }
  }
  return days;
}
export function appointmentsForDate(roster,date){
  const day=(roster.clinicDays||[]).find(d=>d.date===date),patients=new Map(roster.patients.map(p=>[p.id,p]));
  return day?day.appointments.map((slot,index)=>({...slot,patient:patients.get(slot.patientId),index})).sort((a,b)=>a.time.localeCompare(b.time)||a.index-b.index):null;
}
