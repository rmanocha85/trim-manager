// Display-only date helpers. Service dates are calendar values, not instants.
export const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function isCalendarDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
  const d=new Date(value+'T12:00:00Z');
  return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;
}
export function formatDate(value){
  if(!isCalendarDate(value))return String(value||'');
  return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(value+'T12:00:00Z'));
}
export function formatTimestamp(value){
  const d=new Date(value);if(!value||!Number.isFinite(+d))return '';
  const date=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(d);
  const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(d);
  return `${date} · ${time}`;
}
// Clinical request date/time is stored as local wall time; never shift its date.
export function formatRequestTime(value){
  const match=String(value||'').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match?`${formatDate(match[1])} · ${match[2]}`:String(value||'');
}

// Retain the ISO-valued source input for existing data handlers. Visible controls
// always spell the month, independent of the browser/OS regional date format.
export function enhanceDateInputs(root=document){
  root.querySelectorAll('input[type=date]:not(#service-date),input[type=datetime-local]').forEach(input=>{
    if(input._dateControl){input._dateControl();return;}
    const timed=input.type==='datetime-local',label=input.getAttribute('aria-label')||input.closest('label')?.firstChild?.textContent?.trim()||'Date';
    const wrapper=document.createElement('span');wrapper.className='named-date-control';wrapper.setAttribute('role','group');wrapper.setAttribute('aria-label',label);
    const row=document.createElement('span');row.className='named-date-parts';wrapper.append(row);
    const select=(part,values)=>{const el=document.createElement('select');el.dataset.datePart=part;el.setAttribute('aria-label',label+' '+part);el.append(new Option(part[0].toUpperCase()+part.slice(1),''));for(const [value,text] of values)el.append(new Option(text,value));row.append(el);return el;};
    const month=select('month',MONTHS.map((m,n)=>[String(n+1).padStart(2,'0'),m]));
    const day=select('day',Array.from({length:31},(_,n)=>[String(n+1).padStart(2,'0'),String(n+1)]));
    const year=document.createElement('input');year.type='number';year.min='1900';year.max='2100';year.placeholder='Year';year.dataset.datePart='year';year.setAttribute('aria-label',label+' year');row.append(year);
    let time;if(timed){time=document.createElement('input');time.type='text';time.inputMode='numeric';time.maxLength=5;time.placeholder='HH:MM';time.setAttribute('aria-label',label+' time');wrapper.append(time);}
    const summary=document.createElement('small');summary.className='named-date-summary';summary.setAttribute('aria-live','polite');wrapper.append(summary);
    input.hidden=true;input.after(wrapper);
    const refresh=()=>{const [d,t]=input.value.split('T'),parts=d.split('-');year.value=parts[0]||'';month.value=parts[1]||'';day.value=parts[2]||'';if(time)time.value=t?.slice(0,5)||'';summary.textContent=d?formatRequestTime(timed?input.value:d):'Choose a date';if(!timed)summary.textContent=d?formatDate(d):'Choose a date';for(const el of [month,day,year,time].filter(Boolean))el.disabled=input.disabled;};
    input._dateControl=refresh;
    const update=()=>{
      const d=`${year.value}-${month.value}-${day.value}`,clock=time?.value.trim().replace(/^(\d{2})(\d{2})$/,'$1:$2');
      const valid=isCalendarDate(d)&&(!input.min||d>=input.min.slice(0,10))&&(!input.max||d<=input.max.slice(0,10))&&(!timed||/^([01]\d|2[0-3]):[0-5]\d$/.test(clock));
      input.value=valid?(timed?`${d}T${clock}`:d):'';
      summary.textContent=valid?(timed?formatRequestTime(input.value):formatDate(d)):'Choose a valid date'+(timed?' and 24-hour time':'');
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    for(const el of [month,day,year,time].filter(Boolean))el.addEventListener('change',update);
    // Lock-state changes must propagate to the visible controls, including in-flight saves.
    new MutationObserver(()=>{for(const el of [month,day,year,time].filter(Boolean))el.disabled=input.disabled;}).observe(input,{attributes:true,attributeFilter:['disabled']});
    refresh();
  });
}
