import {escapeHTML as esc,normalizeManualTime,roundedPacificTime} from './core.mjs?v=20261006-time3';

export function timeField(item,index,field,label,locked){
  const id=`billing-time-${index}-${field}`;
  return `<div class="inline-time"><label for="${id}">${label}</label><div class="time-input-row"><input id="${id}" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="1830 or 18:30" data-time-text data-index="${index}" data-field="${field}" value="${esc(item[field]||'')}" aria-describedby="${id}-hint" ${locked?'disabled':''}><button type="button" class="time-expand" data-time-open="${field}" data-index="${index}" aria-label="Scroll ${label.toLowerCase()} time" aria-controls="${id}-picker" aria-expanded="false" ${locked?'disabled':''}>▾</button></div><div class="inline-time-picker" id="${id}-picker" hidden><div class="inline-time-wheels"><label>Hour<select size="4" data-wheel="hour" aria-label="${label} hour" ${locked?'disabled':''}>${Array.from({length:24},(_,h)=>String(h).padStart(2,'0')).map(h=>`<option value="${h}">${h}</option>`).join('')}</select></label><label>Minute<select size="4" data-wheel="minute" aria-label="${label} minute" ${locked?'disabled':''}>${['00','10','20','30','40','50'].map(m=>`<option value="${m}">${m}</option>`).join('')}</select></label></div><button type="button" class="time-done">Done</button></div><small id="${id}-hint" class="time-hint">24-hour time · type or scroll</small></div>`;
}

export function bindTimeFields(editor,{change,guard}){
  editor.querySelectorAll('.inline-time').forEach(root=>{
    const input=root.querySelector('[data-time-text]'),toggle=root.querySelector('[data-time-open]'),picker=root.querySelector('.inline-time-picker'),hour=root.querySelector('[data-wheel=hour]'),minute=root.querySelector('[data-wheel=minute]');
    const update=()=>change(Number(input.dataset.index),input.dataset.field,input.value);
    input.addEventListener('input',update);
    input.addEventListener('blur',()=>{const normalized=normalizeManualTime(input.value);if(normalized)input.value=normalized;});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}});
    const close=()=>{picker.hidden=true;toggle.setAttribute('aria-expanded','false');};
    toggle.onclick=()=>{if(!guard())return;if(!picker.hidden){close();return;}const current=normalizeManualTime(input.value)||roundedPacificTime();picker.hidden=false;hour.value=current.slice(0,2);minute.value=Number(current.slice(3))%10===0?current.slice(3):'';for(const wheel of [hour,minute]){wheel.scrollTop=Math.max(0,wheel.selectedIndex*wheel.scrollHeight/wheel.options.length-wheel.clientHeight/2);}toggle.setAttribute('aria-expanded','true');};
    for(const wheel of [hour,minute])wheel.onchange=()=>{if(!guard()||!hour.value||!minute.value)return;input.value=`${hour.value}:${minute.value}`;update();};
    root.querySelector('.time-done').onclick=close;
    root.addEventListener('keydown',event=>{if(event.key==='Escape'){close();toggle.focus();}});
  });
}
