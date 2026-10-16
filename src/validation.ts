import { z } from 'zod';
const text = z.string().trim().max(300);
export const leadSchema = z.object({
  id: text.optional(), email: z.email().max(254).optional(), phone: text.optional(), visitorId: z.string().uuid().optional(),
  organizationType: text.optional(), role: text.optional(), courts: z.number().int().nonnegative().max(100000).optional(), areaM2: z.number().nonnegative().max(1e10).optional(),
  inServiceRegion: z.boolean().optional(), projectType: text.optional(), setting: text.optional(), channel: text.optional(), query: text.optional(),
  siteVisitRequested: z.boolean().optional(), rfqShared: z.boolean().optional(), quoteRequested: z.boolean().optional()
}).strict();
export const eventSchema = z.object({
  eventId: z.string().uuid(), visitorId: z.string().uuid(), sessionId: z.string().uuid(),
  type: z.enum(['page_view','spec_download','calculator_used','case_study_viewed','rfq_shared','whatsapp_click','options_viewed','video_watched','careers_viewed','site_visit_requested','quote_requested','identify']),
  timestamp: z.iso.datetime({offset: true}).refine(v => Date.parse(v) <= Date.now()+60000, 'Timestamp is in the future'),
  pageTier: z.enum(['quote','site_visit','contact','whatsapp','specs','systems','case_study','pricing','blog','dimensions','about','investor','noise','careers']).optional(),
  path: z.string().max(2000).optional(), resourceId: z.string().max(2000).optional(),
  email: z.email().max(254).optional(), phone: text.optional(), channel: text.optional(), query: text.optional(),
  utm: z.record(z.enum(['utm_source','utm_medium','utm_campaign','utm_term']), z.string().max(300)).optional(),
  referrer: z.string().max(2000).optional(), landingPage: z.string().max(2000).optional()
}).strict();
