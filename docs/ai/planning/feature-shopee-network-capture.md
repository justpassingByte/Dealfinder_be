---
type: planning
feature: shopee-network-capture
status: completed
date: 2026-03-21
---

# Execution Plan: Replace API Calls with Network Capture (Shopee Search)

## 1. Feature Breakdown
1. **Requirement Documentation**: finished.
2. **Design Alignment**: finished.
3. **Core Worker Change**: finished.
4. **Fallback Preservation**: finished.
5. **Direct Mode (PDP) Capture**: finished.
6. **Zero-DOM-Wait Strategy**: finished (added window.stop()).
7. **Direct Navigation Strategy**: finished (resolved input issues).
8. **Verification**: finished.

## 2. Implementation Subtasks

### Subtask 3.1: Narrow Refactor in `_search_via_api()`
- remove the dependency on `_fetch_api_page()`
- keep the method name and overall return shape unchanged
- reuse the current search selectors and typing behavior already present in `shopee_scraper.py`

### Subtask 3.2: Network Listening Integration
- listen for `api/v4/search/search_items`
- start the listener before typing/submitting the query
- wait for the matching response and read `response.body`

### Subtask 4.1: Preserve Existing Contracts
- reuse `_extract_api_items()` and `_normalize_api_listing()`
- keep `channel`, `apiAttempted`, `apiFailureReason`, and `validEmptyResult` compatible with the current runtime result
- let the existing DOM path remain the fallback for timeout, invalid payload, block signal, or CAPTCHA

## 3. Dependencies
- `DrissionPage` version with `page.listen`
- existing Shopee page interaction helpers and selectors in `shopee_scraper.py`
- normal browser access to `https://shopee.vn/`

## 4. Implementation Order
1. Update `_search_via_api()` to prepare the page and start `page.listen`.
2. Trigger the search through the existing UI path.
3. Parse the captured payload through the current normalization helpers.
4. Remove `_fetch_api_page()` once the old call path is gone.
5. Run a one-off scraper test and verify API success plus DOM fallback behavior.

## 5. Effort Estimate
- Documentation/design alignment: 0.5h
- Core capture refactor: 2h
- Testing and fallback verification: 1.5h
- Total: about 4h

## 6. Risks
- **Capture timeout**: the target request may not fire or may not match cleanly on the first attempt.
- **Interaction failure**: the search input may not be focusable/clearable in some page states.
- **Payload drift**: the intercepted JSON may not match the current extraction assumptions.
- **Scope creep**: multi-page capture or new abstractions can slow V1 without improving the main page-1 outcome.
