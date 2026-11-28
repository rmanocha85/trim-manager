import {individualNurseText,messageName} from './nurse-messages.mjs';
import {contactGroup} from './clinic-contacts.mjs';

export function familyMessageContact(patient){
  const contacts=(patient.familyContacts||[]).filter(c=>{
    if(!c)return false;
    const group=contactGroup(c),description=[c.name,c.relationship,c.role,c.type].filter(Boolean).join(' ');
    if(/\b(?:witness|public guardian|trustee|PG\s*[\/&]?\s*T)\b/i.test(description))return false;
    return group==='family'||group==='other';
  });
  const primary=contacts.filter(c=>c.primary===true);
  // A single primary contact is authoritative. Never pick an arbitrary member
  // of a multi-contact list just to avoid a recipient dialog.
  return primary.length===1?primary[0]:primary.length===0&&contacts.length===1?contacts[0]:null;
}
function firstName(contact){
  const name=String(contact?.name||'').trim();
  if(!name)return '';
  const given=name.includes(',')?name.slice(name.indexOf(',')+1).trim():name;
  const first=given.split(/\s+/)[0];
  return /^(?:mr|mrs|ms|dr|unknown|not|public|pg\/?t)\.?$/i.test(first)?'':first;
}
export function familyMessageText(patient){
  const contact=familyMessageContact(patient),first=firstName(contact);
  const subject=messageName(patient.name)||'your family member';
  return `Hi${first?' '+first:''},\n\nThis is Dr Manocha from TRIM. I’d like to speak with you urgently about ${subject}.\nCould you please let me know when you’re available for a call?\n\nDr Rahul Manocha`;
}
export function rosterMessageText(kind,patient,units=[]){
  if(kind==='nurse')return individualNurseText(patient,units);
  if(kind==='family')return familyMessageText(patient);
  throw new Error('Unknown message type.');
}
const svg='viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
export const nurseMessageIcon=`<svg ${svg}><path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 4V5a2 2 0 0 1 2-2Z"/><path d="M12 6v9m-4.5-4.5h9"/></svg>`;
export const familyMessageIcon=`<svg ${svg}><circle cx="8" cy="7" r="3.5"/><path d="M1.5 21v-3a6.5 6.5 0 0 1 13 0v3M16 3.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 4.5 5v2"/></svg>`;
