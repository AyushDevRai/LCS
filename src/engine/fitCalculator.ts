import { clamp, normalize, type Config } from '../config.js';
import type { Lead, OrgTier } from '../types.js';
export function calculateFit(lead: Lead, config: Config) {
  const r = config.rules.fit;
  const organization = normalize(lead.organizationType);
  const organizationTier: OrgTier = (['T1','T2','T3','P','X'] as const).find(t => normalize(t) === organization || config.organizations[t].some(v => normalize(v) === organization)) ?? 'unknown';
  const role = Object.entries(config.organizations.roles).find(([key, aliases]) => normalize(key) === normalize(lead.role) || aliases.some(a => normalize(a) === normalize(lead.role)))?.[0] ?? 'unknown';
  const components: Record<string, number> = {
    organization: r.organization[organizationTier] ?? 0, role: r.roles[role] ?? 0,
    projectSize: (lead.courts ?? 0) >= r.largeProject.minCourts || (lead.areaM2 ?? 0) >= r.largeProject.minAreaM2 ? r.largeProject.points : (lead.courts ?? 0) >= r.smallProject.minCourts ? r.smallProject.points : 0,
    region: lead.inServiceRegion === true ? r.insideRegion : lead.inServiceRegion === false ? r.outsideRegion : 0,
    projectType: r.projectTypes[normalize(lead.projectType).replaceAll(' ', '_')] ?? 0,
    setting: r.settings[normalize(lead.setting).replaceAll(' ', '_')] ?? 0
  };
  return {score: clamp(Object.values(components).reduce((a,b) => a+b, 0), r.cap), organizationTier, reviewRequired: normalize(lead.setting) === 'indoor competition', notes: Object.entries(components).map(([k,v]) => `Fit ${k}: ${v}`)};
}
