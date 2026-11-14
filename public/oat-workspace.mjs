import {clinicRosterUI} from './clinic-roster.mjs?v=20261112-provision1';
import {avaChartUrl} from './patient-links.mjs';
import {appointmentsForDate,upcomingFriday} from './oat-schedule.mjs?v=20261113-combined1';
import {dateCalendar} from './maid-date-calendar.mjs?v=20261113-combined1';
import {formatDate} from './dates.mjs';
export function oatWorkspaceUI({host,onReload,onFinish,onChange=()=>{}}){
  host.classList.add('clinic-workspace','oat-workspace');
  const tableMarkup=caption=>'<table class="clinic-table"><caption class="sr-only">'+caption+'</caption><thead><tr><th scope="col">Time</th><th scope="col">Finished</th><th scope="col">Patient</th><th scope="col">PHN</th><th scope="col">Notes</th></tr></thead><tbody></tbody></table>';
  host.innerHTML='<nav class="clinic-filters oat-views" aria-label="OAT FH views"><button data-oat-view="schedule" aria-pressed="true">Schedule</button><button data-oat-view="patients" aria-pressed="false">All patients</button></nav><section data-oat-schedule><div class="clinic-heading"><div><h1>OAT Fraser Health</h1><p>RAAC clinic</p></div></div><div class="oat-day-controls"><input type="hidden" data-clinic-date><button data-calendar popovertarget="oat-calendar" aria-label="Choose clinic date"></button><button data-upcoming>Upcoming Friday</button><button data-reload>Reload OAT FH</button></div><div id="oat-calendar" popover><section class="planning-calendar" aria-label="Clinic date calendar"><div class="planning-calendar-nav"><button type="button" data-month="-1" aria-label="Previous month">‹</button><h3 aria-live="polite"></h3><button type="button" data-month="1" aria-label="Next month">›</button></div><div class="planning-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="planning-days"></div><button type="button" data-today>Current month</button><p class="planning-selected" aria-live="polite"></p></section></div><div class="oat-day-heading"><h2></h2><span class="oat-appointment-count"></span></div><div class="oat-search"><label>Find a patient<input type="search" placeholder="Search this day · name, PHN or notes" aria-label="Search clinic day"></label></div><p class="oat-schedule-status" role="status" aria-live="polite"></p><p class="oat-save-status" role="status" aria-live="polite"></p><div class="clinic-table-wrap oat-schedule-table">'+tableMarkup('Remaining appointments')+'</div><div class="clinic-empty oat-schedule-empty"><h2></h2><p></p></div><details class="oat-completed"><summary>Show Completed</summary><div class="clinic-table-wrap">'+tableMarkup('Completed appointments')+'</div><p data-completed-empty>No completed appointments.</p></details></section><section data-oat-patients hidden></section>';
  const schedule=host.querySelector('[data-oat-schedule]'),panel=host.querySelector('[data-oat-patients]');
  const rosterUI=clinicRosterUI({host:panel,kind:'oat-fh',onReload});
  let roster=null,loadState='idle',message='',busy=false,query='';
  const date=host.querySelector('[data-clinic-date]'),rows=host.querySelector('.oat-schedule-table tbody'),table=host.querySelector('.oat-schedule-table'),empty=host.querySelector('.oat-schedule-empty'),status=host.querySelector('.oat-schedule-status'),feedback=host.querySelector('.oat-save-status'),completed=host.querySelector('.oat-completed'),doneRows=completed.querySelector('tbody'),popover=host.querySelector('#oat-calendar');
  date.value=upcomingFriday();
  const calendar=dateCalendar(popover,date,{onSelect:()=>{popover.hidePopover();feedback.textContent='';render();host.querySelector('[data-calendar]').focus();}});
  popover.addEventListener('beforetoggle',e=>{if(e.newState==='open')calendar.reset();});
  function rowFor(slot){
    const row=document.createElement('tr');row.dataset.appointment=slot.id;
    const cell=()=>{const td=document.createElement('td');row.append(td);return td;};
    const time=cell(),finish=cell(),name=cell(),phn=cell(),note=cell();finish.className="oat-finished";phn.className="oat-phn";
    const [hour,minute]=slot.time.split(':').map(Number);time.textContent=(hour%12||12)+':'+String(minute).padStart(2,'0')+' '+(hour<12?'a.m.':'p.m.');time.className='oat-time';
    const url=slot.patient&&avaChartUrl(slot.patient),label=slot.patient?.name||slot.sourceName||slot.label;
    if(url){const link=document.createElement('a');link.textContent=label;link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.title='Open Ava chart';name.append(link);}else name.textContent=label;
    if(slot.sourceName&&!slot.patient){const hint=document.createElement('small');hint.textContent='Patient match needed';name.append(hint);}
    if(slot.patient&&!url){const hint=document.createElement('small');hint.textContent='Ava number pending';name.append(hint);}
    const digits=String(slot.patient?.phn||'').replace(/\D/g,'');
    if(/^\d{10}$/.test(digits)){
      const value=document.createElement('span');value.textContent=digits;phn.append(value);
      const copy=document.createElement('button');copy.type='button';copy.className='clinic-phn-copy';copy.title='Copy PHN';copy.setAttribute('aria-label','Copy PHN for '+label);copy.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg>';
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(digits);feedback.textContent='PHN copied.';}catch{feedback.textContent='Could not copy. Select the displayed PHN to copy it.';}};phn.append(copy);
    }else phn.textContent=slot.patientId||slot.sourceName?'Not recorded':'';
    note.textContent=slot.note||'';
    if(slot.patientId||slot.sourceName){
      const check=document.createElement('input');check.type='checkbox';check.checked=slot.finished===true;check.disabled=busy||loadState!=='ready'||!onFinish;check.setAttribute('aria-label','Finished appointment for '+label);finish.append(check);
      check.onchange=async()=>{
        const action={date:date.value,appointmentId:slot.id,finished:check.checked,expected:{patientId:slot.patientId,sourceName:slot.sourceName,time:slot.time,finished:slot.finished===true}};
        busy=true;feedback.textContent='Saving…';onChange();
        try{
          // Begin within the checkbox gesture so expired Google access can renew.
          const saving=onFinish(action);schedule.querySelectorAll('[data-reload],[data-upcoming],[data-calendar],input[type=checkbox]').forEach(el=>el.disabled=true);const saved=await saving;
          roster=structuredClone(saved.roster);rosterUI.setPatients(roster.patients);feedback.textContent=saved.local?'Saved to laptop folder · cloud sync unverified.':'Saved.';
        }catch(error){loadState='error';message=error.message+' Reload OAT FH to check the saved status.';feedback.textContent='Finished status was not confirmed.';}
        finally{busy=false;render();onChange();}
      };
    }
    return row;
  }
  function render(){
    host.querySelector('[data-calendar]').textContent='📅 '+formatDate(date.value);
    host.querySelector('.oat-day-heading h2').textContent=formatDate(date.value);
    const slots=roster?appointmentsForDate(roster,date.value):null;
    const matches=slot=>[slot.patient?.name,slot.patient?.phn,slot.sourceName,slot.note,slot.time].join(' ').toLocaleLowerCase().includes(query)||(/^[-\d\s]+$/.test(query)&&String(slot.patient?.phn||'').replace(/\D/g,'').includes(query.replace(/\D/g,'')));
    const remaining=(slots||[]).filter(s=>!s.finished&&matches(s)),done=(slots||[]).filter(s=>s.finished&&matches(s));
    rows.replaceChildren(...remaining.map(rowFor));doneRows.replaceChildren(...done.map(rowFor));table.hidden=!remaining.length;empty.hidden=!!remaining.length;
    completed.hidden=!slots;completed.querySelector('.clinic-table-wrap').hidden=!done.length;completed.querySelector('[data-completed-empty]').hidden=!!done.length;
    completed.querySelector('[data-completed-empty]').textContent=query?'No completed appointments match your search.':'No completed appointments.';
    const count=slots?.filter(s=>s.patientId||s.sourceName).length||0;host.querySelector('.oat-appointment-count').textContent=slots?count+' appointment'+(count===1?'':'s'):'';
    status.textContent=loadState==='loading'?'Loading clinic schedule…':loadState==='error'?message+(roster?' Showing the last loaded schedule.':''):'';status.hidden=!status.textContent;
    for(const selector of ['[data-reload]','[data-calendar]','[data-upcoming]'])host.querySelector(selector).disabled=busy||loadState==='loading';
    empty.querySelector('h2').textContent=loadState==='loading'&&!roster?'Loading clinic schedule…':loadState==='error'?'Schedule needs attention':!roster?'Connect your workspace':query?'No matches':slots?.length?'No appointments remaining':slots?'No appointments':'No schedule saved';
    empty.querySelector('p').textContent=loadState==='error'?message:!roster?'Connect TRIM to load your clinic schedule.':query?'Try another name, PHN or note.':slots?.length?'Open Show Completed to review finished appointments.':'Your appointments will appear here once this clinic schedule is added.';
  }
  host.querySelectorAll('[data-oat-view]').forEach(button=>button.onclick=()=>{const showSchedule=button.dataset.oatView==='schedule';schedule.hidden=!showSchedule;panel.hidden=showSchedule;host.querySelectorAll('[data-oat-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
  host.querySelector('[type=search]').oninput=e=>{query=e.target.value.trim().toLocaleLowerCase();render();};
  host.querySelector('[data-upcoming]').onclick=()=>{date.value=upcomingFriday();feedback.textContent='';render();};host.querySelector('[data-reload]').onclick=()=>void onReload();render();
  return {
    state:()=>({...rosterUI.state(),busy}),
    setRoster(data){if(busy)return;feedback.textContent='';roster=structuredClone(data);loadState='ready';message='';rosterUI.setPatients(data.patients);render();},
    loading({preserve=true}={}){if(busy)return;if(!preserve)roster=null;loadState='loading';message='';rosterUI.loading({preserve});render();},
    error(text){loadState='error';message=text;rosterUI.error(text);render();}
  };
}
