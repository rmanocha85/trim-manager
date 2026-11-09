import {clinicRosterUI} from './clinic-roster.mjs?v=20261108-raac1';
import {avaChartUrl} from './patient-links.mjs';
import {appointmentsForDate,upcomingFriday} from './oat-schedule.mjs';
import {enhanceDateInputs} from './dates.mjs';
export function oatWorkspaceUI({host,onReload}){
  host.classList.add('clinic-workspace','oat-workspace');
  host.innerHTML='<nav class="clinic-filters oat-views" aria-label="OAT FH views"><button data-oat-view="schedule" aria-pressed="true">Schedule</button><button data-oat-view="patients" aria-pressed="false">All patients</button></nav><section data-oat-schedule><div class="clinic-heading"><div><h1>OAT Fraser Health</h1><p>RAAC clinic</p></div></div><div class="oat-day-controls"><label>Clinic date<input type="date" aria-label="Clinic date"></label><button data-upcoming>Upcoming Friday</button><button data-reload>Reload OAT FH</button></div><div class="oat-day-heading"><h2></h2><span class="oat-appointment-count"></span></div><p class="oat-schedule-status" role="status" aria-live="polite"></p><div class="clinic-table-wrap oat-schedule-table"><table class="clinic-table"><caption class="sr-only">RAAC clinic appointments</caption><thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Notes</th></tr></thead><tbody></tbody></table></div><div class="clinic-empty oat-schedule-empty"><h2></h2><p></p></div></section><section data-oat-patients hidden></section>';
  const schedule=host.querySelector('[data-oat-schedule]'),panel=host.querySelector('[data-oat-patients]');
  const rosterUI=clinicRosterUI({host:panel,kind:'oat-fh',onReload});
  let roster=null,loadState='idle',message='';
  const date=host.querySelector('input[type=date]'),rows=host.querySelector('.oat-schedule-table tbody'),table=host.querySelector('.oat-schedule-table'),empty=host.querySelector('.oat-schedule-empty'),status=host.querySelector('.oat-schedule-status');
  date.value=upcomingFriday();
  enhanceDateInputs(schedule);
  function render(){
    const heading=host.querySelector('.oat-day-heading h2');heading.textContent=date.value?new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date.value+'T12:00:00Z')):'Choose a clinic date';
    const slots=roster&&date.value?appointmentsForDate(roster,date.value):null;
    rows.replaceChildren();table.hidden=!slots?.length;empty.hidden=!!slots?.length;
    const patientCount=slots?.filter(s=>s.patientId||s.sourceName).length||0;host.querySelector('.oat-appointment-count').textContent=slots?`${patientCount} appointment${patientCount===1?'':'s'}`:'';
    status.textContent=loadState==='loading'?'Loading clinic schedule…':loadState==='error'?message+(roster?' Showing the last loaded schedule.':''):'';
    status.hidden=!status.textContent;host.querySelector('[data-reload]').disabled=loadState==='loading';
    empty.querySelector('h2').textContent=loadState==='loading'&&!roster?'Loading clinic schedule…':loadState==='error'?'Schedule could not load':!roster?'Connect your workspace':slots?'No appointments':'No schedule saved';
    empty.querySelector('p').textContent=loadState==='error'?message:!roster?'Connect TRIM to load your clinic schedule.':slots?'There are no appointments saved for this date.':'Your appointments will appear here once this clinic schedule is added.';
    for(const slot of slots||[]){
      const row=document.createElement('tr'),time=document.createElement('td'),name=document.createElement('td'),note=document.createElement('td');
      const [hour,minute]=slot.time.split(':').map(Number);time.textContent=`${hour%12||12}:${String(minute).padStart(2,'0')} ${hour<12?'a.m.':'p.m.'}`;time.className='oat-time';
      const url=slot.patient&&avaChartUrl(slot.patient),label=slot.patient?.name||slot.sourceName||slot.label;
      if(url){const link=document.createElement('a');link.textContent=label;link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.title='Open Ava chart';name.append(link);}else name.textContent=label;
      if(slot.sourceName&&!slot.patient){const hint=document.createElement('small');hint.textContent='Patient match needed';name.append(hint);}
      note.textContent=slot.note||'';row.append(time,name,note);rows.append(row);
    }
  }
  host.querySelectorAll('[data-oat-view]').forEach(button=>button.onclick=()=>{const showSchedule=button.dataset.oatView==='schedule';schedule.hidden=!showSchedule;panel.hidden=showSchedule;host.querySelectorAll('[data-oat-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
  date.onchange=render;host.querySelector('[data-upcoming]').onclick=()=>{date.value=upcomingFriday();enhanceDateInputs(schedule);render();};host.querySelector('[data-reload]').onclick=()=>void onReload();render();
  return {
    state:rosterUI.state,
    setRoster(data){roster=structuredClone(data);loadState='ready';message='';rosterUI.setPatients(data.patients);render();},
    loading({preserve=true}={}){if(!preserve)roster=null;loadState='loading';message='';rosterUI.loading({preserve});render();},
    error(text){loadState='error';message=text;rosterUI.error(text);render();}
  };
}
