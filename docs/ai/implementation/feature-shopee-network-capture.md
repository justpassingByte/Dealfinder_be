---
type: implementation
feature: shopee-network-capture
status: completed
date: 2026-03-21
---

# Implementation Notes: Shopee Search Network Capture (V1)

## 1. Strategy Overview
- Use UI-driven interactions (`type`, `click`, `Enter`) to trigger Shopee's internal search API.
- Use `page.listen` to intercept the JSON response from `api/v4/search/search_items`.
- Replace `run_js(fetch(...))` inside the existing `_search_via_api()` path.

## 2. Key Code Changes
### `backend/scripts/shopee_scraper.py`
1.  **Introduce Intercept Logic**:
    -   Target: `/api/v4/search/search_items`
    -   Mechanism: `page.listen.start()` before `type()` and `click()`.
    -   Wait: `page.listen.wait()` for the target request packet.
    -   Payload: `res.response.body`.
2.  **Interaction Refinement**:
    -   Reuse the existing UI trigger path already in `shopee_scraper.py`.
    -   Keep character-by-character typing and randomized delays.
    -   Click or Enter if the initial typing does not trigger.
3.  **JSON Normalization**:
    -   Map intercepted JSON fields to `Listing[]`.
    -   Reuse existing `_normalize_api_listing()` and `_extract_api_items()`.
4.  **Fallback Path**:
    -   Ensure `channel='dom'` is clearly returned if the capture fails.
    -   Maintain profile health reporting.
5.  **Scope Guardrail**:
    -   Do not add a separate worker contract or generic capture framework for V1.

## 3. Interaction Steps
1.  Ensure page is [https://shopee.vn/](https://shopee.vn/).
2.  Start listener.
3.  Focus search input.
4.  Type keyword.
5.  Wait for capture.
6.  If no capture -> Press Enter -> Wait for capture.
7.  Parse and return.

## 4. Performance Notes
- Does not wait for full page rendering/scrolling.
- Stops as soon as JSON is captured.
- Dramatically reduces DOM extraction work.
