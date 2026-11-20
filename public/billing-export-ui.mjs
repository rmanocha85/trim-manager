import {freezeExport,putExport,completeExport,matchingEntries,suggestedDates} from './billing-export.mjs?v=20261119-export1';
import {escapeHTML as esc} from './core.mjs?v=20261119-export1';
export function exportUI({state,save,chosen,issues,guard,notice,refresh}){
 const $=id=>document.getElementById(id);let busy=false,datesEdited=false,stage='';
 const pending=()=>state().ledger?.exports?.find(x=>!['sent','cancelled'].includes(x.state));
 async function persist(record){await save(putExport(state().ledger,record));}
 function check(){guard();if(state().dirty)throw Error('Save your current changes to Drive first.');if(state().ledger.settings.parallel)throw Error('End paper comparison in Settings before sending.');}
 const run=fn=>async()=>{if(busy)return;busy=true;refresh();render();try{await fn();}catch(e){notice(e.message);}finally{busy=false;stage='';refresh();render();}};
 function progress(s){stage=s;render();}
 function resetDates(){const range=suggestedDates(state().ledger);$('batch-from').value=range.from;$('batch-to').value=range.to;}
 function render(){
  if(!state().ledger)return;if(!datesEdited&&!busy)resetDates();
  const record=pending(),records=state().ledger.exports||[];
  $('send-batch').disabled=busy||state().locked||(!record&&!chosen().length);$('reset-batch-dates').disabled=busy;
  for(const id of ['batch-from','batch-to','report-layout','generate','finalize'])$(id).disabled=busy||state().locked;
  const label={prepared:'Preparing PDF',verified:'PDF verified',downloaded:'PDF ready · Awaiting your send confirmation',sent:'Sent to Suzy',cancelled:'Export cancelled'};
  $('export-status').innerHTML=(stage?'<p role="status">'+esc(stage)+'</p>':'')+records.slice().reverse().slice(0,10).map(x=>`<article class="export-receipt"><strong>${esc(x.from)} → ${esc(x.to)}</strong><span>${esc(label[x.state]||x.state)} · ${x.snapshots.length} entries${x.verification?.passed?' · '+x.verification.charges+' charges verified':''}</span>${x.changedEntryIds?.length?'<small>'+x.changedEntryIds.length+' changed entries remain outstanding.</small>':''}${x.error?'<small>'+esc(x.error)+'</small>':''}${x.state==='sent'?'<small>'+esc('Delivery confirmed by you')+'</small>':''}</article>`).join('');
  $('confirm-export-sent').hidden=!record||record.state!=='downloaded';$('confirm-export-sent').disabled=busy;
  $('open-billing-email').hidden=!record||record.state!=='downloaded';
  if(record){const subject='TRIM billing '+record.from+' to '+record.to,body='Hi Suzy,\r\n\r\nPlease find attached my TRIM billing for '+record.from+' through '+record.to+'.'+(record.snapshots.some(s=>s.entry.correctionOf)?'\r\nItems labelled CORRECTION amend previously sent billing; please do not enter them as duplicate new claims.':'')+'\r\n\r\nThanks,\r\nRahul';$('open-billing-email').href='mailto:'+encodeURIComponent(record.recipient)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);}
  $('manual-send-help').hidden=!record||record.state!=='downloaded';
  if(record)$('manual-send-help').textContent='Attach '+record.filename+' from your downloads to the email to '+record.recipient+'. After sending, choose Mark sent to Suzy.';
  $('cancel-export').hidden=!record;$('cancel-export').disabled=busy;
  if(!$('billing-recipient').dataset.loaded){$('billing-recipient').value=state().ledger.settings.billingRecipient||'';$('billing-recipient').dataset.loaded='yes';}
 }
 $('reset-batch-dates').onclick=()=>{datesEdited=false;resetDates();$('batch-from').dispatchEvent(new Event('change'));datesEdited=false;};
 for(const id of ['batch-from','batch-to'])$(id).addEventListener('change',()=>{datesEdited=true;});
 $('billing-recipient-save').onclick=run(async()=>{guard();const email=$('billing-recipient').value.trim();if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw Error('Enter Suzy’s verified billing email.');const next=structuredClone(state().ledger);next.settings.billingRecipient=email;await save(next);notice('Billing recipient saved privately.');});
 $('cancel-export').onclick=run(async()=>{check();const record=pending();if(!record)return;await persist({...record,state:'cancelled'});notice('Unsent export cancelled. Billing remains outstanding.');});
 $('confirm-export-sent').onclick=run(async()=>{
  check();const record=pending();if(!record||record.state!=='downloaded'||!record.verification?.passed)throw Error('Download the verified PDF first.');
  if(!confirm('Confirm that you attached '+record.filename+' and sent it to '+record.recipient+'? TRIM cannot check your email. Only the unchanged entries in this saved export will be marked sent.'))return;
  await save(await completeExport(state().ledger,record,{basis:'user-confirmed-email',at:new Date().toISOString(),deliveryTimeKnown:false,note:'Physician confirmed attaching and sending the verified downloaded PDF. Timestamp records confirmation, not an independently verified email send time.'}));notice('Sent to Suzy recorded from your confirmation.');datesEdited=false;
 });
 $('send-batch').onclick=run(async()=>{
  check();let record=pending();if(!record&&!state().ledger.settings.billingRecipient)throw Error('Save Suzy’s verified email in Settings first.');
  if(!record){const entries=chosen();if(issues(entries).length)throw Error('Complete the flagged billing information before sending.');record=await freezeExport(state().ledger,state().roster,entries,{layout:$('report-layout').value,recipient:state().ledger.settings.billingRecipient});await persist(record);}
  const current=await matchingEntries(state().ledger,record);if(current.matches.length!==record.snapshots.length)throw Error('Billing changed after this export was prepared. Cancel this unsent export and create a new one.');
  progress('Generating and verifying every PDF page…');const {generateVerifiedPDF,downloadPDF}=await import('./billing-pdf.mjs?v=20261119-export1');const result=await generateVerifiedPDF(record,state().ledger,state().roster);
  if(record.pdfHash&&record.pdfHash!==result.hash)throw Error('The regenerated PDF differs from the saved export. Cancel this unsent export and prepare a new one.');
  record={...record,state:'verified',pdfHash:result.hash,verification:result.verification};await persist(record);
  downloadPDF(result.bytes,record.filename);record={...record,state:'downloaded',downloadRequestedAt:new Date().toISOString()};await persist(record);
  notice('PDF verified and downloaded. Attach it to your email, send, then mark it sent here.');
 });
 $('existing-delivery-file').onchange=run(async()=>{
  check();const file=$('existing-delivery-file').files[0];if(!file)return;const record=JSON.parse(await file.text());
  if(record.state!=='prepared'||!record.verification?.passed||!record.pdfHash||record.deliveryBasis!=='user-confirmed-existing')throw Error('Choose a verified existing-delivery record.');
  const match=await matchingEntries(state().ledger,record);if(!match.matches.length)throw Error('No unchanged outstanding entries match this delivery record.');
  if(!confirm('Record '+match.matches.length+' matching entries as already sent to Suzy? '+match.changed.length+' changed/missing entries will remain outstanding. No email or PDF will be created.'))return;
  const next=await completeExport(state().ledger,record,{basis:'user-confirmed-existing',at:new Date().toISOString(),deliveryTimeKnown:false,confirmationDate:record.confirmationDate||'',note:'Previously delivered PDF confirmed by physician; exact audited content reconciled. Timestamp is the recording time, not a known email send time.'});if(!next.settings.billingRecipient)next.settings.billingRecipient=record.recipient;await save(next);notice('Existing verified delivery recorded. No email was sent.');datesEdited=false;
 });
 $('finalize').onclick=run(async()=>{
  check();if(pending())throw Error('Finish or cancel the pending export before recording another delivery.');const entries=chosen();if(!entries.length)throw Error('No outstanding billing in this range.');
  if(!confirm(`Record these ${entries.length} selected entries (${entries.map(e=>e.date).sort()[0]} through ${entries.map(e=>e.date).sort().at(-1)}) as already sent to Suzy? Use this only for an existing delivery you have confirmed. No PDF or email will be created.`))return;
  const record=await freezeExport(state().ledger,state().roster,entries,{layout:$('report-layout').value,recipient:state().ledger.settings.billingRecipient});
  await save(await completeExport(state().ledger,record,{basis:'user-confirmed-existing',at:new Date().toISOString()}));notice('Existing delivery recorded. No email was sent.');datesEdited=false;
 });
 return {render,busy:()=>busy};
}
