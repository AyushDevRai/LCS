import type { Config } from '../config.js';
import type { Classification, Lead, MatrixTier, SessionData, Tier } from '../types.js';
import { calculateFit } from './fitCalculator.js';
import { calculateIntent } from './intentCalculator.js';
export function resolveMatrix(fitScore: number, intentScore: number, config: Config): MatrixTier {
  const b = config.rules.bands;
  return `${fitScore >= b.fitA ? 'A' : fitScore >= b.fitB ? 'B' : 'C'}${intentScore >= b.intent1 ? 1 : intentScore >= b.intent2 ? 2 : 3}`;
}
export function scoreLead(lead: Lead, session: SessionData, config: Config, now = new Date()): Classification {
  const fit = calculateFit(lead,config), intent = calculateIntent(lead,session,config,now);
  const matrixTier = resolveMatrix(fit.score,intent.score,config);
  const fastTrack: string[] = [];
  if (config.rules.fastTracks.siteVisit && intent.siteVisit) fastTrack.push('Site visit request');
  if (config.rules.fastTracks.rfq && intent.rfq) fastTrack.push('RFQ / tender shared');
  if (config.rules.fastTracks.tier1Quote && fit.organizationTier === 'T1' && intent.quote) fastTrack.push('Tier 1 quote request');
  const tier: Tier = fit.organizationTier === 'X' ? 'Disqualified' : fit.organizationTier === 'P' ? 'Partner' : fastTrack.length ? 'A1' : matrixTier;
  const playbook = config.playbooks[tier]!;
  return {tier, matrixTier, fitScore: fit.score, intentScore: intent.score, organizationTier: fit.organizationTier, isMql: playbook.isMql, label: playbook.label, playbook: playbook.action, slaHours: playbook.slaHours,
    fastTrack: tier === 'A1' ? fastTrack : [], reviewRequired: fit.reviewRequired,
    notes: [...fit.notes,...intent.notes, `Matrix: ${matrixTier}`, `Classification: ${tier}`, ...fastTrack.map(v => `${tier === 'Partner' || tier === 'Disqualified' ? 'Suppressed fast-track' : 'Fast-track'}: ${v}`), ...(fit.reviewRequired ? ['Indoor competition court: manual review required'] : [])]};
}
