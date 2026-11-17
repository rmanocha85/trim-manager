// Clinical fields shared by document intake, Notes, and the existing-record migration.
const historyHeading = /^(?:pmhx\b|(?:past )?(?:medical|surgical) history\b|history and active issues\b|active problems and important history\b|additional history from\b)/i;
const allergyHeading = /^(?:(?:drug |food )?allerg(?:y|ies)(?:\s*[/&-]\s*(?:intolerances?|adverse reactions?))?|allergies and intolerances?)$/i;
const allergyWords = /\ballerg(?:y|ies|ic)\b|\b(?:NKDA|NKA)\b/i;
const unavailable = /unable to assess|cannot assess|could not (?:be )?assess|allerg(?:y|ies)(?: information| status| history)? (?:is |are |was |were )?(?:not (?:documented|supplied|available|recorded|known)|unknown|unavailable)|no (?:known )?allergy information|does not establish no known/i;
const noneKnown = /\b(?:NKDA|NKA)\b|\bno known (?:(?:drug|food|medication)(?:\s*(?:\/|or|and)\s*(?:drug|food|medication))?\s+)?allerg(?:y|ies)\b/i;
const allergyStates = ['documented','noneKnown','unableToAssess','notDocumented'];
const cleanBullet = line => line.trim().replace(/^[-*•]\s+/, '').trim();
const keyOf = text => text.trim().replace(/\s+/g,' ').toLowerCase();
const realDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;

function agreedDate(values) {
  const dates = [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
  if (dates.some(value => !realDate(value) || value>new Date().toISOString().slice(0,10))) throw new Error('Invalid date of birth in patient demographics.');
  if (dates.length > 1) throw new Error('DOB conflict needs review.');
  return dates[0] || null;
}

function allergyEntry(line) {
  const text = cleanBullet(line);
  if (!text) return null;
  let status = 'documented';
  if (unavailable.test(text)) status = /unable to assess|cannot assess|could not (?:be )?assess/i.test(text) ? 'unableToAssess' : 'notDocumented';
  else if (noneKnown.test(text)) {
    // A scoped negative can coexist with a named allergy in the same sentence.
    const negative = text.match(noneKnown);
    const before = text.slice(0,negative.index), after = text.slice(negative.index+negative[0].length);
    const hasNamed = /[;:]|\breactions?\b|\b(?:anaphylaxis|hives)\b/i.test(before.replace(/(?:allergy (?:section|table)|admission)\s*:\s*$/i,'')) ||
      /\b(?:and|but|except)\s+(?:an?\s+)?[^.;]*\ballerg(?:y|ic)\b|\b(?:anaphylaxis|hives)\b/i.test(after);
    if (!hasNamed) status = 'noneKnown';
  }
  return {status,text};
}
function makeAllergies(entries) {
  const unique = new Map();
  for (const entry of entries) {
    if (!entry || !allergyStates.includes(entry.status) || typeof entry.text !== 'string' || !entry.text.trim()) throw new Error('Invalid allergy statement.');
    unique.set(keyOf(entry.text),{status:entry.status,text:entry.text.trim()});
  }
  const items = [...unique.values()];
  return {status:allergyStates.find(state=>items.some(entry=>entry.status===state)) || 'notDocumented',entries:items};
}
function historyText(text) {
  const hasHistory = text.split(/\r?\n/).map(cleanBullet).some(line=>line && !/^#/.test(line) && !/^(?:(?:(?:past )?medical history|pmhx|history)\s*[:–-]?\s*)?(?:not (?:provided|documented|available|supplied)|unknown|unavailable)\.?$/i.test(line));
  return {status:hasHistory?'documented':'notDocumented',text};
}
function joinBlocks(blocks) { return blocks.map(block=>block.trim()).filter(Boolean).join('\n\n'); }

// Split only explicitly labelled history and allergy statements. Mixed sections
// keep their functional, investigation and treatment-history text in place.
function splitSummary(markdown='') {
  const dates=[], sources=[], history=[], allergies=[], remaining=[], blocks=[];
  let block={title:'',heading:'',lines:[]};
  for (const line of String(markdown||'').split(/\r?\n/)) {
    const dob=line.match(/^\s*(?:DOB|Date of birth)\s*:\s*(.*?)\s*$/i);
    const source=line.match(/^\s*(?:DOB|Date of birth) source\s*:\s*(.+?)\s*$/i);
    const reconciliation=line.match(/^\s*DOB reconciliation\s*:\s*(.+?)\s*$/i);
    if (reconciliation) { sources.push('Reconciliation: '+reconciliation[1]); continue; }
    if (dob) { dates.push(dob[1]); continue; }
    if (source) { sources.push(source[1]); continue; }
    const heading=line.match(/^\s*#{1,6}\s+(.+?)\s*$/) || line.match(/^\s*\*\*([^*]+)\*\*\s*:?\s*$/);
    if (heading) { blocks.push(block); block={title:heading[1].replace(/[:*#\s]+$/g,''),heading:line,lines:[]}; }
    else block.lines.push(line);
  }
  blocks.push(block);
  for (const {title,heading,lines} of blocks) {
    const pureAllergy=allergyHeading.test(title), retained=[];
    for (const line of lines) {
      if (pureAllergy) { const entry=allergyEntry(line); if(entry) allergies.push(entry); continue; }
      if (!allergyWords.test(line)) {retained.push(line); continue;}
      const sentences=cleanBullet(line).split(/(?<=[.!?])\s+(?=[A-Z])/);
      const rest=[];
      for (const sentence of sentences) {
        const explicit=noneKnown.test(sentence)||unavailable.test(sentence)||/\ballerg(?:y|ies|ic) (?:to|with)\b|\ballerg(?:y|ies)\s*:|(?:listed|recorded|documented) as an? allergy/i.test(sentence);
        if (explicit && !/\b(?:family history of|mother|father|sibling)\b|no allergy inferred|not an inferred .*allergy|not an allergy|do not infer an allergy|does not (?:confirm|establish) an allergy/i.test(sentence)) allergies.push(allergyEntry(sentence));
        else rest.push(sentence);
      }
      if(rest.length===sentences.length) retained.push(line);
      else if(rest.length) retained.push((line.match(/^\s*[-*•]\s+/)?.[0]||'')+rest.join(' '));
    }
    if (!pureAllergy && retained.some(line=>line.trim())) {
      (historyHeading.test(title)?history:remaining).push([heading,...retained].filter((v,i)=>i||v).join('\n'));
    }
  }
  return {summaryMarkdown:joinBlocks(remaining),history:joinBlocks(history),allergies,dateOfBirth:agreedDate(dates),source:[...new Set(sources)].join('\n')};
}

function addHistory(existing,addition) {
  if (!addition?.trim()) return existing;
  if (!existing.trim()) return addition.trim();
  const known=new Set(existing.split(/\r?\n/).map(line=>keyOf(cleanBullet(line))));
  const extra=addition.split(/\r?\n/).filter(line=>line.trim() && !known.has(keyOf(cleanBullet(line))));
  return extra.some(line=>!/^#/.test(line)) ? joinBlocks([existing,extra.join('\n')]) : existing;
}
export function organizePatient(context={},roster={}) {
  const parts=splitSummary(context.summaryMarkdown);
  const {dob:legacyDob,dateOfBirth:legacyDate,dateOfBirthSource:legacySource,...rest}=context;
  const {dob:identityDob,...patient}=context.patient||{};
  patient.dateOfBirth=agreedDate([patient.dateOfBirth,identityDob,legacyDate,legacyDob,parts.dateOfBirth,roster.dateOfBirth,roster.dob]);
  const source=[...new Set([patient.dateOfBirthSource,legacySource,parts.source].filter(Boolean))].join('\n');
  if(source) patient.dateOfBirthSource=source;
  else if(patient.dateOfBirth && (roster.dateOfBirth||roster.dob)) patient.dateOfBirthSource='TRIM roster demographics';
  return {...rest,patient,summaryMarkdown:parts.summaryMarkdown,medicalHistory:historyText(addHistory(context.medicalHistory?.text||'',parts.history)),allergies:makeAllergies([...(context.allergies?.entries||[]),...parts.allergies])};
}
export function fullProfileSummary(context={}) {
  const c=organizePatient(context), text=c.medicalHistory.text;
  const firstLine=text.split('\n',1)[0].replace(/^#+\s*|^\*\*|\*\*$/g,'');
  const history=text && (/^(?:#|\*\*)/.test(text)&&historyHeading.test(firstLine)?text:'## PMHx\n'+text);
  return joinBlocks([history,c.summaryMarkdown,c.allergies.entries.length?'## Allergies\n'+c.allergies.entries.map(e=>'- '+e.text).join('\n'):'']);
}

// Intake sends only new history/allergy evidence. A silent or partial upload
// cannot erase an established history, allergy, or the exact scope of NKDA.
export function profileUpdate(current={},summary='',updates={}) {
  const old=organizePatient(current), parts=splitSummary(summary);
  const patient={...old.patient,dateOfBirth:agreedDate([old.patient.dateOfBirth,parts.dateOfBirth,updates.dateOfBirth])};
  if(parts.source&&!patient.dateOfBirthSource) patient.dateOfBirthSource=parts.source;
  if(updates.dateOfBirth&&!old.patient.dateOfBirth&&!patient.dateOfBirthSource) patient.dateOfBirthSource='Uploaded document';
  const explicit=updates.medicalHistory;
  if(explicit!=null&&typeof explicit!=='string') throw new Error('Invalid medical history.');
  if(updates.allergies!=null&&!Array.isArray(updates.allergies)) throw new Error('Invalid allergy extraction.');
  const history=addHistory(addHistory(old.medicalHistory.text,parts.history),explicit);
  // A physician may edit a complete profile; retain the recorded classification
  // for verbatim statements, including qualifiers originally supplied at intake.
  const known=new Map(old.allergies.entries.map(entry=>[keyOf(entry.text),entry]));
  const fromSummary=parts.allergies.map(entry=>known.get(keyOf(entry.text))||entry);
  return {patient,summaryMarkdown:parts.summaryMarkdown||old.summaryMarkdown,medicalHistory:historyText(history),allergies:makeAllergies([...old.allergies.entries,...fromSummary,...(updates.allergies||[])])};
}

export function editProfileSection(context,field,text) {
  const existing=organizePatient(context);
  if(field==='medicalHistory'){
    if(/^\s*(?:DOB|Date of birth)(?:\s+(?:source|reconciliation))?\s*:/im.test(text)){
      const separated=profileUpdate(existing,text);
      const clinical=text.split(/\r?\n/).filter(line=>!/^\s*(?:DOB|Date of birth)(?:\s+(?:source|reconciliation))?\s*:/i.test(line)).join('\n');
      return {...existing,patient:separated.patient,medicalHistory:historyText(clinical)};
    }
    return {...existing,medicalHistory:historyText(text)};
  }
  if(field==='allergies'){
    const prior=new Map(existing.allergies.entries.map(entry=>[keyOf(entry.text),entry]));
    const entries=text.split(/\r?\n/).map(cleanBullet).filter(Boolean).map(line=>prior.get(keyOf(line))||allergyEntry(line));
    return {...existing,allergies:makeAllergies(entries)};
  }
  if(field==='summaryMarkdown'){
    const fields=profileUpdate(existing,text);
    return {...existing,...fields,summaryMarkdown:splitSummary(text).summaryMarkdown};
  }
  throw new Error('Unknown patient profile section.');
}

export function clinicalLabs(labs=[]) {
  return labs.map(lab=>{
    const results=Array.isArray(lab.results)?[...lab.results]:lab.results!=null?[lab.results]:[];
    if(lab.test!=null) {
      const measurement=String(lab.test)+(lab.value!=null?': '+String(lab.value):'')+(lab.unit?' '+lab.unit:'');
      if(!results.includes(measurement)) results.push(measurement);
    }
    if(lab.note) results.push(String(lab.note));
    if(lab.dateBasis) results.push('Date basis: '+lab.dateBasis);
    if(lab.datePrecision) results.push('Date precision: '+lab.datePrecision);
    return {date:lab.date||null,results};
  });
}


export function validateProfileExtraction(value) {
  if (!Object.hasOwn(value,'dateOfBirth') || !Object.hasOwn(value,'medicalHistory') || !Array.isArray(value.allergies) ||
      (value.medicalHistory!==null && (typeof value.medicalHistory!=='string' || value.medicalHistory.length>80000)) ||
      (value.dateOfBirth!==null && !realDate(value.dateOfBirth))) throw new Error('Incomplete clinical-profile extraction.');
  makeAllergies(value.allergies);
  return value;
}

// Called only for an explicit demographic edit. Normal note or document saves
// cannot replace a recorded birth date with a different one.
export function editProfileBirthDate(context,phn,expected,next) {
  if(!/^\d{10}$/.test(phn)||context?.patient?.key!=='phn:'+phn||context.patient.phn!==phn)throw new Error('Patient DOB identity mismatch.');
  const profile=organizePatient(context),date=agreedDate([next]);
  if(date&&date>new Date().toISOString().slice(0,10))throw new Error('Enter a valid date of birth.');
  if((profile.patient.dateOfBirth||'')===(date||''))return profile;
  if((profile.patient.dateOfBirth||'')!==(expected||''))throw new Error('The patient DOB changed. Reload the patient before editing.');
  profile.patient.dateOfBirth=date;
  if(date)profile.patient.dateOfBirthSource='Physician edit in TRIM';
  else delete profile.patient.dateOfBirthSource;
  return profile;
}
