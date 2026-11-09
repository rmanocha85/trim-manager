// Presentation only: source records, their order and their verification metadata stay intact.
export function contactGroup(contact) {
  const role=String(contact.role||'').trim(), relationship=String(contact.relationship||'').trim();
  const type=String(contact.type||'').toLowerCase();
  if(type==='patient'||/^(patient|self)(?:$|\s*[-–—(])/.test(role.toLowerCase())||/^self$/i.test(relationship))return 'patient';
  const labels=[role,relationship,type].join(' ');
  if(/\bwitness\b/i.test(labels))return 'other';
  if(/\b(inpatient|care team|health care|healthcare|provider|nurs(?:e|ing)|physician|doctor|social worker|unit|ward|facility|hospice|hospital|prescriber|assessor)\b/i.test(labels)||type==='care')return 'care';
  if(contact.primary===true||/\b(family|preferred contact|primary contact|next of kin|spouse|partner|wife|husband|son|daughter|child|parent|mother|father|sister|brother|friend|caregiver|niece|nephew|cousin|grandchild|grandson|granddaughter)\b/i.test(labels))return 'family';
  return 'other';
}

export function contactGroups(contacts=[]) {
  const groups={patient:[],family:[],care:[],other:[]};
  for(const contact of contacts||[])if(contact&&typeof contact==='object')groups[contactGroup(contact)].push(contact);
  return groups;
}

export function contactRole(contact) {
  return [...new Set([contact.role,contact.relationship].filter(Boolean))].join(' · ');
}

// Only a single recognizable phone number becomes a link. Never concatenate alternatives,
// execute supplied URI text, or send an extension as part of the external number.
export function phoneLink(phone,extension) {
  const raw=String(phone||'').trim();
  const match=raw.match(/^(\+?[\d().\s-]+?)(?:\s*(?:ext\.?|extension|x|#)\s*(\d{1,8}))?$/i);
  if(!match)return null;
  const digits=match[1].replace(/\D/g,'');
  if(digits.length<7||digits.length>15)return null;
  const inlineExtension=match[2]||'',separateExtension=String(extension||'').trim();
  if(separateExtension&&!/^\d{1,8}$/.test(separateExtension))return null;
  if(inlineExtension&&separateExtension&&inlineExtension!==separateExtension)return null;
  return {href:`tel:${match[1].trim().startsWith('+')?'+':''}${digits}`,extension:inlineExtension||separateExtension};
}
