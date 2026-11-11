// A typed history is retained as an original source, independently of extraction.
export function typedHistorySource(patient,text){
 const history=String(text||'').trim(),phn=String(patient?.phn||'').replace(/\D/g,'');
 if(!history)return null;
 if(!/^\d{10}$/.test(phn)||!patient.name)throw new Error('Choose a saved patient before adding history.');
 if(history.length>80000)throw new Error('Typed history must be 80,000 characters or fewer.');
 return `Physician-entered patient history\nPatient: ${patient.name}\nPHN: ${phn}\nIdentity selected by the physician in TRIM.\nEntry date: ${new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}\nThe entry date is not the date of the clinical events below.\n\n${history}\n`;
}
export function clipboardImages(data){
 const files=[...(data?.files||[])].filter(f=>f.type.startsWith('image/'));
 return files.length?files:[...(data?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
}
