// Coordinates explicit saves without pretending multiple files are one transaction.
export class Session {
  constructor(parts, notify = () => {}) { this.parts = parts; this.notify = notify; this.saving = false; this.message = ''; }
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
      this.message = completed.length ? `${completed.join(', ')} saved. ${this.parts.some(p=>p.state().mode==='local')?'Saved to the laptop’s Drive folder; cloud sync is unverified.':'Save verified in Drive.'}` : 'No changes to save.';
    } catch (error) {
      this.message = `${completed.length ? completed.join(', ') + ' saved. ' : ''}${error.message} Remaining changes stay on this device.`;
      throw error;
    } finally { this.saving = false; this.notify(); }
  }
}
