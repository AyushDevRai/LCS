import { readFileSync } from 'node:fs';
import { z } from 'zod';
const schema = z.array(z.object({target:z.enum(['courts','areaM2']),field:z.string(),label:z.string(),options:z.record(z.string(),z.number().nonnegative().nullable())}));
export const formBands = schema.parse(JSON.parse(readFileSync(new URL('../../config/crm_form_bands.json',import.meta.url),'utf8')));
export function applyFormBands(mapped: Record<string,unknown>, record: Record<string,unknown>) {
  for (const band of formBands) {
    const selected = record[band.field];
    if (selected === undefined || selected === null || selected === '') continue;
    if (typeof selected !== 'string' || !Object.hasOwn(band.options,selected)) throw new Error('Invalid CRM project size band');
    const value = band.options[selected];
    // Explicit form selections override the numeric field; unknown preserves existing evidence.
    if (value !== null && value !== undefined) mapped[band.target] = value;
  }
}
