---
type: implementation
feature: scraper-profile-management
status: draft
---

# Implementation: Scraper Profile Dashboard

## 1. Backend Structure
- `src/services/scraperProfileService.ts`: core profile CRUD, onboarding, archive, stats, recovery, and warmup logic.
- `src/services/scraperProfileRepository.ts`: Postgres persistence helpers for profiles and events.
- `src/services/devtoolsTargetService.ts`: fetches worker debug targets and rewrites local inspector URLs.
- `src/routes/scraperProfiles.ts`: protected admin endpoints for list, create, edit, detail, stats, archive, recovery, warmup, and inspect targets.
- `src/middleware/adminSecret.ts`: shared-secret guard for admin-only backend routes.
- `src/workers/scraperWorker.ts`: profile claim logic, heartbeat, runnable-state checks, pause/resume, and outcome reporting.
- `src/services/scraperService.ts`: scrape telemetry and profile-aware error classification.
- `scripts/shopee_scraper.py`: existing scraper, extended only where needed for better outcome signals.

## 2. Frontend Structure
- `frontend/src/app/admin/scraper-profiles/page.tsx`: dashboard list page and summary stats.
- `frontend/src/app/admin/scraper-profiles/[id]/page.tsx`: profile detail page.
- `frontend/src/components/admin/ScraperProfileTable.tsx`: profile status table and quick actions.
- `frontend/src/components/admin/ScraperProfileSummaryCards.tsx`: aggregate stats cards.
- `frontend/src/components/admin/ScraperProfileForm.tsx`: create and edit form.
- `frontend/src/components/admin/ScraperRecoveryPanel.tsx`: recovery state, tunnel instructions, target refresh, and inspect links.
- `frontend/src/components/admin/ScraperWarmupPanel.tsx`: warmup trigger, streak display, and recent warmup results.
- `frontend/src/components/admin/ScraperProfileStats.tsx`: per-profile stats view.
- `frontend/src/components/admin/ScraperArchiveDialog.tsx`: delete/archive confirmation dialog.
- `frontend/src/components/admin/ScraperCommandGuide.tsx`: copyable command blocks and step-by-step operator instructions.
- `frontend/src/app/api/admin/scraper-profiles/...`: server-side proxy handlers that attach the admin secret when calling the backend API.

## 3. Key Decisions
- Profiles are created manually through the admin dashboard. There is no fixed seeded profile count.
- A newly created profile starts as `pending_setup`.
- Delete in the dashboard maps to archive/soft-delete in v1.
- Workers claim their assigned profile by `SCRAPER_WORKER_ID`.
- Heartbeats are emitted every `15 seconds`; missing heartbeat for `90 seconds` marks the profile `offline`.
- Non-runnable workers pause BullMQ consumption instead of repeatedly failing jobs.
- Warmup requires `2 consecutive successful` runs before a profile returns to `active`.
- Risk decays both on successful traffic and on a conservative timer.
- Recovery remains SSH-assisted; the dashboard helps by surfacing tunnel instructions and inspectable targets.
- The dashboard should present host-side actions as guided copyable commands rather than expecting the operator to know the VPS workflow.

## 4. Key API Contracts
- `GET /api/admin/scraper/profiles`
- `GET /api/admin/scraper/profiles/summary`
- `POST /api/admin/scraper/profiles`
- `PATCH /api/admin/scraper/profiles/:id`
- `GET /api/admin/scraper/profiles/:id`
- `GET /api/admin/scraper/profiles/:id/stats`
- `POST /api/admin/scraper/profiles/:id/archive`
- `POST /api/admin/scraper/profiles/:id/recovery/start`
- `GET /api/admin/scraper/profiles/:id/devtools/targets`
- `POST /api/admin/scraper/profiles/:id/recovery/finish`
- `POST /api/admin/scraper/profiles/:id/warmup/start`
- `POST /api/admin/scraper/profiles/:id/reset-risk`
- `POST /api/admin/scraper/profiles/:id/status`

## 5. Execution Steps
1. Add schema migrations for `scraper_profiles` and `scraper_profile_events`.
2. Implement the admin guard plus CRUD/stats/archive backend API.
3. Implement worker claim, heartbeat, pause/resume, and outcome reporting.
4. Implement recovery start/finish, target discovery, and warmup logic.
5. Build the dashboard list/detail flows, stats cards, recovery panel, warmup panel, guided command panels, and archive dialog.
6. Update the production runbook for manual profile onboarding, SSH recovery, inspect flow, and archive behavior.
