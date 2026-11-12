import {assessmentDateLabel,assessmentToday} from './maid-assessment.mjs?v=20261112-provision1';
export function dateCalendar(host,dateInput){
  let calendarMonth=assessmentToday().slice(0,7);
  function renderCalendar(){
    const first=new Date(calendarMonth+'-01T12:00:00Z'),year=first.getUTCFullYear(),month=first.getUTCMonth();
    host.querySelector('.planning-calendar h3').textContent=new Intl.DateTimeFormat('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
    host.querySelector('.planning-selected').textContent=dateInput.value?`Selected: ${assessmentDateLabel(dateInput.value)}`:'No date selected';
    const days=host.querySelector('.planning-days');days.replaceChildren();
    for(let i=0;i<first.getUTCDay();i++)days.append(document.createElement('span'));
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate(),today=assessmentToday();
    for(let day=1;day<=last;day++){
      const date=`${calendarMonth}-${String(day).padStart(2,'0')}`,button=document.createElement('button');button.type='button';button.textContent=String(day);button.dataset.date=date;
      button.setAttribute('aria-label',assessmentDateLabel(date));button.setAttribute('aria-pressed',String(dateInput.value===date));if(date===today)button.setAttribute('aria-current','date');
      button.onclick=()=>{dateInput.value=date;renderCalendar();days.querySelector(`[data-date="${date}"]`).focus();};days.append(button);
    }
  }
  host.querySelectorAll('[data-month]').forEach(button=>button.onclick=()=>{
    const month=new Date(calendarMonth+'-01T12:00:00Z');month.setUTCMonth(month.getUTCMonth()+Number(button.dataset.month));calendarMonth=month.toISOString().slice(0,7);renderCalendar();
  });
  host.querySelector('[data-today]').onclick=()=>{calendarMonth=assessmentToday().slice(0,7);renderCalendar();};
  return {render:renderCalendar,reset(){calendarMonth=assessmentToday().slice(0,7);renderCalendar();}};
}
