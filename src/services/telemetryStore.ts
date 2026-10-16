import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Lead, SessionData, TelemetryEvent } from '../types.js';
export const normalizeEmail = (value = '') => value.trim().toLowerCase();
export const normalizePhone = (value = '') => value.replace(/\D/g,'');
export class TelemetryStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, visitor TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_visitor ON events(visitor);
      CREATE TABLE IF NOT EXISTS identities (kind TEXT NOT NULL, value TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY(kind,value,visitor));
      CREATE TABLE IF NOT EXISTS jobs (lead_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0, error TEXT);
    `);
  }
  ingest(event: TelemetryEvent): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = this.db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?)').run(event.eventId,event.visitorId,event.timestamp,JSON.stringify(event)).changes > 0;
      if (inserted) for (const [kind,value] of [['email',normalizeEmail(event.email)],['phone',normalizePhone(event.phone)]]) {
        if (value) this.db.prepare('INSERT OR IGNORE INTO identities VALUES (?, ?, ?)').run(kind!,value,event.visitorId);
      }
      this.db.exec('COMMIT'); return inserted;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  lookup(lead: Lead): SessionData {
    const visitors = new Set<string>();
    if (lead.visitorId) visitors.add(lead.visitorId);
    for (const [kind,value] of [['email',normalizeEmail(lead.email)],['phone',normalizePhone(lead.phone)]]) {
      if (value) for (const row of this.db.prepare('SELECT visitor FROM identities WHERE kind=? AND value=?').all(kind!,value)) visitors.add(String(row.visitor));
    }
    const events: TelemetryEvent[] = [];
    for (const visitor of visitors) for (const row of this.db.prepare('SELECT payload FROM events WHERE visitor=? ORDER BY timestamp').all(visitor)) events.push(JSON.parse(String(row.payload)) as TelemetryEvent);
    return {events};
  }
  enqueue(id: string) { this.db.prepare('INSERT OR IGNORE INTO jobs(lead_id) VALUES (?)').run(id); }
  dueJobs(now = Date.now()): {id:string; attempts:number}[] {
    return this.db.prepare('SELECT lead_id, attempts FROM jobs WHERE due<=? ORDER BY due LIMIT 100').all(now).map(row => ({id:String(row.lead_id), attempts:Number(row.attempts)}));
  }
  complete(id: string) { this.db.prepare('DELETE FROM jobs WHERE lead_id=?').run(id); }
  fail(id: string, attempts: number, message: string) {
    this.db.prepare('UPDATE jobs SET attempts=?,due=?,error=? WHERE lead_id=?').run(attempts,Date.now()+Math.min(3600000,1000*2**Math.min(attempts,12)),message.slice(0,500),id);
  }
  pendingJobs() { return Number(this.db.prepare('SELECT COUNT(*) AS count FROM jobs').get()?.count ?? 0); }
  close() { this.db.close(); }
}
