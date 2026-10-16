import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { formBands } from './services/formBands.js';
const base = process.env.CRM_URL?.replace(/\/$/,'');
if (!base || !process.env.CRM_API_KEY || !process.env.CRM_API_SECRET) throw new Error('Configure CRM credentials first');
const headers = {Authorization:`token ${process.env.CRM_API_KEY}:${process.env.CRM_API_SECRET}`,'Content-Type':'application/json'};
async function request<T>(path:string,method='GET',data?:unknown,resource=false):Promise<T> {
  const response = await fetch(base+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(30000),body:data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(`CRM form setup HTTP ${response.status}`);
  const body = await response.json() as {data:T;message:T};
  return resource ? body.data : body.message;
}
type Field = {fieldname:string;label?:string;fieldtype:string;options?:string;reqd?:number;field_description?:string;[key:string]:unknown};
type Form = {name:string;fields:Field[];[key:string]:unknown};
const name = process.argv[2] ?? 'sales';
const original = await request<Form>('/api/method/crm.api.form.get_form_config?'+new URLSearchParams({name}));
if (original.document_type !== 'CRM Lead') throw new Error('Expected a CRM Lead form');
const existing = await request<{fieldname:string}[]>('/api/resource/Custom%20Field?'+new URLSearchParams({filters:JSON.stringify([['dt','=','CRM Lead']]),fields:JSON.stringify(['fieldname']),limit_page_length:'1000'}),'GET',undefined,true);
const layouts = await request<{name:string;type:string;layout:string}[]>('/api/resource/CRM%20Fields%20Layout?'+new URLSearchParams({filters:JSON.stringify([['dt','=','CRM Lead']]),fields:JSON.stringify(['*']),limit_page_length:'100'}),'GET',undefined,true);
mkdirSync('data',{recursive:true});
writeFileSync(`data/sales-form-backup-${Date.now()}.json`,JSON.stringify({form:original,layouts},null,2),{flag:'wx'});
for (const band of formBands) if (!existing.some(f=>f.fieldname === band.field)) {
  await request('/api/resource/Custom%20Field','POST',{dt:'CRM Lead',fieldname:band.field,label:band.label,fieldtype:'Select',options:'\n'+Object.keys(band.options).join('\n'),insert_after:'custom_contact_role'},true);
  console.log(`Created dropdown ${band.field}`);
}
const select = (fieldname:string,label:string,description=''):Field => ({fieldname,label,fieldtype:'Select',reqd:1,field_description:description});
const contact:Field[] = [
  {fieldname:'lcs_contact_section',label:'Contact Details',fieldtype:'Section Break'},
  {fieldname:'first_name',label:'First Name',fieldtype:'Data',reqd:1},
  {fieldname:'last_name',label:'Last Name',fieldtype:'Data',reqd:0},
  {fieldname:'email',label:'Email',fieldtype:'Data',reqd:1,field_description:'Use the email you want us to contact you on.'},
  {fieldname:'mobile_no',label:'Phone / WhatsApp Number',fieldtype:'Data',reqd:1,field_description:'Include your country code.'},
  {fieldname:'organization',label:'Organization / Company Name',fieldtype:'Data',reqd:0}
];
const project:Field[] = [
  {fieldname:'lcs_fit_section',label:'Project Details',fieldtype:'Section Break'},
  select('custom_organization_type','Organization Type'),
  select('custom_contact_role','Your Role'),
  select('custom_lcs_court_count_band','Number of Courts','For three or more courts, choose the final option. Select Not sure if undecided.'),
  select('custom_lcs_area_band','Approximate Project Area','Square metres. Area of 2000 m² or more qualifies as a large project even with fewer courts.'),
  select('custom_in_service_region','Project Service Region','Select Inside or Outside only if you know our service coverage; otherwise select Unknown.'),
  select('custom_project_type','Project Type'),
  select('custom_setting','Court Setting')
];
const replaced = new Set([...contact,...project].map(f=>f.fieldname).concat(['phone','website','section_break_seed1','column_break_seed2']));
// Retain unrelated custom questions, while removing the original mislabeled mappings.
const extras = original.fields.filter(f=>!replaced.has(f.fieldname) && !['Section Break','Column Break'].includes(f.fieldtype));
const form = {...original,fields:[...contact,...project,...(extras.length?[{fieldname:'lcs_extra_section',label:'Additional Details',fieldtype:'Section Break'},...extras]:[])]};
await request('/api/method/crm.api.form.save_form','POST',{name,form});
for (const layout of layouts.filter(l=>['Data Fields','Side Panel'].includes(l.type))) {
  type Section = {name?:string;sections?:Section[];columns?:{fields:string[]}[]};
  const content = JSON.parse(layout.layout) as Section[];
  const sections = content.some(s=>s.sections) ? content.flatMap(s=>s.sections ?? []) : content;
  const section = sections.find(s=>s.name === 'lcs_project');
  if (!section) continue;
  for (const column of section.columns ?? []) column.fields = column.fields.map(f=>f === 'custom_court_count' ? 'custom_lcs_court_count_band' : f === 'custom_area_m2' ? 'custom_lcs_area_band' : f);
  await request(`/api/resource/CRM%20Fields%20Layout/${encodeURIComponent(layout.name)}`,'PUT',{layout:JSON.stringify(content)},true);
}
const saved = await request<Form>('/api/method/crm.api.form.get_form_config?'+new URLSearchParams({name}));
for (const field of project.filter(f=>f.fieldtype === 'Select')) {
  const actual = saved.fields.find(f=>f.fieldname === field.fieldname);
  if (actual?.fieldtype !== 'Select' || !actual.reqd || !actual.options) throw new Error(`Dropdown verification failed: ${field.fieldname}`);
}
console.log(`Updated ${name}: restored contact mappings and verified all seven required Fit dropdowns. Existing route/publication settings preserved.`);
