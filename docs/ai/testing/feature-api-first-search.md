---
type: testing
feature: api-first-search
status: draft
date: 2026-03-21
---

# Test Plan: API-First Search Layer with Browser Fallback

## 1. Test Strategy
The feature changes the worker runtime, not just a Node HTTP client. Tests need to cover:
- worker API execution
- worker DOM fallback
- Node/worker result contract
- catalog persistence compatibility
- profile telemetry compatibility

## 2. Unit Testing
- [ ] Node parsing of worker JSON output still succeeds when the worker returns execution channel metadata.
- [ ] Worker result mapping correctly translates `channel=api` to public `source=api`.
- [ ] Worker result mapping correctly translates `channel=dom` to public `source=scraper`.
- [ ] Catalog persistence helper accepts worker API output without special-case branching.
- [ ] Profile telemetry types can distinguish API vs DOM outcomes.

## 3. Fixture-Based Tests
- [ ] Store at least one successful Shopee API payload fixture captured from DevTools or local probe scripts.
- [ ] Store at least one blocked or malformed API payload fixture.
- [ ] Verify worker-side normalization succeeds when optional fields are missing.
- [ ] Verify valid zero-result API payloads remain valid zero-result outcomes.

## 4. Integration Testing
- [ ] `catalogSearchService` still follows the top-level order `cache -> DB -> worker -> stale fallback`.
- [ ] A worker job can succeed through API and return data that persists correctly into the catalog.
- [ ] A worker job falls back from API to DOM and still returns a valid listing set.
- [ ] If both worker API and worker DOM fail, stale DB fallback behavior remains unchanged.
- [ ] Profile outcome reporting records whether the final worker path was API or DOM.

## 5. Regression Testing
- [ ] Existing signature tests still pass.
- [ ] Existing search pipeline tests still pass.
- [ ] Existing catalog response shape remains unchanged apart from richer `source` meaning.
- [ ] Existing worker pause/resume and profile gating behavior still works.

## 6. Manual Verification
- [ ] Use `backend/test_public_api.ts`, `backend/test_csrf_api.ts`, or the validated DevTools request as a preflight check for the endpoint shape.
- [ ] Run `GET /search/catalog?q=<known query>` with refresh forced and confirm `source: "api"` when the worker API path succeeds.
- [ ] Intentionally force API failure and confirm the same worker falls back to DOM before Node serves stale data.
- [ ] Verify persisted catalog rows still land in:
  - `products`
  - `product_variants`
  - `listings`
  - `price_history`
- [ ] Confirm no Node-side CDP/session extraction path is required for a successful API-first search.

## 7. Failure Injection
- [ ] Simulate API auth failure inside the worker and verify DOM fallback succeeds.
- [ ] Simulate malformed API payload and verify DOM fallback succeeds.
- [ ] Simulate full worker failure and verify stale fallback behavior remains intact.
- [ ] Simulate optional seller/rating fields being absent and verify normalization still succeeds.

## 8. Rollout Metrics
- [ ] Track worker API success rate vs worker DOM fallback rate.
- [ ] Track page-1 latency before and after API-first worker rollout.
- [ ] Track per-profile blocked or degraded outcomes by execution channel.
- [ ] Track whether DOM-heavy worker traffic drops after enablement.
