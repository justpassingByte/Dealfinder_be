---
type: testing
feature: scraper-profile-management
status: draft
---

# Testing Plan: Scraper Profile Dashboard

## 1. Unit Tests
- `scraperProfileService.test.ts`: create, update, archive, risk deltas, threshold transitions, timed decay, cooldown rules, and recovery-state transitions.
- `scraperProfileRepository.test.ts`: lookup, create, update, archive, heartbeat update, offline detection query, and stats aggregation queries.
- `scraperService.test.ts`: outcome classification from Python stderr/stdout, especially CAPTCHA vs generic failure.
- `scraperWorker.test.ts`: assigned-profile claim logic, runnable-state checks, pause/resume behavior, and reporting profile outcomes after jobs.
- `devtoolsTargetService.test.ts`: target filtering, `page` preference, and `localInspectorUrl` rewriting.
- `riskScoring.test.ts`: worked-example cases for clean success, slow success, empty-result penalty, and CAPTCHA-triggered block.

## 2. Integration Tests
- Profile CRUD flow:
  - `POST /api/admin/scraper/profiles` creates a `pending_setup` profile.
  - `PATCH /api/admin/scraper/profiles/:id` updates worker/debug metadata.
  - `POST /api/admin/scraper/profiles/:id/archive` archives the profile when safe.
- Stats flow:
  - `GET /api/admin/scraper/profiles/summary` returns aggregate dashboard stats.
  - `GET /api/admin/scraper/profiles/:id/stats` returns per-profile metrics derived from events.
- Worker claim flow:
  - Start a worker with `SCRAPER_WORKER_ID` and confirm it claims the matching profile record.
- Heartbeat flow:
  - Confirm heartbeat is written every `15 seconds` equivalent in test time and that no-heartbeat beyond `90 seconds` marks the profile `offline`.
- Recovery flow:
  - `POST /api/admin/scraper/profiles/:id/recovery/start` returns tunnel metadata and sets `recovering`.
  - `GET /api/admin/scraper/profiles/:id/devtools/targets` returns filtered page targets and valid local inspector URLs.
  - `POST /api/admin/scraper/profiles/:id/recovery/finish` moves status to `warming`.
- Warmup flow:
  - `POST /api/admin/scraper/profiles/:id/warmup/start` enqueues or triggers warmup.
  - Confirm `2 consecutive successful` warmup runs are required before status becomes `active`.
- Queue behavior:
  - Confirm a worker in `pending_setup`, `blocked`, `recovering`, `warming`, `cooldown`, `offline`, or `archived` does not keep serving normal user jobs.
  - Confirm that when one worker becomes non-runnable, traffic effectively shifts to remaining healthy workers without per-job profile reassignment inside the same worker.

## 3. Dashboard Verification
- List page:
  - Open the admin dashboard and verify summary stats cards render correctly.
  - Verify the profile table shows status, risk, heartbeat, and quick actions.
- Create/edit flow:
  - Create a new profile with display name, worker ID, mount label, and debug ports.
  - Edit the profile and verify the backend reflects the changes.
  - Verify the dashboard shows copyable add-profile commands for the required VPS steps.
- Recovery flow:
  - Start recovery from the dashboard.
  - Verify tunnel instructions are shown.
  - After the tunnel is open, refresh targets and confirm `Inspect` links appear.
- Warmup flow:
  - Trigger warmup or retry warmup from the dashboard and verify status updates.
- Delete flow:
  - Archive a safe profile from the dashboard and confirm it disappears from the default list.
  - Verify the dashboard shows cleanup/archive commands for the profile directory after archive.
- Secret handling:
  - Verify the admin shared secret is not exposed in bundled client code.

## 4. Manual Verification
- **Initial onboarding path**:
  - Create a new profile in the dashboard.
  - Provision the matching worker outside the UI.
  - Confirm the worker claims the profile and begins heartbeat reporting.
- **Recovery path**:
  - Start recovery in the dashboard.
  - Run the SSH tunnel in terminal.
  - Refresh targets in the dashboard.
  - Open the inspect link and solve login/CAPTCHA.
  - Finish recovery and confirm the profile enters `warming`.
- **Warmup path**:
  - Let the worker complete warmup.
  - Confirm the dashboard shows streak progress and final return to `active`.
- **Archive path**:
  - Attempt to delete a runnable claimed profile and confirm the action is blocked.
  - Archive an inactive profile and confirm it is hidden from the default list.
- **Offline path**:
  - Stop a worker container and confirm the profile transitions to `offline`.

## 5. Performance and Operational Checks
- Run concurrent searches with one worker paused and confirm the remaining healthy workers continue serving traffic.
- Verify RAM and CPU usage stays within VPS limits while one worker is in recovery and others remain active.
- Verify debug ports remain loopback-only and are reachable only through SSH tunnel or equivalent private access.
