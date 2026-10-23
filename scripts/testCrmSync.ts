import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { CrmClient } from '../src/services/crmClient.js';
import { TelemetryStore } from '../src/services/telemetryStore.js';
import { SyncWorker } from '../src/services/syncWorker.js';
import { randomUUID } from 'node:crypto';

const crmUrl = process.env.CRM_URL?.replace(/\/$/, '');
const apiKey = process.env.CRM_API_KEY;
const apiSecret = process.env.CRM_API_SECRET;

if (!crmUrl || !apiKey || !apiSecret) {
  console.error('Missing CRM credentials in .env');
  process.exit(1);
}

const headers = {
  Authorization: `token ${apiKey}:${apiSecret}`,
  'Content-Type': 'application/json'
};

async function crmRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${crmUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CRM API HTTP ${res.status}: ${text}`);
  }
  const json = await res.json() as { data: T };
  return json.data;
}

interface TestLeadDef {
  description: string;
  submitViaWebForm?: boolean;
  payload: Record<string, unknown>;
  telemetryEvents?: Array<{
    type?: string;
    pageTier?: string;
    path?: string;
    channel?: string;
  }>;
  expected: {
    tier: string;
    fitScore: number;
    intentScore: number;
    isMql: number;
    playbook: string;
  };
}

const testCases: TestLeadDef[] = [
  {
    description: 'A1 Hot MQL via RFQ Fast-Track (T1 Contractor + Decision Maker + Large Project + RFQ Shared, Intent 0)',
    payload: {
      first_name: 'Test',
      last_name: 'A1-RFQ-FastTrack',
      email: 'lcs_test_a1@example.com',
      mobile_no: '+919876500001',
      custom_organization_type: 'Sports infra contractor',
      custom_contact_role: 'Decision maker',
      custom_lcs_court_count_band: '3 or more courts',
      custom_in_service_region: 'Inside',
      custom_project_type: 'New build',
      custom_setting: 'Outdoor',
      custom_rfq_shared: 1,
      custom_site_visit_requested: 0
    },
    expected: {
      tier: 'A1',
      fitScore: 50,
      intentScore: 0,
      isMql: 1,
      playbook: 'Hot MQL · call within 4 hrs; 6-touch cadence'
    }
  },
  {
    description: 'A3 High Fit without Fast-Track or Intent (T1 School + Principal + 3 Courts)',
    payload: {
      first_name: 'Test',
      last_name: 'A3-HighFit',
      email: 'lcs_test_a3@example.com',
      mobile_no: '+919876500002',
      custom_organization_type: 'School',
      custom_contact_role: 'Principal',
      custom_court_count: 3,
      custom_in_service_region: 'Inside',
      custom_project_type: 'New build',
      custom_setting: 'Outdoor',
      custom_site_visit_requested: 0,
      custom_rfq_shared: 0,
      custom_quote_requested: 0
    },
    expected: {
      tier: 'A3',
      fitScore: 50,
      intentScore: 0,
      isMql: 0,
      playbook: 'Email/WhatsApp automated nurture'
    }
  },
  {
    description: 'B3 Moderate Fit without Intent (T2 Hotel + Facility Manager + 2 Courts + Resurfacing)',
    payload: {
      first_name: 'Test',
      last_name: 'B3-ModerateFit',
      email: 'lcs_test_b3@example.com',
      mobile_no: '+919876500003',
      custom_organization_type: 'Hotel',
      custom_contact_role: 'Facility manager',
      custom_lcs_court_count_band: '2 courts',
      custom_in_service_region: 'Inside',
      custom_project_type: 'Resurfacing',
      custom_setting: 'Outdoor'
    },
    expected: {
      tier: 'B3',
      fitScore: 31,
      intentScore: 0,
      isMql: 0,
      playbook: 'Marketing nurture'
    }
  },
  {
    description: 'C3 Low Fit (Homeowner + Other + 1 Court + Repair + Indoor Competition)',
    payload: {
      first_name: 'Test',
      last_name: 'C3-LowFit',
      email: 'lcs_test_c3@example.com',
      mobile_no: '+919876500004',
      custom_organization_type: 'Homeowner',
      custom_contact_role: 'Other',
      custom_court_count: 1,
      custom_in_service_region: 'Unknown',
      custom_project_type: 'Repair',
      custom_setting: 'Indoor competition'
    },
    expected: {
      tier: 'C3',
      fitScore: 8,
      intentScore: 0,
      isMql: 0,
      playbook: 'No action'
    }
  },
  {
    description: 'Partner Track (Dealer organization)',
    payload: {
      first_name: 'Test',
      last_name: 'Partner-Track',
      email: 'lcs_test_partner@example.com',
      mobile_no: '+919876500005',
      custom_organization_type: 'Dealer',
      custom_contact_role: 'Decision maker',
      custom_site_visit_requested: 0
    },
    expected: {
      tier: 'Partner',
      fitScore: 10,
      intentScore: 0,
      isMql: 0,
      playbook: 'Route to channel team'
    }
  },
  {
    description: 'Disqualified Track (Student organization)',
    payload: {
      first_name: 'Test',
      last_name: 'Disqualified-Track',
      email: 'lcs_test_disqualified@example.com',
      mobile_no: '+919876500006',
      custom_organization_type: 'Student',
      custom_contact_role: 'Other'
    },
    expected: {
      tier: 'Disqualified',
      fitScore: 0,
      intentScore: 0,
      isMql: 0,
      playbook: 'No action'
    }
  },
  {
    description: 'A2 High Fit + Ingested Intent (T1 University + Contact Page View telemetry)',
    payload: {
      first_name: 'Test',
      last_name: 'A2-Intent',
      email: 'lcs_test_a2@example.com',
      mobile_no: '+919876500007',
      custom_organization_type: 'University',
      custom_contact_role: 'Decision maker',
      custom_lcs_court_count_band: '1 court',
      custom_in_service_region: 'Inside',
      custom_project_type: 'New build',
      custom_setting: 'Outdoor'
    },
    telemetryEvents: [
      { pageTier: 'contact', path: '/contact', channel: 'direct' }
    ],
    expected: {
      tier: 'A2',
      fitScore: 45,
      intentScore: 33,
      isMql: 1,
      playbook: 'Call within 24 hours'
    }
  },
  {
    description: 'Web Form /crm-form/sales Submission (Sports club + Decision maker + Large Project)',
    submitViaWebForm: true,
    payload: {
      first_name: 'FormTest',
      last_name: 'Submitter',
      email: 'formtest.submitter@example.com',
      mobile_no: '+919876543210',
      organization: 'Apex Sports Club',
      custom_organization_type: 'Sports club',
      custom_contact_role: 'Decision maker',
      custom_lcs_court_count_band: '3 or more courts',
      custom_lcs_area_band: '2000 m² or more',
      custom_in_service_region: 'Inside',
      custom_project_type: 'New build',
      custom_setting: 'Outdoor'
    },
    expected: {
      tier: 'A3',
      fitScore: 50,
      intentScore: 0,
      isMql: 0,
      playbook: 'Email/WhatsApp automated nurture'
    }
  }
];

async function main() {
  console.log('--- Initializing LCS and CRM Live Test ---');
  const config = loadConfig();
  const fieldMap: Record<string, string> = JSON.parse(process.env.CRM_FIELD_MAP ?? '{}');
  const store = new TelemetryStore(':memory:');
  const crmClient = new CrmClient({
    url: crmUrl!,
    key: apiKey!,
    secret: apiSecret!,
    attempts: 3,
    fieldMap
  });
  const worker = new SyncWorker(crmClient, store, config, 60000, msg => console.warn('[Worker Warn]', msg));

  console.log(`Checking existing leads in CRM...`);
  const existingLeads = await crmRequest<Array<{ name: string; email?: string }>>(
    '/api/resource/CRM%20Lead?' + new URLSearchParams({ fields: JSON.stringify(['name', 'email']), limit_page_length: '200' })
  );
  const emailToLeadId = new Map(existingLeads.filter(l => l.email).map(l => [l.email!.toLowerCase(), l.name]));

  const createdOrUpdatedIds: string[] = [];

  for (const tc of testCases) {
    const email = String(tc.payload.email).toLowerCase();
    let leadId = emailToLeadId.get(email);

    if (tc.submitViaWebForm) {
      console.log(`Submitting through public Web Form (/crm-form/sales) for: ${tc.description}`);
      const formRes = await fetch(`${crmUrl}/api/method/frappe.website.doctype.web_form.web_form.accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          web_form: 'sales',
          data: JSON.stringify({ ...tc.payload, doctype: 'CRM Lead' })
        })
      });
      const formData = await formRes.json() as { message?: { name?: string } };
      leadId = formData.message?.name ?? emailToLeadId.get(email)!;
    } else if (leadId) {
      console.log(`Updating existing lead ${leadId} for: ${tc.description}`);
      await crmRequest(`/api/resource/CRM%20Lead/${encodeURIComponent(leadId)}`, 'PUT', tc.payload);
    } else {
      console.log(`Creating new lead for: ${tc.description}`);
      const created = await crmRequest<{ name: string }>('/api/resource/CRM%20Lead', 'POST', tc.payload);
      leadId = created.name;
    }
    createdOrUpdatedIds.push(leadId);

    // Ingest telemetry if specified for this test lead
    if (tc.telemetryEvents?.length) {
      const visitorId = randomUUID();
      const sessionId = randomUUID();
      for (const ev of tc.telemetryEvents) {
        store.ingest({
          eventId: randomUUID(),
          visitorId,
          sessionId,
          timestamp: new Date().toISOString(),
          type: ev.type ?? 'page_view',
          pageTier: ev.pageTier,
          path: ev.path,
          channel: ev.channel,
          email,
          phone: String(tc.payload.mobile_no ?? '')
        });
      }
      console.log(`Ingested ${tc.telemetryEvents.length} telemetry event(s) linked to ${email}`);
    }
  }

  console.log('\nRunning SyncWorker tick to classify leads and update CRM...');
  await worker.tick();
  console.log('SyncWorker tick completed!\n');

  console.log('--- Verifying Results in CRM Lead Records ---');
  let allPassed = true;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const leadId = createdOrUpdatedIds[i];
    const record = await crmClient.getLead(leadId);

    const actual = {
      tier: String(record.custom_lead_tier ?? ''),
      fitScore: Number(record.custom_fit_score ?? 0),
      intentScore: Number(record.custom_intent_score ?? 0),
      isMql: Number(record.custom_is_mql ?? 0),
      playbook: String(record.custom_playbook ?? ''),
      notes: String(record.custom_classification_notes ?? '')
    };

    const exp = tc.expected;
    const tierMatch = actual.tier === exp.tier;
    const fitMatch = actual.fitScore === exp.fitScore;
    const intentMatch = actual.intentScore === exp.intentScore;
    const mqlMatch = actual.isMql === exp.isMql;
    const playbookMatch = actual.playbook === exp.playbook;

    const pass = tierMatch && fitMatch && intentMatch && mqlMatch && playbookMatch;

    if (pass) {
      console.log(`✔ PASS: ${leadId} (${tc.description})`);
      console.log(`   Tier: ${actual.tier} | Fit: ${actual.fitScore} | Intent: ${actual.intentScore} | MQL: ${actual.isMql} | Playbook: "${actual.playbook}"`);
      console.log(`   Notes summary: ${actual.notes.split('\n')[0]} ...`);
    } else {
      allPassed = false;
      console.error(`✖ FAIL: ${leadId} (${tc.description})`);
      console.error(`   Expected: Tier=${exp.tier}, Fit=${exp.fitScore}, Intent=${exp.intentScore}, MQL=${exp.isMql}, Playbook="${exp.playbook}"`);
      console.error(`   Actual:   Tier=${actual.tier}, Fit=${actual.fitScore}, Intent=${actual.intentScore}, MQL=${actual.isMql}, Playbook="${actual.playbook}"`);
      console.error(`   Notes: ${actual.notes}`);
    }
  }

  if (allPassed) {
    console.log('\n===========================================');
    console.log('ALL TEST CASES PASSED WITH LIVE CRM INSTANCE!');
    console.log('===========================================\n');
  } else {
    console.error('\nSOME TEST CASES FAILED');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
