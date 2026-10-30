import {withProfile} from './profile-display.mjs?v=20261030-layout4';
import {avaChartUrl} from './patient-links.mjs';
import {today,dateParts} from './patients-core.mjs?v=20261024-hospital2';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const MOST_OPTIONS=['','CPR C2','DNACPR C2','DNACPR C1','DNACPR M3','DNACPR M2','DNACPR M1'];
export function ageOn(dob,asOf=today()){
  try{const [y,m,d]=dateParts(dob),[ay,am,ad]=dateParts(asOf);if(dob>asOf)return null;const n=ay-y-Number(am<m||am===m&&ad<d);return n>=0&&n<130?n:null;}catch{return null;}
}
export function newPatient(p,asOf=today()){
  if(!p.newPanelPatient)return false;
  try{dateParts(p.panelAddedDate);dateParts(asOf);const days=(Date.parse(asOf)-Date.parse(p.panelAddedDate))/86400000;return days>=0&&days<14;}catch{return false;}
}
export function validateDemographics(fields){
  if(fields.dateOfBirth&&ageOn(fields.dateOfBirth)===null)throw new Error('Enter a valid date of birth.');
  if(fields.mostStatus&&!MOST_OPTIONS.includes(fields.mostStatus))throw new Error('Choose the exact documented MOST status.');
  return fields;
}
export function nameCopy(name){return `<button type="button" class="identity-copy name-copy" data-copy-value="${esc(name)}" aria-label="Copy name: ${esc(name)}" title="Copy Last name, First name"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg></button>`;}
export function nameHTML(p){return `<span class="identity-name">${esc(p.name)}</span>${nameCopy(p.name)}`;}
export function avaHTML(p){const url=avaChartUrl(p);return url?`<a class="identity-ava ava-chart-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Open Ava chart for ${esc(p.name)}">Ava ↗</a>`:'';}
export function phnHTML(p){const phn=String(p.phn||'').replace(/\D/g,'');return `<span class="identity-phn">${esc(phn||'—')}${/^\d{10}$/.test(phn)?`<button type="button" class="identity-copy billing-phn-copy" data-copy-value="${phn}" aria-label="Copy PHN for ${esc(p.name)}" title="Copy PHN"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V3H3v13h5"/></svg></button>`:''}</span>`;}
export function demographicsHTML(p,asOf=today()){
  const raw=p;p=withProfile(p);const age=ageOn(p.dateOfBirth||p.dob,asOf),most=p.mostStatus||'';
  return `<span class="identity-demographics" data-profile-phn="${esc(raw.phn)}" data-profile-dob="${esc(raw.dateOfBirth||raw.dob||'')}" data-profile-most="${esc(raw.mostStatus||'')}" data-profile-new="${raw.newPanelPatient?'yes':''}" data-profile-added="${esc(raw.panelAddedDate||'')}"><span class="identity-age">${age===null?'Age —':age+' y'}</span><span class="identity-most" title="${esc(p.mostEvidence||(most?'Documented MOST status':'MOST not recorded'))}">${most?esc(most):'—'}</span>${newPatient(p,asOf)?'<span class="identity-new">New patient</span>':''}</span>`;
}
export function identityHTML(p,{asOf=today(),compact=false}={}){return `<span class="patient-identity${compact?' compact':''}"><span class="identity-top">${nameHTML(p)}</span><span class="identity-details">${phnHTML(p)}${demographicsHTML(p,asOf)}${avaHTML(p)}</span></span>`;}
export function bindIdentity(root){
  if(root.__identityBound)return;root.__identityBound=true;
  root.addEventListener('click',async e=>{const b=e.target.closest?.('[data-copy-value]');if(!b)return;e.preventDefault();e.stopPropagation();
    let status=root.querySelector('.identity-feedback');if(!status){status=document.createElement('span');status.className='identity-feedback';status.setAttribute('role','status');(root.body||root).append(status);}
    try{await navigator.clipboard.writeText(b.dataset.copyValue);status.textContent=b.classList.contains('name-copy')?'Name copied':'PHN copied';}catch{status.textContent='Could not copy. Select the text and copy manually.';}
    clearTimeout(root.__identityTimer);root.__identityTimer=setTimeout(()=>{status.textContent='';},1800);
  });
}

export function refreshIdentities(root){for(const el of root.querySelectorAll('[data-profile-phn]')){const d=el.dataset;el.outerHTML=demographicsHTML({phn:d.profilePhn,dateOfBirth:d.profileDob,mostStatus:d.profileMost,newPanelPatient:d.profileNew==='yes',panelAddedDate:d.profileAdded});}}
