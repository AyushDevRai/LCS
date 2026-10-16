# Lead Classification System

For continuation context, previous fixes, verified CRM examples and cross-project deployment details, read [HANDOFF.md](HANDOFF.md).

Standalone TypeScript/Fastify service for deterministic lead scoring, first-party website telemetry and bidirectional PC CRM synchronization. Node.js 24+ and npm are required. SQLite stores events, identity associations and retry jobs on disk. No paid tracking service is required.

## Run locally

```powershell
cd C:\PACE\LCS
npm install
npm run setup
npm test
npm start
```

Setup builds the service, validates all scoring configuration and creates `.env` with a random API token if it does not already exist. Existing `.env` files are preserved. The service listens at `http://127.0.0.1:4000`; `GET /health` confirms availability. CRM is optional; without credentials, telemetry and scoring work locally and CRM webhooks return 503. `npm run dev` starts TypeScript directly; `npm run check` checks types. After editing source, run `npm run build` before `npm start`.

Configuration files in `config/` control organization and role aliases, every scoring weight, page categories, behavior thresholds, caps, decay, channel multipliers, matrix thresholds, fast-track switches and playbooks. Restart the service after configuration changes. Invalid JSON, malformed configuration or missing playbooks stop startup. Organization and role matches are exact after case, whitespace, hyphen and underscore normalization; add your form's labels to `org_tiers.json` as needed.

## HTTP API

| Method and path | Authorization | Input / result |
| --- | --- | --- |
| `POST /api/track` | Allowed website Origin | One telemetry event; 202 after SQLite commit |
| `POST /api/score` | `Authorization: Bearer <API_TOKEN>` | Lead fields; full classification and explanation |
| `POST /api/crm-lead-webhook` | Same bearer token | `{ "lead_id": "CRM-LEAD-0001" }`; durable queue acknowledgement |
| `GET /api/status` | Same bearer token | Pending jobs, latest completed polling pass, latest error |
| `GET /health` | Public | Process health and whether CRM is configured |
| `GET /tracker/lcs-tracker.js` | Public | Browser snippet |

Requests use JSON, with a 16 KB body limit and a default rate limit of 120 requests per IP per minute. Authentication endpoints accept only the private bearer token. The public tracker endpoint checks an exact Origin allowlist; it is intended for browser telemetry, not authenticated proof of intent. Do not place the private token or CRM credentials in a website. No endpoint exposes stored visitor events.

Score a lead from PowerShell, using your `.env` token:

```powershell
$lcsToken = 'YOUR_API_TOKEN'
$leadBody = @{
  organizationType = 'school'
  role = 'principal'
  courts = 3
  inServiceRegion = $true
  projectType = 'new_build'
  email = 'lead@example.com'
  quoteRequested = $true
} | ConvertTo-Json
Invoke-RestMethod http://localhost:4000/api/score -Method Post `
  -Headers @{Authorization = "Bearer $lcsToken"} `
  -ContentType application/json -Body $leadBody
```

Supported lead fields are defined in `src/types.ts`. Region membership is an explicit boolean; missing membership contributes zero. LCS does not guess geographical service coverage. Courts must be nonnegative integers and area uses square metres. Project types are `new_build`, `resurfacing`, `repair`; settings are `indoor_competition`, `outdoor`, `covered`. Channel identifiers are the keys in `channels.json`. The optional `query` field is a search term. `visitorId` can link anonymous telemetry directly, or LCS can match by normalized email/phone.

Example telemetry payload (all IDs are UUIDs):

```json
{
  "eventId": "600fab74-aa9b-4ea4-8ef9-19a72573cab2",
  "visitorId": "738d943e-c08c-478b-83f9-e97a5cbf1472",
  "sessionId": "b278fb7d-b3ce-4905-96bd-8a5b49950236",
  "type": "page_view",
  "timestamp": "2026-10-15T09:00:00.000Z",
  "pageTier": "pricing",
  "path": "/pricing"
}
```

Optional event fields include `email`, `phone`, `resourceId`, `channel`, `query`, `referrer`, `landingPage` and the four supported UTM tags. Supported event names and page tiers are enumerated in `src/validation.ts`. Duplicate event IDs are ignored. Future timestamps beyond one minute are rejected at ingestion; the engine ignores future activity until its timestamp is reached. Timestamps must include a timezone. Events remain stored until the database is removed or an operator implements a retention policy appropriate to the deployment.

## Embed the browser tracker

Set `ALLOWED_ORIGINS` in `.env` to your website's exact origins, separated by commas. Use an HTTPS LCS hostname for an HTTPS website. The browser must reach that hostname; localhost is only suitable for local development. The zero-dependency snippet is under 3 KB over gzip. The service automatically serves gzip to clients that accept it.

```html
<script defer src="https://lcs.example.com/tracker/lcs-tracker.js"
        data-endpoint="https://lcs.example.com/api/track"
        data-consent="required"></script>
```

With `data-consent="required"`, the script creates no LCS identifier and sends no telemetry until your consent handler calls `LCS.consent(true)`. `LCS.consent(false)` stops further events. Omitting that attribute starts tracking immediately. Browser Do Not Track disables initialization. The snippet uses the `lcs_vid` first-party cookie, localStorage for sessions, a 30-minute inactivity timeout, and a memory fallback when storage is unavailable. Use secure contexts (HTTPS or localhost) for `crypto.randomUUID()`.

Annotate relevant elements to avoid relying solely on URL heuristics:

```html
<body data-lcs-page-tier="pricing">
  <a href="/specifications.pdf" data-lcs-event="spec_download">Specifications</a>
  <div data-lcs-calculator><input name="court_count" type="number"></div>
  <select data-lcs-options><option>Blue system</option></select>
  <video data-lcs-video src="/project.mp4" controls></video>
  <form data-lcs-form="quote">
    <input type="email" name="email">
    <input type="tel" name="phone">
    <input type="file" data-lcs-rfq>
    <button>Request quote</button>
  </form>
</body>
```

Use `data-lcs-form="site_visit"` for site-visit requests. Forms associate email/phone with the visitor; form fields outside those identity fields are not transmitted. RFQ attachments produce only an event, never file contents. PDF links default to spec downloads; set `data-lcs-event` explicitly for other link purposes. Case-study pages count by distinct path; repeated views of one study do not meet the two-study threshold. Videos count when played ranges exceed 50% of duration.

Native form submission indicates a submission attempt. For AJAX applications that require confirmation of a successful backend submission, use the explicit API in your success handler instead of form auto-detection:

```javascript
LCS.identify({ email: 'lead@example.com', phone: '+919876543210' });
LCS.track('quote_requested');
LCS.track('rfq_shared');
LCS.track('case_study_viewed', { resourceId: '/cases/academy' });
LCS.page(); // call after SPA router navigation, including pushState routes
const visitorId = LCS.visitorId(); // optionally include in your server-side lead form
```

SPA pushState, replaceState and popstate navigations are tracked automatically; `LCS.page()` is also available for custom routing. Tracking never blocks form submission; delivery is best effort using fetch keepalive. UTM tags and sanitized referrer/landing URLs are captured; URL query strings are not sent as part of page paths. Add `data-debug="true"` to the tracker script for rejected/unreachable request warnings. PostHog/Umami are optional separate analytics tools and are not required or bundled.

### Embedded PC CRM forms

A tracker on the website cannot read the DOM inside a cross-origin iframe. The CRM public form template (`crm/www/crm_form.html`) therefore notifies its exact embedding origin with a `crm:form-submitted` message only after a successful CRM Lead insertion. The tracker accepts it only from the matching iframe window and the origin of its `/crm-form/` URL, links email/phone to the parent visitor, and records contact-form intent (+25 before multiplier/decay). Draft previews and failed submissions do not qualify. Keep the CRM template bridge deployed together with the updated tracker. The iframe must provide a normal HTTP(S) document referrer for the exact target origin to be determined. No API tokens or CRM secrets are sent through the bridge. Normal tracker consent and Do Not Track behavior still apply.

AST product routes and `/our-projects` receive evaluation-page intent (+10); individual `/our-projects/<slug>` pages count as distinct case studies. Visiting an iframe form directly does not link website history; submit it from the website embed. Historical anonymous events become linked when the same browser visitor next submits the form. Existing leads cannot safely be associated with anonymous visits from timing alone.

## Scoring decisions

The embedded Sales form can be configured with `npm run crm:setup-sales-form` (optional form name argument after `--`). It backs up its existing configuration, restores actual contact field mappings, and adds seven required Fit dropdowns. Court count and area use dedicated Select fields so users choose clear bands rather than typing numbers. Their exact mappings are in `config/crm_form_bands.json`; the adapter converts these into numeric scoring evidence while retaining support for existing numeric fields. A known selected band takes precedence; a Not sure selection preserves any separately recorded numeric evidence. If you change scoring size thresholds, update the band labels/mappings to match. Form updates preserve the existing URL, publication state, embedding domains, success settings and hidden defaults.

- Fit sums explicit rules then clamps to 0–50. Unknown data adds zero. Indoor competition courts receive the penalty and a manual-review flag in the response and CRM notes.
- Intent uses the highest page weight, plus each qualifying behavioral bonus once across matched history, then applies channel and inactivity decay, rounds, and clamps to 0–50. Repeated clicks/downloads cannot accumulate unlimited points. Two distinct case studies and distinct sessions within a rolling seven-day window are required for their respective bonuses.
- Attribution uses explicit CRM channel/query first, otherwise the earliest attributed telemetry event. Search buying terms take precedence over informational terms when both occur. Searches without a known term use ×1.0; hidden search queries are not inferred. Direct traffic requires a landing-page event without a referrer; leads without telemetry use the unknown channel.
- Decay applies once per complete 30-day interval since the latest recorded activity. There is no telemetry age to decay when only explicit CRM intent flags exist.
- Thresholds are inclusive: Fit 35→A, 25→B; Intent 35→1, 20→2. A1/A2/B1/B2 are MQLs.
- A submitted site-visit request, shared RFQ, or Tier 1 quote request promotes the classification to A1 without inventing numeric points. Visiting a site-visit page alone is not a submitted request. The original cell remains in `matrixTier` and notes.
- Partner and disqualified organization tracks take precedence over fast tracks. This resolves the brief's unspecified override ordering. Fast-track flags persist while the matching event or CRM flag remains; the brief specifies no expiration. If that policy changes, update the engine and tests.
- Email matching trims and lowercases. Phone matching removes punctuation; it does not guess country codes. Include country codes consistently in website and CRM records.

## Connect PC CRM

With CRM credentials configured, run `npm run crm:setup` to create missing LCS input/output custom fields and add LCS sections to the CRM lead detail view, side panel and quick-entry form. Existing fields and layout sections are preserved; a snapshot of existing definitions is saved under `data/crm-setup-backup-*.json`. This command requires CRM schema/layout administration permissions. Hard-refresh CRM afterwards. It provisions the default source field names; if you use a different `CRM_FIELD_MAP`, configure your own source fields instead. Service Region uses Unknown/Inside/Outside so missing region information does not count as outside. Existing boolean/0/1 region fields are also supported.

1. Create the six output Custom Fields on the `CRM Lead` DocType using `npm run crm:setup` or manually. Exact field definitions are in `config/crm_custom_fields.json`; use Desk Customize Form or create each `Custom Field` resource through your authorized Frappe administrator. Normal service startup does not modify the CRM schema automatically.
2. Ensure the source attributes exist in CRM. Set `CRM_FIELD_MAP` in `.env` to map LCS field names to your actual CRM field names. The example maps `organizationType`, `role`, `courts`, `areaM2`, `inServiceRegion`, `projectType`, `setting`, `channel`, `query`, the three request flags and `visitorId`. Missing fields contribute no evidence. Native email/email_id and mobile_no/phone are supported automatically. Checkbox values must be booleans or 0/1; numeric fields are validated before scoring.
3. Set `CRM_URL`, `CRM_API_KEY`, and `CRM_API_SECRET`. Use a CRM API user allowed to read/write `CRM Lead`. Remote CRM URLs must use HTTPS. Keep credentials only in `.env` or your secret manager.
4. Restart LCS. It polls immediately and then every `CRM_POLL_INTERVAL_MS` (default 60000) after a pass finishes. All leads are paginated in stable creation/name order; only changed classification fields are updated. Full passes include old leads, allowing late identity matches and inactivity decay to change classification. LCS fetches source fields from CRM and writes the six result fields back via token-authenticated REST PUT.
5. Optionally configure a CRM lead-creation webhook to POST `{ "lead_id": "{{ doc.name }}" }` to `/api/crm-lead-webhook` with `Authorization: Bearer <API_TOKEN>` and JSON content type. Verify the webhook payload rendering in your CRM. LCS fetches canonical lead data itself. Use this endpoint from trusted form backends only after creating the corresponding CRM lead; otherwise call `/api/score` for a local classification.
6. Create the CRM saved view **🔥 Hot Leads (A1)** filtered by `custom_lead_tier = A1`, sorted by `custom_fit_score DESC` and `custom_intent_score DESC`. Pin that view in your CRM. The API writes ranking fields; it does not alter CRM UI sorting automatically.

Transient CRM network errors, HTTP 429 and 5xx responses retry with exponential backoff and jitter; other HTTP errors end that immediate request. Failed durable jobs retain an error and exponential retry delay up to one hour. Other leads continue processing. Queue state survives restart. `/api/status` reports pending work; `lastSync` means the latest polling pass finished, and `lastError` remains set while jobs are failing. Worker concurrency is one per process; deploy a single LCS process for each SQLite database. Large CRM datasets may need a scheduled incremental-sync design instead of the simple full sweep.

The worker checks that the CRM update response contains the saved values. Empty fields may be omitted from a new lead response; this does not block its first score update. A successful HTTP response alone does not mark a job complete if CRM silently ignores unknown fields. Lead Tier includes a blank initial option so new leads are not labeled A1 before classification.

For production, place LCS behind an HTTPS reverse proxy, retain the SQLite file on persistent storage, back it up and restrict its filesystem access. The default bind address is loopback; set `HOST=0.0.0.0` only when your deployment requires it. Configure proxy-aware rate limiting for your own topology before enabling forwarded-IP trust. Neither a live CRM connection nor deployment is performed by setup.

## Verification

`npm test` covers every matrix band boundary, fit caps and penalties, channel/query weighting, distinct behavior thresholds, decay boundaries, fast-track precedence, configurable rules, SQLite persistence and identity matching, HTTP authorization/origin checks, CRM REST retries, idempotent writes and durable job backoff. CRM integration tests run against a local mock Frappe API, requiring no real credentials.

Source layout follows the brief, using `.ts` source files and `.js` build artifacts in `dist/`. The browser tracker is standalone JavaScript. `npm run build` emits source maps; rules and tracker remain external to `dist/` so deploy the whole project, including `config/` and `tracker/`.
