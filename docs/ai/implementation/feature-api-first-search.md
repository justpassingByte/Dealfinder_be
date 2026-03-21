---
type: implementation
feature: api-first-search
status: draft
date: 2026-03-21
---

# Implementation: API-First Search Layer with Browser Fallback

## 1. Backend Structure
- `backend/src/services/catalogSearchService.ts`
  - keep as the main orchestrator
  - keep Node-side order as `cache -> DB -> worker -> stale fallback`
  - persist worker output through the existing catalog flow
- `backend/src/workers/scraperWorker.ts`
  - keep worker/profile ownership and queue gating
  - execute worker jobs that now use `API first -> DOM fallback`
- `backend/src/services/scraperService.ts`
  - evolve from "run Python scraper" into "run Python worker search runtime"
  - parse richer telemetry/result metadata from Python
- `backend/scripts/shopee_scraper.py`
  - implement worker-side API-first logic using the live DrissionPage browser session
  - normalize API and DOM output into one JSON listing contract
- `backend/src/services/scraperProfileService.ts`
  - keep profile ownership, runnable-state gating, and outcome reporting
  - extend outcome reporting if needed so API vs DOM channel is visible
- `backend/src/types/scraperProfile.ts`
  - extend telemetry types if needed to include execution channel

## 2. Core Implementation Decisions
- Do not add Node-side CDP session extraction for v1.
- Do not add a new `browserSessionService.ts` as the main production path.
- Do not split the live Shopee session between Python browser control and Node direct HTTP calls.
- Keep API-first execution inside the worker/browser context.
- Reuse the current catalog schema and current `Listing` contract.

## 3. Search Pipeline Changes
### `catalogSearchService.ts`
Keep the top-level Node flow conceptually as:
- `cache -> DB -> worker -> stale fallback`

But redefine the worker stage as:
- `worker(API -> DOM)`

### Specific edits
- extend source typing so the public response can distinguish `api` from `scraper`
- keep Redis cache and DB freshness logic
- keep product lock and stale fallback behavior
- continue persisting normalized `Listing[]` through the current catalog path

Node should not care whether the worker got the listings via API or DOM, except for:
- public `source`
- telemetry
- observability

## 4. Worker Contract Changes
The current worker path returns listings only. For API-first search, the worker should also return or emit:
- execution channel: `api` or `dom`
- blocked/failure metadata
- raw vs processed counts if useful

Conceptual shape:
```ts
interface WorkerSearchResult {
  listings: Listing[];
  channel: 'api' | 'dom';
}
```

If the result shape is kept unchanged, then equivalent metadata must be present in telemetry so Node can still map response source and profile events correctly.

## 5. `scraperWorker.ts`
Keep the current worker lifecycle:
- claim profile
- heartbeat
- pause when non-runnable
- process jobs serially

Update the job execution path so:
1. the worker calls the Python runtime
2. the Python runtime attempts API first using the live browser session
3. if API fails, the same runtime falls back to DOM
4. the worker reports the final outcome and channel back to profile telemetry

This is cleaner than making Node attach to the worker's browser over CDP during live traffic.

## 6. `scraperService.ts`
Today this file shells out to `scripts/shopee_scraper.py` and post-processes `Listing[]`.

For this feature it should:
- parse richer JSON output from Python if channel metadata is added
- keep current post-processing and filtering behavior
- return telemetry that distinguishes:
  - API success
  - DOM success
  - API failure with DOM fallback
  - full failure

This file becomes the clean Node boundary around the worker runtime.

## 7. `scripts/shopee_scraper.py`
This is the main feature work.

### Required behavior
1. Use the existing live DrissionPage browser/profile session.
2. Attempt Shopee API request first from that session context.
3. Normalize API response into the same JSON listing shape already expected by Node.
4. If API execution fails, fall back to the existing DOM scraping path.
5. Return a result that lets Node tell whether the final listings came from API or DOM.

### Preferred execution style
Prefer browser-context API execution over exporting cookies to Node.

That means the production code should be closer to:
- "worker executes API inside the live browser session"

and not:
- "worker exports browser session so Node can call Shopee directly"

## 8. Profile Reporting Changes
`ScraperProfileService` currently assumes scrape outcomes. API-first search means the worker can succeed without DOM scraping.

Recommended change:
- generalize outcome reporting so telemetry includes execution channel

Minimum useful channel-aware classes:
- `api_success`
- `api_empty`
- `api_blocked`
- `api_failed_dom_fallback_success`
- `dom_success`
- `dom_failed`

This avoids misleading the dashboard into thinking every successful search came from DOM scrape.

## 9. Explicitly Avoid
- Node attaching to CDP in the main search path
- long-lived cookie snapshot sharing between Python and Node
- inventing a second catalog schema
- requiring page-2/page-3 work for initial rollout
- assuming the worker must expose a generic DevTools/session API to Node first

## 10. Execution Steps
1. Update `scripts/shopee_scraper.py` with API-first worker logic.
2. Update `scraperService.ts` to parse richer Python output and telemetry.
3. Update `scraperWorker.ts` to propagate execution channel through job result/profile reporting.
4. Update `catalogSearchService.ts` so public `source` maps correctly from worker channel.
5. Extend telemetry/profile types as needed.
6. Run existing search tests and add worker API-first tests.
