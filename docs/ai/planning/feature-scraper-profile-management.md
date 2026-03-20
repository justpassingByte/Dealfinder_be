---
type: planning
feature: scraper-profile-management
status: draft
---

# Plan: Scraper Profile Dashboard, Recovery, Warmup, and Stats

## 1. Task Breakdown
### Phase 0: Schema and Security Baseline
- [ ] Add ordered SQL migrations for `scraper_profiles` and `scraper_profile_events`.
- [ ] Add config for the v1 admin shared secret and validate it at startup.
- [ ] Define profile statuses, risk fields, heartbeat config, warmup policy, and archive rules in shared backend types.

### Phase 1: Profile CRUD and Stats Backend
- [ ] Implement repository and service helpers for create, update, lookup, archive, status transition, event logging, and stats aggregation.
- [ ] Add `pending_setup` and `archived` lifecycle support.
- [ ] Add admin API endpoints for create, edit, list, detail, summary stats, per-profile stats, and archive.
- [ ] Ensure no code path assumes a fixed initial profile count.

### Phase 2: Worker Claim, Heartbeat, and Gating
- [ ] Update workers so they claim an assigned profile by `SCRAPER_WORKER_ID`.
- [ ] Emit heartbeats every `15 seconds` and mark profiles `offline` after `90 seconds` without heartbeat.
- [ ] Extend `scraperService.ts` to return scrape telemetry: latency, empty result, CAPTCHA/block, and error reason.
- [ ] Pause BullMQ worker consumption when the assigned profile is non-runnable.
- [ ] Keep a defensive in-processor status check before scraping.
- [ ] Log explicit "traffic switched away" events when a profile becomes non-runnable and its worker is paused.

### Phase 3: Recovery, Targets, and Warmup
- [ ] Implement success-based and timed risk decay.
- [ ] Add recovery start/finish operations using the existing browser debug session.
- [ ] Add DevTools targets discovery endpoint that returns prebuilt local inspector URLs for the operator's tunnel port.
- [ ] Implement warmup flow with `2 consecutive successful` runs required for `warming -> active`.
- [ ] Add manual `start/retry warmup` action from the admin API.
- [ ] Record detailed per-outcome risk deltas so the dashboard can explain why a profile changed status.

### Phase 4: Admin Dashboard UI
- [ ] Build dashboard summary cards for profile stats.
- [ ] Build profile list table with status, risk, heartbeat, and quick actions.
- [ ] Build create/edit form for manual onboarding.
- [ ] Build profile detail page with recent events, stats, recovery controls, inspect links, and warmup controls.
- [ ] Build archive/delete confirmation flow.
- [ ] Build guided command panels for add, recovery, and delete flows with copyable terminal commands.
- [ ] Route admin UI requests through a server-side proxy so the shared secret never reaches browser code.

### Phase 5: Operations and Documentation
- [ ] Add structured logs containing `worker_id`, `profile_id`, `status`, `risk_score`, and scrape outcome.
- [ ] Update `PRODUCTION.md` with manual profile onboarding, recovery, tunnel usage, and archive behavior.
- [ ] Document the exact dashboard recovery flow: start recovery -> run tunnel in terminal -> refresh targets -> inspect -> finish recovery -> warmup.

## 2. Dependencies
- **Database**: Postgres for profile rows, events, and stats derivation.
- **Redis**: Optional for ephemeral liveness and coordination, not the source of truth.
- **Chromium**: Already present in worker containers and remains the single browser process per worker.
- **SSH**: Operators need terminal access to open tunnels during recovery.
- **Frontend**: The admin dashboard must use a server-side path to call the protected backend admin API.

## 3. Risks and Mitigations
- **UI leaks admin secret**:
  - Mitigation: keep the secret in server env only and proxy protected calls server-side.
- **Profiles added in UI but not provisioned operationally**:
  - Mitigation: keep them in `pending_setup` and show onboarding instructions.
- **Delete action removes a profile unsafely**:
  - Mitigation: make delete map to archive in v1 and block archive while actively claimed by a runnable worker.
- **Blocked workers still consuming jobs**:
  - Mitigation: pause BullMQ worker consumption and keep an in-processor guard.
- **Recovery UX stalls after tunnel is open**:
  - Mitigation: provide a DevTools targets endpoint and prebuilt local inspector URLs.
- **Operators are not comfortable with VPS steps**:
  - Mitigation: present the required commands in the dashboard as a guided runbook with copy buttons and simple step descriptions.

## 4. Implementation Order
1. `Schema, statuses, and admin guard`
2. `Profile CRUD, archive, and stats API`
3. `Worker claim, heartbeat, and pause/resume logic`
4. `Recovery, targets discovery, and warmup`
5. `Admin dashboard UI`
6. `Operational docs and runbook`
