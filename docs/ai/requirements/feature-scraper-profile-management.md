---
type: requirement
feature: scraper-profile-management
status: draft
---

# Requirement: Scraper Profile Dashboard, Recovery, Warmup, and Stats

## 1. Problem Statement
The scraper already runs as a worker cluster where each worker owns a persistent Chromium profile and a long-lived browser session. What is missing is an operator-facing system to manage those profiles end to end.

The current gaps are:
- no admin dashboard for creating, editing, monitoring, and deleting profiles
- no durable source of truth for profile lifecycle state and recent health
- no structured recovery flow that starts in the dashboard and ends with profile reactivation
- no simple way to inspect useful profile stats from one place
- no safe deletion model for profiles that are no longer needed

Today, when a profile degrades or hits CAPTCHA, the failure is mostly implicit. The scraper may fail or return empty data, the worker may keep taking jobs when it should rest, and operators must manually coordinate recovery steps outside the product.

## 2. Goals
- Provide an admin dashboard UI for the full scraper profile lifecycle:
  - add profile
  - edit profile
  - inspect profile
  - start recovery
  - inspect DevTools targets after SSH tunnel is opened
  - finish recovery
  - start or retry warmup
  - delete profile safely
- Make the dashboard usable by low-technical operators by showing exact step-by-step instructions and copyable commands for required VPS actions.
- Preserve the current v1 runtime model: one worker owns one persistent profile and one browser session.
- Do not hard-code an initial profile count. Profiles must be operator-managed records.
- Add bounded per-profile risk scoring so the system can detect degradation before or when CAPTCHA occurs.
- Prevent workers with unhealthy profiles from serving normal user scrape traffic.
- Surface useful per-profile and aggregate stats in the dashboard.
- Preserve service continuity by allowing healthy workers, cache, and stale fallback paths to keep serving traffic when one profile is unavailable.

## 3. Success Criteria
- Operators can create a new profile entry from the dashboard without changing code or hard-coding pool size.
- The dashboard shows the full current state of each profile, including status, worker assignment, heartbeat, risk, and recent activity.
- Operators can start recovery from the dashboard, open the SSH tunnel manually, fetch inspectable targets, and open the correct DevTools inspector URL.
- Recovered profiles move through `warming` before re-entering the normal traffic pool.
- Operators can manually trigger or retry warmup from the dashboard.
- The dashboard shows useful stats for triage, including at minimum success rate, request count, CAPTCHA count, average latency, and last-seen timings.
- A profile can be deleted safely from the dashboard without corrupting the worker/runtime state.
- A low-technical operator can complete add/recovery/delete flows by following the dashboard instructions and copy-pasting the shown commands.
- The scraper cluster continues serving traffic from healthy workers when one profile is unavailable.

## 4. Scope for V1
### In scope
- Profile registry and lifecycle state in the backend
- Dashboard UI for list, detail, create, edit, recover, warm, stats, and delete flows
- Worker claim/update and heartbeat reporting
- Risk scoring, status transitions, recovery, and warmup lifecycle
- Internal admin endpoints for profile CRUD, stats, recovery, warmup, and delete/archive
- SSH-assisted recovery using the existing loopback-only debug ports
- DevTools target discovery endpoint for the dashboard after the tunnel is opened

### Out of scope for V1
- Dynamic per-job profile assignment across arbitrary workers
- Spawning extra recovery browsers against the same profile
- Full DevTools websocket proxy through the backend
- One-click tunnel startup from the dashboard
- Automatic provisioning of Docker workers from the dashboard
- Fully automated CAPTCHA solving

## 5. User Stories
- **As an admin**, I want to add a new scraper profile from the dashboard, assign worker/debug metadata, and keep it in setup until the worker is ready.
- **As an admin**, I want to see all profiles in one table with status, risk, heartbeat, and key stats so I can triage quickly.
- **As an admin**, I want a detail view for one profile with recent events, inspect links, and warmup controls.
- **As an admin**, I want to start recovery from the dashboard, run the SSH tunnel in my terminal, fetch the available DevTools targets, and open the correct inspector page.
- **As an admin**, I want to finish recovery and then trigger warmup or retry warmup until the profile is safe to return to traffic.
- **As an admin**, I want to delete a profile from the dashboard when it is no longer needed.
- **As a developer**, I want workers with unhealthy profiles to stop taking normal scrape work so one bad profile does not poison live traffic.
- **As a user**, I want search requests to keep working from healthy workers, cache, or stale fallback even when one profile is blocked.

## 6. Functional Requirements
- The backend must persist one profile record per logical scraper profile.
- Profiles must be creatable manually from the dashboard UI; there must be no fixed hard-coded initial profile count.
- Each profile must have a lifecycle that includes at least: `pending_setup`, `active`, `warning`, `blocked`, `recovering`, `warming`, `cooldown`, `offline`, and `archived`.
- Each worker must be associated with at most one active profile at a time.
- The dashboard must support:
  - list profiles
  - create a profile
  - edit profile metadata
  - inspect a profile
  - view profile stats
  - start recovery
  - fetch DevTools targets for recovery
  - finish recovery
  - start or retry warmup
  - delete or archive a profile
- The dashboard must show copyable command instructions for the manual host actions that still exist in v1, including:
  - profile directory creation
  - SSH tunnel startup for recovery
  - optional worker restart or verification commands when applicable
  - archive/cleanup instructions for profile deletion
- Each worker must report enough telemetry after a scrape attempt to classify success, empty or abnormal result, exception, high latency, and CAPTCHA or block evidence.
- The system must update risk and status based on scrape outcomes.
- Workers in non-runnable states must not continue normal user scraping until they are allowed back into service.
- Recovery start must provide the operator with the correct SSH tunnel information for that worker.
- The system must expose a DevTools target discovery endpoint that returns the profile's inspectable page targets and prebuilt local inspector URLs using the configured tunnel port.
- Warmup must execute a low-risk browsing/search sequence before a recovered profile is considered ready for normal traffic.
- The system must surface aggregate and per-profile stats for the dashboard.
- Profile data, state, and recent events must survive process and container restarts.
- In v1, "switching away from a profile" means pausing the worker that owns that profile and allowing remaining healthy workers to continue taking jobs.
- V1 does not require dynamic per-job reassignment from one worker to an arbitrary shared profile pool.

## 7. Stats Requirements
### Dashboard summary stats
- total profiles
- active profiles
- non-runnable profiles
- blocked profiles
- recovering or warming profiles
- average risk score
- CAPTCHA count over last 24 hours

### Per-profile stats
- request count over last 24 hours
- success count over last 24 hours
- success rate over last 24 hours
- CAPTCHA count over last 24 hours
- average scrape latency over last 24 hours
- last success time
- last failure time
- last CAPTCHA time
- current warmup streak

V1 may derive these from profile fields plus `scraper_profile_events`, rather than introducing a separate analytics subsystem.

## 8. Deletion Requirements
- The dashboard must expose a delete action.
- V1 delete should be implemented as archive/soft-delete by default, not physical row removal.
- A profile cannot be archived while it is actively claimed by a running worker unless the operator first unassigns or disables it.
- Archived profiles should be hidden from the default dashboard list but recoverable for audit unless a later maintenance process purges them.

## 9. Non-Functional Requirements
- The feature must work on the existing headless Linux VPS and Docker deployment model.
- The design must avoid extra Chromium processes unless explicitly justified, because memory on the VPS is constrained.
- Recovery and debug access must remain limited to loopback plus SSH tunnel or an equivalent private access mechanism.
- Postgres must be the durable source of truth for profile state; Redis may be used only for ephemeral coordination or liveness hints.
- Admin operations must be protected even though the removed end-user auth stack is not available.
- If the dashboard UI calls protected admin APIs, the shared secret must remain server-side and must not be shipped to the browser.

## 10. Constraints
- Each worker currently owns its own mounted profile directory and live Chromium instance.
- The current queue model distributes jobs across workers without targeting a specific profile per job.
- Existing maintenance logic and scraper maintenance mode should be reused where practical.
- The current application has no active admin authentication subsystem, so the first admin protection layer must be minimal and internal-only.
- Creating a profile in the dashboard does not automatically provision a Docker worker; worker/container setup remains an operator task in v1.
- The dashboard cannot start an SSH tunnel on the operator's machine; the operator must run the tunnel in a terminal.
- The dashboard may guide filesystem and Docker actions with commands, but it does not execute host-level commands itself in v1.

## 11. Resolved Decisions
- **Admin protection v1**: Use a shared secret header first. The dashboard must call the protected backend through a server-side proxy so the secret never reaches browser code.
- **Heartbeat policy**: Workers emit heartbeats every `15 seconds`. A profile is marked `offline` if no heartbeat is seen for `90 seconds`.
- **Warmup exit criteria**: A profile leaves `warming` only after `2 consecutive successful` low-risk warmup runs.
- **Risk decay policy**: Use both success-based and timed decay. Timed decay is conservative and does not run while a profile is `blocked` or `recovering`.
- **Worker behavior when non-runnable**: The worker should pause BullMQ consumption entirely. Keep an in-processor status check as a defensive fallback, not the primary mechanism.
- **Delete behavior v1**: Delete means soft-delete/archive from the dashboard, not immediate hard deletion.
- **Profile switching semantics v1**: traffic shifts at the worker level by pausing unhealthy workers, not by hot-swapping profiles per job.
