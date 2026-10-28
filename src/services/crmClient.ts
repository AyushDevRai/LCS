import type { Classification, Lead } from '../types.js';
import { leadSchema } from '../validation.js';
import { applyFormBands } from './formBands.js';
export type CrmRecord = Record<string, unknown> & { name: string };
export interface CrmOptions { url: string; key: string; secret: string; attempts: number; fieldMap: Record<string,string>; allowHttp?: boolean }
export function crmFields(result: Classification) {
  return {custom_lead_tier: result.tier, custom_fit_score: result.fitScore, custom_intent_score: result.intentScore, custom_is_mql: result.isMql ? 1 : 0, custom_playbook: result.playbook, custom_sla_hours: result.slaHours ?? 0, custom_classification_notes: result.notes.join('\n')};
}
export class CrmClient {
  constructor(private options: CrmOptions) {
    this.options.url = (options.url ?? '').trim().replace(/^["']|["']$/g, '');
    this.options.key = (options.key ?? '').trim().replace(/^["']|["']$/g, '');
    this.options.secret = (options.secret ?? '').trim().replace(/^["']|["']$/g, '');
    const url = new URL(this.options.url);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('CRM_URL must be an HTTP(S) URL without credentials');
    const allowHttp = options.allowHttp ?? (process.env.CRM_ALLOW_HTTP === 'true' || process.env.ALLOW_INSECURE_HTTP === 'true');
    if (!allowHttp && url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for non-local CRM connections (or set CRM_ALLOW_HTTP=true to allow insecure HTTP)');
  }
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; attempt < this.options.attempts; attempt++) {
      try {
        const response = await fetch(`${this.options.url.replace(/\/$/,'')}${path}`,{...init, redirect:'error', signal:AbortSignal.timeout(15000), headers:{Authorization:`token ${this.options.key}:${this.options.secret}`, 'Content-Type':'application/json'}});
        if (!response.ok) {
          // Do not log response bodies: CRM errors can contain lead details or credentials.
          const error = new Error(`CRM HTTP ${response.status}`);
          if (response.status !== 429 && response.status < 500) throw new PermanentCrmError(error.message);
          throw error;
        }
        return (await response.json() as {data:unknown}).data;
      } catch (error) {
        if (error instanceof PermanentCrmError || attempt+1 >= this.options.attempts) throw error;
        await new Promise(resolve => setTimeout(resolve,Math.min(10000,500*2**attempt)+Math.random()*250));
      }
    }
    throw new Error('CRM attempts exhausted');
  }
  async getLead(id: string): Promise<CrmRecord> { return await this.request(`/api/resource/CRM%20Lead/${encodeURIComponent(id)}`) as CrmRecord; }
  async listLeads(offset: number, limit = 100): Promise<CrmRecord[]> {
    const query = new URLSearchParams({fields:JSON.stringify(['name']),limit_start:String(offset),limit_page_length:String(limit),order_by:'creation asc, name asc'});
    return await this.request(`/api/resource/CRM%20Lead?${query}`) as CrmRecord[];
  }
  mapLead(record: CrmRecord): Lead {
    const mapped: Record<string,unknown> = {id:record.name};
    const email = record.email ?? record.email_id;
    const phone = record.mobile_no ?? record.phone;
    if (email) mapped.email = email;
    if (phone) mapped.phone = String(phone);
    for (const [target,source] of Object.entries(this.options.fieldMap)) {
      const value = record[source];
      if (value === undefined || value === null || value === '') continue;
      if (target === 'inServiceRegion' && typeof value === 'string' && ['unknown','inside','outside'].includes(value.toLowerCase())) {
        if (value.toLowerCase() !== 'unknown') mapped[target] = value.toLowerCase() === 'inside';
        continue;
      }
      if (['inServiceRegion','siteVisitRequested','rfqShared','quoteRequested'].includes(target)) {
        if (![true,false,0,1,'0','1'].includes(value as string)) throw new Error(`Invalid boolean CRM field ${source}`);
        mapped[target] = value === true || value === 1 || value === '1';
      } else if (['courts','areaM2'].includes(target)) mapped[target] = Number(value);
      else mapped[target] = value;
    }
    applyFormBands(mapped,record);
    return leadSchema.parse(mapped);
  }
  async updateLead(id: string, result: Classification): Promise<void> {
    const desired = crmFields(result);
    const saved = await this.request(`/api/resource/CRM%20Lead/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(desired)}) as CrmRecord;
    if (!saved || Object.entries(desired).some(([key,value]) => String(saved[key] ?? '') !== String(value))) throw new Error('CRM did not persist LCS fields; check CRM schema and permissions');
  }
}
class PermanentCrmError extends Error {}
