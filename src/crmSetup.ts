import 'dotenv/config';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { CrmClient } from './services/crmClient.js';
type Doc = Record<string, unknown> & {name: string};
type Field = {dt:string;fieldname:string;label:string;fieldtype:string;[key:string]:unknown};
type Section = {name?:string; label?:string; sections?:Section[]; columns?:{name:string;fields:string[]}[];[key:string]:unknown};
const url = process.env.CRM_URL?.replace(/\/$/,'');
if (!url || !process.env.CRM_API_KEY || !process.env.CRM_API_SECRET) throw new Error('Configure CRM_URL, CRM_API_KEY and CRM_API_SECRET first');
// Apply the same URL and transport validation as synchronization.
new CrmClient({url,key:process.env.CRM_API_KEY,secret:process.env.CRM_API_SECRET,attempts:1,fieldMap:{}});
const headers = {Authorization:`token ${process.env.CRM_API_KEY}:${process.env.CRM_API_SECRET}`,'Content-Type':'application/json'};
async function request<T>(path: string, method = 'GET', body?:unknown): Promise<T> {
  const response = await fetch(url+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(30000),body:body === undefined ? undefined : JSON.stringify(body)});
  if (!response.ok) throw new Error(`CRM setup HTTP ${response.status}; check API user schema/layout permissions`);
  return (await response.json() as {data:T}).data;
}
const fields = (file:string) => JSON.parse(readFileSync(new URL(`../config/${file}.json`,import.meta.url),'utf8')) as Field[];
const outputs = fields('crm_custom_fields'), inputs = fields('crm_input_fields');
const existing = await request<Doc[]>('/api/resource/Custom%20Field?'+new URLSearchParams({filters:JSON.stringify([['dt','=','CRM Lead']]),fields:JSON.stringify(['*']),limit_page_length:'1000'}));
const native = await request<{fields:{fieldname:string}[]}>('/api/resource/DocType/CRM%20Lead');
const layouts = await request<Doc[]>('/api/resource/CRM%20Fields%20Layout?'+new URLSearchParams({filters:JSON.stringify([['dt','=','CRM Lead']]),fields:JSON.stringify(['*']),limit_page_length:'100'}));
mkdirSync('data',{recursive:true});
const backup = `data/crm-setup-backup-${Date.now()}.json`;
writeFileSync(backup,JSON.stringify({customFields:existing,layouts},null,2),{flag:'wx'});
console.log(`Saved existing CRM field/layout definitions to ${backup}`);
const known = new Set([...existing.map(f=>String(f.fieldname)),...native.fields.map(f=>f.fieldname)]);
let previous = 'lead_owner';
for (const field of [...inputs,...outputs]) {
  if (!known.has(field.fieldname)) {
    await request('/api/resource/Custom%20Field','POST',{...field,insert_after:previous});
    console.log(`Created ${field.fieldname}`);
  } else console.log(`Preserved ${field.fieldname}`);
  previous = field.fieldname;
}
function section(name:string,label:string,fields:Field[]): Section {
  return {name,label,opened:true,columns:[{name:`${name}_column`,fields:fields.map(f=>f.fieldname)}]};
}
for (const layout of layouts) {
  if (!['Data Fields','Side Panel','Quick Entry'].includes(String(layout.type))) continue;
  const content = JSON.parse(String(layout.layout || '[]')) as Section[];
  const sections = content.some(tab => Array.isArray(tab.sections)) ? content.at(-1)!.sections! : content;
  // Add separate sections; leave every existing section/field in place.
  const additions = layout.type === 'Quick Entry' ? [section('lcs_project','LCS Project Details',inputs.filter(f=>!['custom_lcs_visitor_id','custom_search_query','custom_channel'].includes(f.fieldname)))] : [section('lcs_classification','LCS Classification',outputs),section('lcs_project','LCS Project Details',inputs)];
  let changed = false;
  for (const addition of additions) if (!sections.some(s=>s.name === addition.name)) {sections.push(addition);changed = true;}
  if (changed) await request(`/api/resource/CRM%20Fields%20Layout/${encodeURIComponent(layout.name)}`,'PUT',{layout:JSON.stringify(content)});
  console.log(`${changed ? 'Updated' : 'Preserved'} ${layout.name}`);
}
console.log('CRM fields and layouts are ready. Restart LCS and hard-refresh CRM. No lead attributes were fabricated.');
