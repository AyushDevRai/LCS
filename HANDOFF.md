# LCS handoff for the next AI

Updated: **2026-10-16**, Asia/Calcutta. Read this file before continuing, then read `README.md` and the relevant source. This is project context, not permission to disclose secrets or make unrelated changes.

## 1. Objective and current outcome

Built a standalone **Lead Classification System (LCS)** in `C:\PACE\LCS` for the user. It combines explicit project/customer **Fit (0–50)** and website behavioral **Intent (0–50)**, assigns a 3×3 matrix tier, determines MQL status, and writes scores/playbooks to PC CRM's `CRM Lead` records.

Implemented and exercised locally:

- TypeScript deterministic scoring with external JSON configuration.
- Fastify HTTP API, validation, private bearer authentication, origin allowlist and rate limiting.
- SQLite telemetry, email/phone associations and durable CRM retry queue.
- Zero-dependency website tracker, including SPA navigation and iframe submission linkage.
- Frappe/PC CRM REST synchronization through polling and webhook.
- Provisioning scripts for CRM custom fields, CRM layouts and the published Sales web form.
- CRM and tracker fixes described below.

The last user question before this documentation request was why **CRM-LEAD-2026-00006** scored **50 Fit / 50 Intent**. We verified and explained that result; it was correct. No scoring-weight change was requested or made.

## 2. Projects and running environment

| Item | Location / URL |
| --- | --- |
| LCS source and working directory | `C:\PACE\LCS` |
| LCS API | `http://localhost:4000` |
| Website inspected during testing | `http://localhost:3000` |
| Website source containing tracker embed | `C:\PACE\AST2\app\layout.tsx` |
| PC CRM | `http://localhost:8000` |
| Published Sales form | `http://localhost:8000/crm-form/sales` |
| Embedded form URL | `http://localhost:8000/crm-form/sales?embed=1` |
| Windows CRM checkout | `C:\PACE\PC CRM` |
| Actual CRM app used by WSL Bench | `/home/frappe/frappe-bench/apps/crm` |
| Bench directory / site | `/home/frappe/frappe-bench`, `crm.localhost` |
| Reference supplied by user | `C:\Users\AYUSH RAI\Downloads\Court Lead SQL - MQL.html` |

Windows uses PowerShell; Node was v24.21.0 and npm 11.19.0 when built. CRM runs through WSL Ubuntu/Bench on port 8000. Windows `docker` was unavailable; do not assume a Docker deployment.

**Check current process state yourself.** A server started in a previous chat may have stopped. Do not blindly start another process on an occupied port, terminate unrelated Node processes, or overwrite another project's work.

At handoff creation on **2026-10-16**, both `http://127.0.0.1:4000/health` and `/api/status` were **unreachable** (`fetch failed`). No service was restarted because this request was documentation only. Previous successful runtime checks were on 2026-10-15. CRM/website availability was not rechecked on the handoff date.

Credentials and private `API_TOKEN` are in **`C:\PACE\LCS\.env`**. Read them programmatically when needed; do not print, copy into this handoff, place in frontend code, or put into screenshots. `.env`, `data/`, `dist/` and `node_modules/` are ignored by `.gitignore`. LCS was not a Git repository at the last Git check; verify rather than assuming branches/commits exist.

Before editing related projects, read their own `AGENTS.md`. PC CRM has additional `.pi/` context; AST2 requires reading relevant installed Next.js documentation before Next.js code changes.

## 3. Commands and API

Run from `C:\PACE\LCS`:

```powershell
npm install              # only if dependencies need installing
npm run setup            # build, validate config, create .env only if absent
npm run build            # compile src/ into dist/
npm start                # loads .env and runs dist/server.js
npm run dev              # TypeScript development mode
npm run check            # type checking
npm test                 # local automated suite
```

CRM provisioning commands **modify CRM configuration** and require schema/layout permissions:

```powershell
npm run crm:setup
npm run crm:setup-sales-form
```

They already ran successfully on the local CRM. Do not rerun unnecessarily; inspect existing fields/configuration first. They save definition backups under `data/`. The Sales form script rebuilds the contact/project question layout, so review it before using on a separately customized form.

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Public process health and `crmConfigured` flag |
| `GET /api/status` | Private; pending jobs, latest completed pass, latest error |
| `POST /api/track` | Public browser telemetry; exact allowed `Origin` required |
| `POST /api/score` | Private; accepts canonical lead data, joins stored telemetry, returns classification without writing CRM |
| `POST /api/crm-lead-webhook` | Private; body `{ "lead_id": "CRM-LEAD-2026-00006" }`; queues canonical CRM fetch/classification/update |
| `GET /tracker/lcs-tracker.js` | Standalone browser snippet, gzip negotiated, five-minute cache |

Private endpoints use `Authorization: Bearer <API_TOKEN>`. CRM requests use `Authorization: token <CRM_API_KEY>:<CRM_API_SECRET>`. These are different credentials.

The last configured allowed website origin was `http://localhost:3000`. Check `.env` for current values. HTTPS websites and other visitors need a reachable HTTPS LCS address; localhost is only for this computer's local pilot.

## 4. Important implementation files

| File / directory | Purpose |
| --- | --- |
| `src/server.ts` | API startup, auth, CORS, rate limiting, worker lifecycle, tracker serving |
| `src/config.ts` | Loads/validates scoring configuration; normalization helpers |
| `src/types.ts`, `src/validation.ts` | Canonical lead/event/result contracts and request validation |
| `src/engine/fitCalculator.ts` | Fit points, caps and indoor review flag |
| `src/engine/intentCalculator.ts` | Deepest page, distinct behavior bonuses, attribution and decay |
| `src/engine/classifier.ts` | Matrix, MQL, special tracks and fast tracks |
| `src/services/crmClient.ts` | CRM REST, field mapping, retries, write-persistence verification |
| `src/services/formBands.ts` | Maps form court-count/area dropdown selections into numeric scoring evidence |
| `src/services/telemetryStore.ts` | SQLite events, identities and jobs |
| `src/services/syncWorker.ts` | Full paginated CRM sweep; drains due jobs; updates changed values |
| `src/routes/telemetry.ts`, `src/routes/webhook.ts` | Ingestion, scoring and webhook routes |
| `src/crmSetup.ts`, `src/salesFormSetup.ts` | CRM field/layout/form provisioning |
| `tracker/lcs-tracker.js` | Actual browser tracker shipped to the website |
| `config/rules.json` | Weights, caps, behavior thresholds, bands and fast-track switches |
| `config/org_tiers.json`, `config/channels.json`, `config/playbooks.json` | Organization/role aliases, multipliers, tier actions |
| `config/crm_custom_fields.json`, `config/crm_input_fields.json` | CRM field definitions |
| `config/crm_form_bands.json` | Dropdown-to-number mappings |
| `tests/engine.test.ts`, `tests/integration.test.ts`, `tests/tracker.test.ts` | Local scoring, storage/API/CRM and browser simulation regressions |

Source changes require rebuilding before `npm start`. Configuration and tracker files remain outside `dist/`, and are loaded at startup; restart LCS after changes. Deploy the whole project, including `config/` and `tracker/`.

## 5. Scoring rules and decisions to preserve

### Fit

`Fit = clamp(sum of explicit points, 0, 50)`.

| Criterion | Points |
| --- | --- |
| T1 organization | +20 |
| T2 organization | +12 |
| Homeowner / T3 | +5 |
| Partner / P | 0; separate Partner routing |
| Excluded / X | −50; separate Disqualified routing |
| Decision maker | +10 |
| Influencer | +6 |
| 3+ courts **OR** area ≥2,000 m² | +10, once |
| Otherwise 1–2 courts | +5 |
| Inside service region | +5 |
| Outside service region | −15 |
| Unknown service region | 0 |
| New build | +5 |
| Resurfacing / repair | +3 |
| Indoor competition | −5 and manual review flag |
| Outdoor / covered | 0 |

Organization and role labels normalize case, whitespace, hyphens and underscores, then match configured aliases. Company name is not organization type. **Service region means delivery/installation coverage, not indoor versus outdoor.** Do not change weights just because a user expects a higher total.

Court count and area are alternative evidence for one project-size bonus. `2000 m² or more` maps to the threshold representative value 2000; it does not assert the customer's exact area is 2000. Unknown band selections preserve any separately recorded numeric evidence. Known band selections take precedence. If size thresholds change, update the band labels/mappings too.

### Intent

`Intent = clamp(round((deepest page + distinct behavior bonuses) × channel multiplier × decay), 0, 50)`.

- Highest page signal counted once: quote/site/contact/WhatsApp +25; evaluation pages +10; educational pages +3; noise +0.
- Bonuses once per qualifying visitor history: spec download +10; calculator +12; two distinct case studies +8; two distinct sessions within seven days +8; options +5; >50% played video +4; careers −10. RFQ is a fast-track signal with zero numeric points.
- Direct/referral multiplier 1.3; search buying query 1.5, informational query 0.8; other channels configured in JSON.
- Decay: `0.75 ^ floor(days since latest activity / 30)`.
- Explicit lead channel/query takes precedence; otherwise earliest attributed telemetry is used.
- Repeated downloads/clicks do not accumulate unlimited points. A contact submission plus WhatsApp is still one +25 deepest-page signal.
- Sessions rotate after 30 minutes of inactivity. Reloading within that window is not a new session.
- Fit rows: A ≥35, B ≥25, C <25. Intent columns: 1 ≥35, 2 ≥20, 3 <20.
- Normal MQL cells: A1/A2/B1/B2. Fast tracks promote to A1 without inventing numeric points: submitted site visit, shared RFQ, Tier 1 quote request.
- Partner/Disqualified organization tracks take precedence over fast tracks. Fast-track events have no configured expiration currently.

The supplied HTML's **default Fit rules** were compared by executing its actual `score()` function in an isolated VM. They agree with LCS for the user's disputed example. Do not assume the whole HTML application has been ported: it also contains sales pipeline, dealer/monsoon workflow, configurable extra criteria/timeline and nurture-email signals that are outside the implemented original brief. Its fast-track representation retains the numeric matrix cell, whereas LCS exposes original `matrixTier` plus promoted `tier`.

## 6. CRM schema and Sales form work completed

Created six result fields on `CRM Lead`:

`custom_lead_tier`, `custom_fit_score`, `custom_intent_score`, `custom_is_mql`, `custom_playbook`, `custom_classification_notes`.

Created explicit input fields; actual mapping is in `.env`'s `CRM_FIELD_MAP`. Important ones:

`custom_organization_type`, `custom_contact_role`, `custom_court_count`, `custom_area_m2`, `custom_in_service_region`, `custom_project_type`, `custom_setting`, channel/query, request flags and `custom_lcs_visitor_id`.

Added form dropdown fields `custom_lcs_court_count_band` and `custom_lcs_area_band`; adapter handles these through `crm_form_bands.json` without changing the old numeric source mapping.

Added **LCS Classification** and **LCS Project Details** sections to CRM Data Fields and Side Panel layouts, and project inputs to Quick Entry. Side Panel/Data Fields use the new size dropdowns. Results are read-only.

Edited the existing published **Sales** form (name/route `sales`), preserving its route, publication settings, embedding domains, success settings and hidden Status default `New`:

- Restored genuine first name, last name, email, phone and optional company fields.
- Before repair, labels had been changed while still mapping role into email, court count into mobile number, organization type into last name, project type into phone, and setting into website. Do not reintroduce that mistake.
- Added seven required Fit dropdowns: organization, role, court-count band, area band, service region, project type, setting.
- Contact email/phone are required for association. Unknown/Not sure choices are available where appropriate.
- A generic Sales form submission records contact-form intent; it does not automatically assert a quote/site-visit/RFQ request.

## 7. Bugs fixed and why

1. **CRM accepted updates but silently discarded unknown fields.** Initially no LCS custom fields existed. Provisioned them and made `CrmClient.updateLead()` verify that the returned document contains the desired saved values. HTTP 200 alone is insufficient.
2. **Incorrect missing-field guard blocked first scoring.** Frappe omits null fields on new document responses. A guard treating missing object keys as absent schema prevented initial writes. Removed it; verify persistence after PUT instead. Keep the regression test.
3. **New leads looked A1 before scoring.** A Select whose first choice was A1 could default to A1. Added a leading blank option and cleared the live field default. New leads must not appear Hot before classification.
4. **Queue could starve leads after the first 100.** Worker now drains successive due-job batches after paginated enqueueing; regression covers 205 leads.
5. **Intent events arrived but were anonymous forever.** The website tracker cannot observe a cross-origin iframe's form DOM. Added the bridge below.
6. **AST product/project routes classified as noise.** Added evaluation categories for known product routes/project gallery and distinct case-study handling for project detail paths. Added SPA pushState/replaceState navigation tracking.
7. **Empty referrer incorrectly resolved to the current URL.** Fixed tracker URL sanitization so empty remains empty; direct attribution works.

## 8. Embedded form intent bridge: critical cross-project dependency

Changed these CRM files in **both** the Windows checkout and the running WSL copy:

- `C:\PACE\PC CRM\crm\www\crm_form.html`
- `C:\PACE\PC CRM\frontend\tests\unit\webFormSubmissionBridge.test.js`
- Runtime equivalents under `/home/frappe/frappe-bench/apps/crm/`.

The Windows and WSL CRM directories are separate copies. Updating only Windows does not necessarily update the running server. Before the deployment they were compared; the original runtime template was backed up to `C:\PACE\LCS\data\crm-form-before-intent-bridge.html`. Only the changed template and test were copied, not the whole repository.

Bridge behavior:

1. After successful real `CRM Lead` submission, the embedded CRM form calls `notifyEmbeddingPage(values)` before resetting/redirecting.
2. It sends `crm:form-submitted` with document type, form name and only email/phone to the **exact parent origin derived from `document.referrer`**. No `*` target and no credentials. Draft previews, failed submissions, deals and standalone forms do not notify.
3. The parent tracker accepts messages only from an actual iframe's `contentWindow`, the exact origin of its `src`, and a `/crm-form/` path.
4. Tracker emits `identify` and a contact-tier `page_view` under the **parent website visitor ID/session**. LCS then associates earlier history by email/phone and subsequent CRM passes update the score.

Consent and Do Not Track are honored. If the iframe has no normal HTTP(S) referrer, notification is skipped. A restrictive `referrerpolicy` may need review. Never "repair" attribution by assigning anonymous events to a lead based only on timing.

Previously anonymous history links on the next successful submission from the same browser. A script's GET 200 only proves the asset loaded; it does not prove `/api/track` accepted events or identities were linked. Debug tracker HTTP failures with `data-debug="true"`.

Hard-refresh the website after tracker/template changes because the tracker has a five-minute cache. Reload the iframe too if it is already open.

## 9. Verified examples and test history

These are historical observations; CRM records may have changed since. Re-fetch before giving current answers.

| Record | Verified result / explanation |
| --- | --- |
| `CRM-LEAD-2026-00003` | Fit 25, Intent 0, B3: contractor +20, decision maker +10, two courts +5, outside −15, new build +5. No matched telemetry then. |
| `CRM-LEAD-2026-00005` | Clearly named **LCS Intent Pilot** test record created for verification; Fit 45, Intent 33, A2. Contact signal 25 × direct 1.3 = 32.5 →33. |
| `CRM-LEAD-2026-00006` | User's real test: Fit 50, Intent 50, A1; details below. |

Lead 00006 Fit: T1 contractor 20 + decision maker 10 + large area band 10 + inside region 5 + new build 5 + outdoor 0 = **50**. It had two courts but selected area ≥2000 m², so large-size bonus applies.

Lead 00006 Intent: highest contact/WhatsApp signal 25 + spec download 10 + return session within seven days 8 = raw **43**. Direct ×1.3, decay 1: `round(43 ×1.3) =56`, capped to **50**. The matched history included earlier visits/PDF/WhatsApp, then a successful form identification on `/tennis`. A1 came from actual scores, with no fast track.

Last successful test counts:

- **65 LCS tests** after iframe/SPA/page-category work.
- **296 CRM frontend tests** in WSL, including three new submission-bridge tests.
- Build/type check succeeded before the latest tracker-only changes; tracker is standalone JS.
- Tracker gzip payload last measured **2802 bytes**.

CRM suite command:

```powershell
wsl -e sh -lc 'cd /home/frappe/frappe-bench/apps/crm/frontend && yarn test:run'
```

Verification caveat: browser automation could fill the website iframe but could not activate its Submit button (interaction/focus errors). The pilot 00005 was instead verified through live CRM Web Form HTTP submission, the actual bridge/tracker code in a simulated browser message channel, live telemetry ingestion and the real CRM worker. Later the user submitted lead 00006 through their browser, and its matched activity and saved scores confirmed the real flow worked. Do not describe the earlier automated pilot as a fully automated real-browser submission.

## 10. Diagnostics and remaining limits

Suggested diagnosis order:

1. Check `/health`, then authenticated `/api/status`. `lastSync` means a polling pass finished, not that every lead succeeded.
2. Fetch the canonical CRM lead; inspect actual field names/values and saved classification notes, without exposing personal data.
3. Map it using `CrmClient.mapLead()`, look up telemetry using `TelemetryStore.lookup()`, then run `scoreLead()` with current config.
4. Check SQLite counts by event type/page tier and identity count. Zero identities with nonzero events strongly suggests failed form linkage.
5. For browser telemetry, confirm POST `/api/track` returns 202, exact Origin is allowed, consent enabled, and iframe bridge is deployed in the **running** CRM template.
6. If a job failed, inspect its due time/attempts. Durable backoff can reach one hour; enqueueing a duplicate webhook currently does not reset that delay.

SQLite is `data/lcs.sqlite` by default; consult `DATABASE_PATH`. Back up the database including appropriate WAL handling before destructive maintenance. Never clear visitor history just to make a score look different.

Remaining deployment/product limits:

- Local pilot only; no production hosting/HTTPS/service manager was set up in this chat.
- Website embed was observed hardcoded to `http://localhost:4000/tracker/lcs-tracker.js` in AST2's root layout; production needs an environment-appropriate reachable URL.
- Single LCS process per SQLite database; full CRM sweep each pass is intentionally simple and may need incremental sync at scale.
- Queue failures are durable, but a deleted/inaccessible lead can keep retrying; no dead-letter/admin retry endpoint exists.
- No retention/deletion policy is implemented for telemetry.
- Origin checks are for browser ingress, not proof of genuine user behavior; public telemetry is client-supplied.
- First-touch attribution, visitor-wide history and once-per-history bonuses are current policies. Shared-browser identity contamination has not been addressed.
- CTA/calculator/options/video detection still depends on documented HTML annotations where automatic link/page detection is insufficient.
- CRM saved Hot Leads view was documented, not verified as created or pinned. Scores alone do not change the CRM's UI sorting.
- PostHog/Umami were not installed; no separate analytics dashboard was requested/built.

User communication: explain actual point contributions plainly, distinguish a low legitimate score from a sync bug, and favor completing authorized fixes over unnecessary confirmation questions. Do not invent intent events or change weights to force A1. There is no unfinished explicit feature request at this handoff.
