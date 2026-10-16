import { readFileSync } from 'node:fs';
import { z } from 'zod';
const points = z.record(z.string(), z.number().finite());
const rulesSchema = z.object({
  fit: z.object({ cap: z.literal(50), organization: points, roles: points,
    largeProject: z.object({minCourts: z.number().positive(), minAreaM2: z.number().positive(), points: z.number()}),
    smallProject: z.object({minCourts: z.number().positive(), points: z.number()}),
    insideRegion: z.number(), outsideRegion: z.number(), projectTypes: points, settings: points }),
  intent: z.object({cap: z.literal(50), pages: points, behaviors: points, minCaseStudies: z.number().int().positive(), minSessions: z.number().int().min(2), returnWindowDays: z.number().positive(), decayFactor: z.number().gt(0).lte(1), decayPeriodDays: z.number().positive()}),
  bands: z.object({fitA: z.number().min(0).max(50), fitB: z.number().min(0).max(50), intent1: z.number().min(0).max(50), intent2: z.number().min(0).max(50)}),
  fastTracks: z.object({siteVisit: z.boolean(), rfq: z.boolean(), tier1Quote: z.boolean()})
}).refine(v => v.bands.fitA > v.bands.fitB && v.bands.intent1 > v.bands.intent2, 'Band thresholds must be ordered');
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'));
export function loadConfig() {
  const rules = rulesSchema.parse(read('rules'));
  const organizations = z.object({T1: z.array(z.string()), T2: z.array(z.string()), T3: z.array(z.string()), P: z.array(z.string()), X: z.array(z.string()), roles: z.record(z.string(), z.array(z.string()))}).parse(read('org_tiers'));
  const channels = z.object({multipliers: points, search: z.object({buyingMultiplier: z.number().positive(), informationalMultiplier: z.number().positive(), buyingTerms: z.array(z.string()), informationalTerms: z.array(z.string())})}).parse(read('channels'));
  const playbooks = z.record(z.string(), z.object({label: z.string(), isMql: z.boolean(), action: z.string(), slaHours: z.number().nonnegative().nullable()})).parse(read('playbooks'));
  for (const tier of ['A1','A2','A3','B1','B2','B3','C1','C2','C3','Partner','Disqualified']) if (!playbooks[tier]) throw new Error(`Missing playbook ${tier}`);
  for (const tier of ['T1','T2','T3','P','X','unknown']) if (rules.fit.organization[tier] === undefined) throw new Error(`Missing organization score ${tier}`);
  return {rules, organizations, channels, playbooks};
}
export type Config = ReturnType<typeof loadConfig>;
export const normalize = (value = '') => value.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
export const clamp = (value: number, cap: number) => Math.min(cap, Math.max(0, value));
