import {escapeHTML as esc} from './core.mjs?v=20261119-export1';
import {phoneLink} from './clinic-contacts.mjs?v=20261108-closeout1';

export const handset = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M21 16.5v2.8a1.6 1.6 0 0 1-1.8 1.6A18.3 18.3 0 0 1 3.1 4.8 1.6 1.6 0 0 1 4.7 3h2.8l1.6 4.8-2 1.8a13.7 13.7 0 0 0 7.3 7.3l1.8-2z"/></svg>';
const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg>';

export function phoneControls(contact, label) {
  const raw = String(contact.phone || '').trim();
  const number = phoneLink(raw, contact.extension);
  const details = [label,raw,contact.extension && 'Extension '+contact.extension].filter(Boolean).join('\n');
  const who = esc(label || 'contact');
  const call = number ? `<a class="roster-icon" href="${esc(number.href)}" aria-label="Call ${who} at ${esc(raw)}">${handset}</a>` : '';
  const copy = raw ? `<button type="button" class="roster-icon" data-copy-value="${esc(raw)}" data-copy-feedback="Number copied" aria-label="Copy number for ${who}">${copyIcon}</button>` : '';
  return `<span class="roster-phone" data-roster-tip="${esc(details)}">${call}${copy}${raw?'':'<span tabindex="0" aria-label="'+who+': phone not recorded">—</span>'}</span>`;
}

// The top layer keeps hints visible inside horizontally scrolling roster tables.
export function bindRosterTips(root) {
  const tip = document.createElement('div');
  tip.popover = 'manual';
  tip.className = 'roster-tip';
  tip.setAttribute('role','tooltip');
  root.append(tip);
  let current;
  function hide() {
    if (!current) return;
    tip.hidePopover();
    current = null;
  }
  function show(event) {
    const item = event.target.closest?.('[data-roster-tip]');
    if (!item || item === current) return;
    current = item;
    tip.textContent = item.dataset.rosterTip;
    tip.showPopover();
    const box = item.getBoundingClientRect();
    tip.style.left = Math.max(6,Math.min(box.left,innerWidth-tip.offsetWidth-6))+'px';
    tip.style.top = (box.bottom+tip.offsetHeight+6<=innerHeight ? box.bottom+5 : Math.max(5,box.top-tip.offsetHeight-5))+'px';
  }
  function leave(event) {
    if (current?.contains(event.target) && !current.contains(event.relatedTarget)) hide();
  }
  root.addEventListener('pointerover',show);
  root.addEventListener('focusin',show);
  root.addEventListener('pointerout',leave);
  root.addEventListener('focusout',leave);
  root.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
  root.addEventListener('click',hide);
  root.addEventListener('scroll',hide,true);
  window.addEventListener('scroll',hide,true);
  window.addEventListener('resize',hide);
  return hide;
}
