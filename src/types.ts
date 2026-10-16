export type OrgTier = 'T1' | 'T2' | 'T3' | 'P' | 'X' | 'unknown';
export type MatrixTier = `${'A' | 'B' | 'C'}${1 | 2 | 3}`;
export type Tier = MatrixTier | 'Partner' | 'Disqualified';
export interface Lead {
  id?: string; email?: string; phone?: string; visitorId?: string;
  organizationType?: string; role?: string; courts?: number; areaM2?: number;
  inServiceRegion?: boolean; projectType?: string; setting?: string;
  channel?: string; query?: string; siteVisitRequested?: boolean; rfqShared?: boolean; quoteRequested?: boolean;
}
export interface TelemetryEvent {
  eventId: string; visitorId: string; sessionId: string; type: string; timestamp: string;
  pageTier?: string; path?: string; resourceId?: string;
  email?: string; phone?: string; channel?: string; query?: string;
  utm?: Record<string, string>; referrer?: string; landingPage?: string;
}
export interface SessionData { events: TelemetryEvent[] }
export interface Classification {
  tier: Tier; matrixTier: MatrixTier; fitScore: number; intentScore: number;
  organizationTier: OrgTier; isMql: boolean; label: string; playbook: string;
  slaHours: number | null; fastTrack: string[]; reviewRequired: boolean; notes: string[];
}
