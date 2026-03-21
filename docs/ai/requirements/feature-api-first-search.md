---
type: requirement
feature: api-first-search
status: draft
date: 2026-03-21
---

# Requirement: API-First Search Layer with Browser Fallback

## 1. Problem Statement
The current catalog refresh path still depends on browser scraping whenever Redis and the catalog DB do not already have fresh data. That works, but it is the most expensive and fragile way to handle normal keyword search:
- browser navigation and DOM extraction are much slower than an authenticated API request
- CAPTCHA or DOM drift can break an otherwise routine search
- browser traffic consumes worker capacity that should be spent only when the API path is unavailable
- the repo already contains API probe scripts (`backend/test_public_api.ts`, `backend/test_csrf_api.ts`, `backend/test_mobile_api.ts`) that prove Shopee's search endpoint is viable

At the same time, the system already has:
- a queue-backed worker model
- a persistent browser session per worker/profile
- a normalized catalog schema: `products`, `product_variants`, `listings`, `price_history`

The feature should upgrade the current worker flow, not split browser ownership between Python and Node.

## 2. Goals
- Use Shopee's internal search API as the primary live refresh path for keyword search.
- Keep browser session ownership inside the DrissionPage/Python worker that already owns the real browser.
- Let Node remain the orchestrator for cache, DB freshness, persistence, and public response shaping.
- Fall back to DOM scraping inside the same worker when the API path fails or is blocked.
- Reduce browser navigation and DOM-heavy work for normal searches without detaching session handling from the browser.
- Keep the current catalog schema and catalog response shape.
- Preserve accurate profile health reporting for both API and DOM outcomes.

## 3. Scope for V1
### In scope
- Upgrade the worker search flow so it becomes `API first -> DOM fallback`.
- Keep `GET /search/catalog` as the primary route for the new behavior.
- Have Node dispatch a search job to the worker as it already does, but allow the worker to choose API before DOM.
- Normalize worker API results into the same `Listing` shape already used by the Node catalog pipeline.
- Persist API and DOM results into the same catalog tables.
- Surface whether a worker job succeeded via API or DOM so Node can return the correct `source`.

### Out of scope for V1
- Node directly attaching to CDP/DevTools and reusing the browser session itself.
- Exporting long-lived cookie snapshots from the browser to Node for direct HTTP calls.
- Replacing the legacy raw listing routes (`GET /search`, `GET /shopee/best-deals`) in the same change.
- A brand-new schema such as `product_groups`, `product_items`, or `item_prices`.
- Mandatory page-2/page-3 expansion for every search.
- Seller enrichment via a separate API before page 1 can return.

## 4. Success Criteria
- The worker attempts Shopee API before DOM scraping for normal keyword search jobs.
- Successful API worker jobs return data that Node can persist and serve as `source: "api"`.
- DOM fallback still works transparently when the worker API path fails or is blocked.
- API and DOM results land in `products`, `product_variants`, `listings`, and `price_history` through the existing catalog flow.
- Search telemetry distinguishes worker API success from DOM fallback.
- Median live refresh latency improves materially versus the current DOM-only worker path.

## 5. User Stories
- **As a search user**, I want live refresh to be faster when the worker already has a valid browser session.
- **As an operator**, I want the system to keep using the same real browser session instead of splitting it across multiple runtimes.
- **As a developer**, I want API and DOM results to feed one catalog model and one response shape.
- **As an admin**, I want profile risk and events to reflect both API failures and DOM failures inside the worker.

## 6. Functional Requirements
- The public catalog flow must remain cache and DB first.
- After cache miss and stale-or-missing DB data, Node must dispatch a worker job as it does today.
- Inside that worker job, the execution order must be:
  1. Shopee API using the live browser session owned by the worker
  2. DOM scraping fallback in the same worker if API fails
- V1 must keep browser/session ownership inside the worker. Node must not attach to CDP and call Shopee directly in the main search path.
- Worker API execution must reuse the live Shopee browser session rather than reconstructing a second independent session in Node.
- API and DOM worker outputs must normalize to the existing `Listing` contract so downstream Node persistence does not fork.
- Catalog persistence must continue to use:
  - `products`
  - `product_variants`
  - `listings`
  - `price_history`
- Worker result metadata must let Node distinguish whether the job succeeded via API or DOM.
- A valid zero-result API response should remain a valid zero-result result, not an automatic DOM fallback.
- If the API path fails because of auth, rate limit, block evidence, invalid payload, or browser-context execution failure, the worker must try DOM fallback before the system gives up.
- API and DOM outcome telemetry must be reported against the worker's assigned profile.

## 7. Non-Functional Requirements
- The feature must fit the current Node + BullMQ + Python worker architecture.
- It must not introduce a second production code path that competes with the worker for browser ownership.
- It must keep cookies and session tokens inside the worker/runtime that owns the browser whenever possible.
- It must be observable enough to compare API success rate vs DOM fallback rate.
- It must remain resilient to Shopee payload drift through tolerant parsing and controlled fallback behavior.

## 8. Constraints
- Each worker already owns one persistent browser profile and one live browser session.
- `catalogSearchService` is in Node, but actual browser control lives behind the worker path.
- `scraperWorker.ts` and `scraperService.ts` already form the worker execution boundary; API-first search should build on that boundary rather than bypass it.
- The current `DevtoolsTargetService` is for operator/debug workflows, not the main production data path.

## 9. Resolved Decisions
- **Primary architecture**: Node orchestrates, worker executes API first, then DOM fallback.
- **Session ownership**: keep session inside DrissionPage/Python worker; do not split it into a Node-side direct HTTP path in v1.
- **Schema strategy**: reuse the existing catalog schema instead of introducing new grouping tables.
- **Pipeline order**: `cache -> DB -> worker(API -> DOM) -> stale fallback`.
- **Scoring compatibility**: keep current comparison/deal scoring behavior. This feature is about acquisition path, not deal-engine redesign.
- **Public route strategy**: keep `GET /search/catalog` response shape stable and only extend `source` semantics.

## 10. Open Questions
- After page-1 worker API success is stable, should page-2/page-3 expansion stay in the worker or remain deferred?
