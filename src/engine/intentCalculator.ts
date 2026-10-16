import { clamp, normalize, type Config } from '../config.js';
import type { Lead, SessionData, TelemetryEvent } from '../types.js';
const DAY = 86400000;
export function inferChannel(event: Partial<TelemetryEvent>): string {
  if (event.channel) return normalize(event.channel).replaceAll(' ', '_');
  const source = (event.utm?.utm_source ?? '').toLowerCase();
  const medium = (event.utm?.utm_medium ?? '').toLowerCase();
  if (/linkedin/.test(source)) return 'linkedin';
  for (const social of ['instagram','facebook','youtube']) if (source.includes(social)) return social;
  if (/indiamart|tradeindia/.test(source)) return 'marketplace';
  if (/email/.test(medium)) return 'email';
  if (/cpc|ppc|paid_search/.test(medium)) return 'paid_search';
  if (/organic/.test(medium)) return 'organic_search';
  if (event.referrer) {
    try { return /(^|\.)(google\.[a-z.]+|bing.com|duckduckgo.com|yahoo.com)$/.test(new URL(event.referrer).hostname) ? 'organic_search' : 'referral'; } catch { return 'unknown'; }
  }
  return event.landingPage ? 'direct' : 'unknown';
}
export function calculateIntent(lead: Lead, session: SessionData, config: Config, now = new Date()) {
  const r = config.rules.intent;
  const events = [...new Map(session.events.filter(e => Number.isFinite(Date.parse(e.timestamp)) && Date.parse(e.timestamp) <= now.getTime()).map(e => [e.eventId,e])).values()].sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const has = (type: string) => events.some(e => e.type === type);
  const pages = events.filter(e => e.type === 'page_view');
  const deepest = Math.max(0, ...pages.map(e => r.pages[e.pageTier ?? 'noise'] ?? 0), has('whatsapp_click') ? r.pages.whatsapp ?? 0 : 0,
    lead.quoteRequested || has('quote_requested') ? r.pages.quote ?? 0 : 0, lead.siteVisitRequested || has('site_visit_requested') ? r.pages.site_visit ?? 0 : 0);
  const cases = new Set(events.filter(e => e.type === 'case_study_viewed' || (e.type === 'page_view' && e.pageTier === 'case_study')).map(e => e.resourceId ?? e.path).filter(Boolean));
  const sessionStarts = new Map<string,number>();
  for (const event of events) if (!sessionStarts.has(event.sessionId)) sessionStarts.set(event.sessionId,Date.parse(event.timestamp));
  const sessions = [...sessionStarts.values()].sort((a,b) => a-b);
  // A return must be a distinct session and fall inside a rolling seven-day window.
  const returned = sessions.some((time, i) => i >= r.minSessions-1 && time - sessions[i-r.minSessions+1]! <= r.returnWindowDays*DAY);
  const behaviors: Record<string, boolean> = {spec_download: has('spec_download'), calculator_used: has('calculator_used'), case_studies: cases.size >= r.minCaseStudies,
    return_visit: returned, options_viewed: has('options_viewed'), video_watched: has('video_watched'), rfq_shared: has('rfq_shared'), careers_viewed: has('careers_viewed') || pages.some(e => e.pageTier === 'careers')};
  const raw = deepest + Object.entries(behaviors).reduce((total,[key,matched]) => total + (matched ? r.behaviors[key] ?? 0 : 0),0);
  const attribution = events.find(e => e.channel || e.utm || e.landingPage || e.referrer);
  const channel = lead.channel ? normalize(lead.channel).replaceAll(' ', '_') : inferChannel(attribution ?? {});
  const query = normalize(lead.query ?? attribution?.query ?? attribution?.utm?.utm_term);
  let multiplier = config.channels.multipliers[channel] ?? 1;
  if (channel === 'paid_search' || channel === 'organic_search') {
    const matches = (term: string) => (` ${query} `).includes(` ${normalize(term)} `);
    if (config.channels.search.buyingTerms.some(matches)) multiplier = config.channels.search.buyingMultiplier;
    else if (config.channels.search.informationalTerms.some(matches)) multiplier = config.channels.search.informationalMultiplier;
  }
  const last = events.at(-1);
  const days = last ? Math.max(0,(now.getTime()-Date.parse(last.timestamp))/DAY) : 0;
  const decay = r.decayFactor ** Math.floor(days/r.decayPeriodDays);
  return {score: clamp(Math.round(raw*multiplier*decay),r.cap), notes: [`Intent deepest page: ${deepest}`, ...Object.entries(behaviors).filter(([,v]) => v).map(([key]) => `Intent ${key}: ${r.behaviors[key] ?? 0}`), `Channel ${channel}: ×${multiplier}`, `Decay: ${decay}`],
    siteVisit: !!lead.siteVisitRequested || has('site_visit_requested'), rfq: !!lead.rfqShared || has('rfq_shared'), quote: !!lead.quoteRequested || has('quote_requested')};
}
