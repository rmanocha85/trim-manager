import {individualNurseText,messageName} from './nurse-messages.mjs';
import {contactGroup} from './clinic-contacts.mjs';

// Relationships describe the contact relative to the patient. Reverse them for
// the message, using neutral wording rather than inferring anyone's gender.
const patientRelationship=new Map([
  ...['son','daughter','child'].map(role=>[role,'parent']),
  ...['mother','father','parent'].map(role=>[role,'child']),
  ...['wife','husband','spouse'].map(role=>[role,'spouse']),
  ['partner','partner'],...['sister','brother','sibling'].map(role=>[role,'sibling']),
  ...['grandson','granddaughter','grandchild'].map(role=>[role,'grandparent']),
  ...['grandmother','grandfather','grandparent'].map(role=>[role,'grandchild']),
  ['friend','friend'],['cousin','cousin']
]);
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
  const relation=patientRelationship.get(String(contact?.relationship||'').trim().toLowerCase());
  const subject=relation?'your '+relation:messageName(patient.name)||'your family member';
  return `Hi${first?' '+first:''},\n\nThis is Dr Manocha from TRIM calling about ${subject}.\nCould I please speak to you urgently?\n\n-Dr Rahul Manocha`;
}
export function rosterMessageText(kind,patient,units=[]){
  if(kind==='nurse')return individualNurseText(patient,units);
  if(kind==='family')return familyMessageText(patient);
  throw new Error('Unknown message type.');
}
const svg='viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
export const nurseMessageIcon=`<svg ${svg}><circle cx="9" cy="7" r="3.5"/><path d="M2 21v-3a7 7 0 0 1 12-4M18 11v10m-5-5h10"/></svg>`;
export const familyMessageIcon=`<svg ${svg}><circle cx="7" cy="7" r="3"/><path d="M1 20v-2a6 6 0 0 1 10-4m3-10a3 3 0 0 1 0 6"/><path d="M14 13h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4l-3 2v-8a1 1 0 0 1 1-1Z"/></svg>`;
