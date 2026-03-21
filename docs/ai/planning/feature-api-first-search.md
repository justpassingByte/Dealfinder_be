---
type: planning
feature: api-first-search
status: in_progress
date: 2026-03-21
---

# Plan: API-First Search Layer with Browser Fallback

## 1. Current Status
The worker-owned API-first path is now implemented at the code level:
- `scripts/shopee_scraper.py` attempts Shopee API first from the live DrissionPage browser session
- the same worker runtime falls back to DOM extraction when API fails
- `scraperService.ts` parses the richer Python result contract
- `scraperWorker.ts` propagates worker channel metadata
- `catalogSearchService.ts` maps worker channel `api` to public source `api`
- profile event details now include channel and API-attempt metadata

What remains is mainly verification hardening, telemetry polish, and rollout follow-up.

## 2. Task Breakdown
### Phase 0: Confirm Worker-Side API Contract
- [ ] Preserve one or two captured API payload fixtures from the existing DevTools/probe work for repeatable tests.
- [x] Confirm the minimum response fields required to normalize into the current `Listing` contract.
- [x] Confirm how the Python runtime should return execution channel metadata back to Node.

### Phase 1: Python/DrissionPage API-First Runtime
- [x] Update `scripts/shopee_scraper.py` so it attempts Shopee API first from the live browser session.
- [x] Keep the request in the worker/browser context instead of exporting session state to Node.
- [x] Normalize successful API results into the same JSON listing format already used by Node.
- [x] Keep the existing DOM scraping path as the fallback inside the same runtime.

### Phase 2: Node/Worker Boundary Update
- [x] Update `scraperService.ts` to parse richer worker output and telemetry.
- [x] Update `scraperWorker.ts` so job results or telemetry include execution channel: `api` or `dom`.
- [x] Ensure full-failure behavior still clears in-flight job state correctly.

### Phase 3: Catalog Pipeline Integration
- [x] Keep `catalogSearchService` top-level order as `cache -> DB -> worker -> stale fallback`.
- [x] Map worker channel `api` to public source `api`.
- [x] Map worker channel `dom` to public source `scraper`.
- [x] Reuse the existing catalog persistence flow for both worker output channels.

### Phase 4: Profile Health and Observability
- [x] Extend profile telemetry so API vs DOM outcomes are visible.
- [ ] Record at least API success, API empty, API blocked, DOM fallback success, and full failure cases as distinct first-class metrics or event groupings.
- [ ] Add counters/log fields that show API success rate vs DOM fallback rate inside the worker path.

### Phase 5: Validation and Rollout
- [x] Add parser coverage for the richer Python runtime output.
- [x] Confirm TypeScript build passes with the new worker/runtime contract.
- [ ] Run a real end-to-end worker search and verify `source: "api"` on a successful keyword refresh.
- [ ] Run a forced API failure and verify the same worker falls back to DOM before stale fallback.
- [ ] Capture one or two production-like API fixtures for regression coverage.

### Phase 6: Optional Follow-up Work
- [ ] Decide whether page-2/page-3 expansion should stay in the worker or remain deferred.
- [ ] Decide whether seller enrichment is worth a second API hop after the main path is stable.

## 3. Dependencies
- **Node**: existing cache, catalog persistence, queue orchestration
- **BullMQ**: existing worker dispatch path
- **Python/DrissionPage**: existing browser-owning runtime
- **Postgres**: existing catalog schema
- **Redis**: existing cache, locks, and queue coordination

## 4. Risks and Mitigations
- **Worker API execution still depends on browser health**:
  - Mitigation: keep DOM fallback in the same worker/runtime.
- **Python output contract changes break Node parsing**:
  - Mitigation: keep the structured JSON contract stable and cover it with fixture-based tests.
- **API payload drift breaks normalization**:
  - Mitigation: tolerant parsing plus DOM fallback.
- **Telemetry still looks too DOM-centric in dashboard summaries**:
  - Mitigation: add first-class counters or grouped event reporting for API vs DOM outcomes.
- **Scope drifts back into Node-side CDP/session extraction**:
  - Mitigation: keep v1 boundary fixed at `Node -> worker`.

## 5. Deployment Notes
- No Dockerfile changes are required for this implementation.
- No `docker-compose.yml` changes are required for this implementation.
- Rebuild the backend and worker images before deploy because both Node code and `scripts/shopee_scraper.py` changed.
- No database migration is required for the current implementation.

## 6. Recommended Next Steps
1. Run one real worker search and verify the `api` channel is exercised.
2. Force an API failure and verify DOM fallback still returns usable listings.
3. Add fixture-based regression coverage for real Shopee API payloads.
4. Decide whether profile stats need explicit API-vs-DOM summary counters in the dashboard.
