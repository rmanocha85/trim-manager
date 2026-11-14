// Coordinates explicit saves without pretending multiple files are one transaction.
export class Session {
  constructor(parts, notify = () => {}) { this.parts = parts; this.notify = notify; this.saving = false; this.message = ''; this.lastError = ''; this.lastSavedAt = null; }
  state() { return this.parts.map(part => ({name: part.name, ...part.state()})); }
  async save() {
    if (this.saving) return;
    const states = this.state();
    if (states.some(s => s.busy)) throw new Error('Wait for the current operation before saving the session.');
    this.saving = true; this.message = ''; this.notify();
    const completed = [];
    try {
      for (const part of this.parts) {
        if (!part.state().dirty) continue;
        await part.save();
        if (part.state().dirty || part.state().error) throw new Error(`${part.name} still needs attention. Your local work is retained.`);
        completed.push(part.name);
      }
      this.lastError = ''; if(completed.length)this.lastSavedAt = new Date().toISOString();
      this.message = completed.length ? `${completed.join(', ')} saved. ${this.parts.some(p=>p.state().mode==='local')?'Saved to the laptop’s Drive folder; cloud sync is unverified.':'Save verified in Drive.'}` : 'No changes to save.';
    } catch (error) {
      this.lastError = error.message;
      this.message = `${completed.length ? completed.join(', ') + ' saved. ' : ''}${error.message} Remaining changes stay on this device.`;
      throw error;
    } finally { this.saving = false; this.notify(); }
  }
}

// Present save state independently of background connection polling.
export function saveIndicator({states,session,unfinished=false,connection={}}){
 const pending=states.filter(s=>s.dirty),errors=states.filter(s=>s.error),local=connection.mode==='local';
 const stamp=session.lastSavedAt||connection.lastChecked;
 const time=stamp?(session.lastSavedAt?'Last saved ':'Last checked ')+new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(stamp)):'No save in this session';
 const result=(label,state,detail)=>({label,state,detail,time});
 if(session.saving)return result('◌ Saving…','busy','Saving pending changes and verifying the saved files.');
 if(session.lastError)return result('⚠ Save failed · Retry','error',session.message||session.lastError);
 if(errors.length)return result('⚠ Needs attention','error',errors.map(s=>s.name).join(', ')+' needs attention. Click to review.');
 if(!connection.ready)return result('Connect to Drive','quiet','Open your workspace to load saved records.');
 if(pending.length)return result('● Changes pending','pending',pending.map(s=>s.name).join(', ')+' changes are on this device and still need Save to Drive.');
 if(unfinished)return result('● Form in progress','pending','Finish the patient form before saving to Drive.');
 if(!connection.connected){if(connection.reason==='expired')return result('Renew Google access','error','Use Refresh from Drive or Save to renew access.');if(connection.reason==='offline'||connection.reason==='network')return result(connection.reason==='offline'?'Offline':'Drive unreachable','error','Your work stays on this device. Retry when the connection returns.');return result('⚠ Connection lost','error','Reconnect to verify the latest saved records.');}
 return result(local?'✓ Saved to folder':'✓ Saved to Drive','ok',local?'Saved in the laptop Drive folder; cloud sync is unverified.':'No local changes. Matches the verified Drive copy. Click for details.');
}
