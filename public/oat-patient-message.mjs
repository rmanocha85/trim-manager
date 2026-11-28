import {patientName} from './patient-names.mjs?v=20261127-names1';
export function oatPatientMessage(patient) {
  const name=patientName(patient);
  const phn=String(patient.phn||'').replace(/\D/g,'');
  return `${name}\nPHN: ${/^\d{10}$/.test(phn)?phn:'Not recorded'}\n\nJust wanted to confirm if this patient is still under my care for OAT in our system?\nThanks!`;
}

export function oatPatientMessages(host,onChange=()=>{}) {
  const dialog=document.createElement('dialog');
  dialog.className='oat-message-dialog';dialog.setAttribute('aria-label','OAT care confirmation');
  dialog.innerHTML='<div class="nurse-dialog-heading"><h2>OAT care confirmation</h2><button type="button" data-oat-close>Close</button></div><label>Message<textarea rows="7"></textarea></label><div class="nurse-actions"><button type="button" data-copy>Copy message</button></div><p role="status" aria-live="polite"></p>';
  const feedback=document.createElement('div');feedback.className='patient-message-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');host.append(dialog,feedback);
  const field=dialog.querySelector('textarea'),copy=dialog.querySelector('[data-copy]'),status=dialog.querySelector('[role=status]'),drafts=new Map();
  let current,timer;
  const draftFor=patient=>{
    const original=oatPatientMessage(patient),key=String(patient.id),prior=drafts.get(key);
    // An edited draft belongs only to this patient and these identifiers.
    if(!prior||prior.original!==original)drafts.set(key,{original,text:original});
    return drafts.get(key);
  };
  function show(patient){
    current=draftFor(patient);field.value=current.text;copy.disabled=!field.value.trim();status.textContent='';
    dialog.showModal();field.focus();onChange();
  }
  function announce(text){
    feedback.textContent=text;feedback.classList.add('visible');clearTimeout(timer);
    timer=setTimeout(()=>{feedback.classList.remove('visible');feedback.textContent='';},4500);
  }
  field.oninput=()=>{current.text=field.value;copy.disabled=!field.value.trim();status.textContent='';};
  dialog.querySelector('[data-oat-close]').onclick=()=>dialog.close();
  dialog.onclose=()=>{current=null;onChange();};
  copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(field.value);status.textContent='Message copied. Paste into Teams.';}
    catch{field.focus();field.select();status.textContent='Select and copy the highlighted text, then paste into Teams.';}
  };
  return {get open(){return dialog.open;},button(patient){
    const button=document.createElement('button');button.type='button';button.className='roster-icon oat-patient-message';
    button.setAttribute('aria-label','Copy OAT care confirmation for '+patientName(patient));
    button.setAttribute('aria-description','Right-click or press Shift+F10 to edit the message');
    button.dataset.rosterTip='Copy OAT care confirmation · Right-click to edit';
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM7 8h10M7 12h7"/></svg>';
    button.onclick=async()=>{
      try{await navigator.clipboard.writeText(draftFor(patient).text);announce('Message copied. Paste into Teams.');}
      catch{show(patient);field.select();status.textContent='Select and copy the highlighted text, then paste into Teams.';}
    };
    button.oncontextmenu=event=>{event.preventDefault();if(!button.disabled)show(patient);};
    button.onkeydown=event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();if(!button.disabled)show(patient);}};
    return button;
  }};
}
