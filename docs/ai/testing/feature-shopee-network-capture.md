---
type: testing
feature: shopee-network-capture
status: completed
date: 2026-03-21
---

# Testing Plan: Replace API Calls with Network Capture (Shopee Search)

## 1. Unit Testing (Worker Side)
- Test the updated `_search_via_api()` capture path with a valid keyword such as `washing machine`.
- Verify `api/v4/search/search_items` is captured.
- Verify `channel='api'` is returned in the stdout JSON.
- Test the capture path with a non-existent keyword.
- Verify zero results are handled correctly with `valid_empty_result=True`.

## 2. Integration Testing (Scraper Worker)
- Dispatch a search job through BullMQ or via `scraperWorker.ts`.
- Verify the worker successfully triggers the UI and captures results.
- Check the Node response source:
  - `source: "api"` when capture succeeded
  - `source: "scraper"` when capture failed and DOM fallback was used

## 3. Fallback and Resilience Testing
- Disable or mock capture failure and verify the worker still returns results via DOM scraping.
- Simulate a CAPTCHA and verify manual recovery or proper block reporting.
- Test with button submit available.
- Test with Enter submit fallback.

## 4. Success Criteria Verification
- [ ] No `90309999` errors for 100+ consecutive searches.
- [ ] Median search latency stays comfortably below the DOM-only path.
- [ ] CAPTCHA rate does not regress for routine search jobs.
- [ ] `Listing[]` shape stays consistent for both `api` and `dom`.

## 5. Performance Metrics
- Track `api` vs `dom` success rate.
- Measure average time from search trigger to captured API response.
- Compare end-to-end latency versus the current DOM fallback path.
