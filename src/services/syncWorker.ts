import type { Config } from '../config.js';
import { scoreLead } from '../engine/classifier.js';
import { CrmClient, crmFields } from './crmClient.js';
import { TelemetryStore } from './telemetryStore.js';
export class SyncWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopping = false;
  lastSuccess: string | null = null;
  lastError: string | null = null;
  constructor(private crm: CrmClient, private store: TelemetryStore, private config: Config, private interval: number, private log: (message:string) => void) {}
  async tick() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {this.running = undefined;});
    return this.running;
  }
  private async run() {
    // Full paginated sweep also handles late telemetry, changed lead fields and inactivity decay.
    try {
      for (let offset = 0; !this.stopping; offset += 100) {
        const records = await this.crm.listLeads(offset);
        for (const record of records) this.store.enqueue(record.name);
        if (records.length < 100) break;
      }
      while (!this.stopping) {
        const jobs = this.store.dueJobs();
        if (!jobs.length) break;
        for (const job of jobs) {
          if (this.stopping) break;
          try {
            const record = await this.crm.getLead(job.id);
            const lead = this.crm.mapLead(record);
            const result = scoreLead(lead,this.store.lookup(lead),this.config);
            const desired = crmFields(result);
            // Frappe omits null fields on fresh documents. Verify persistence on PUT,
            // rather than treating omitted values as proof that the schema is missing.
            if (Object.entries(desired).some(([key,value]) => String(record[key] ?? '') !== String(value))) await this.crm.updateLead(job.id,result);
            this.store.complete(job.id);
          } catch (error) {
            // Validation errors can contain personal data, so persist only a generic message.
            const message = error instanceof Error && (/^CRM HTTP \d+$/.test(error.message) || error.message === 'CRM Lead is missing LCS fields; run npm run crm:setup' || error.message === 'CRM did not persist LCS fields; check CRM schema and permissions') ? error.message : 'CRM processing failed; check field mapping and connection';
            this.store.fail(job.id,job.attempts+1,message); this.lastError = message; this.log(message);
          }
        }
      }
      this.lastSuccess = new Date().toISOString();
      if (!this.store.pendingJobs()) this.lastError = null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.lastError = `CRM polling failed: ${msg}`;
      this.log(this.lastError);
    }
  }
  start() {
    const loop = async () => { await this.tick(); if (!this.stopping) this.timer = setTimeout(loop,this.interval); };
    void loop();
  }
  async stop() {this.stopping = true; if (this.timer) clearTimeout(this.timer); await this.running;}
}
