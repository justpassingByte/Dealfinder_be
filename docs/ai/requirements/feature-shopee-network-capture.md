---
type: requirement
feature: shopee-network-capture
status: completed
date: 2026-03-21
---

# Requirement: Replace API Calls with Network Capture (Shopee Search)

## 1. Problem Statement
The current Shopee search implementation uses `run_js(fetch(...))` to perform direct API calls from the browser context. This approach is being detected by Shopee as automation (CDP evaluation), leading to:
- Error `90309999` (business block/detection)
- Increased CAPTCHA risk
- Reduced stability and performance

To maintain high data quality and system reliability, we need an approach that is indistinguishable from real human search behavior while still benefiting from the clean JSON data provided by Shopee's internal search API.

## 2. Goals
- Eliminate direct API calls via `fetch` in the browser context.
- Switch to capturing real frontend API responses triggered by UI interactions.
- Avoid detection that causes error `90309999`.
- Reduce CAPTCHA risk by simulating human-like search interactions.
- Improve data extraction stability by parsing captured JSON.
- Reuse existing browser tabs and sessions to minimize overhead.

## 3. Scope for V1
### In Scope
- Replace the direct `fetch` path inside the existing `_search_via_api()` logic in `shopee_scraper.py`.
- **Direct Mode (PDP)**: Replace DOM-based price extraction on single product pages with `api/v4/pdp/get_pc` network capture.
- Integrate `page.listen.start()` and `page.listen.wait()` for network capturing (search and PDP).
- Implement search triggering via UI:
  - Navigating to `shopee.vn` (home or existing tab).
  - Clearing and typing into the search input.
  - Pressing Enter or clicking the search button if needed.
- Extracting and parsing the `api/v4/search/search_items` and `api/v4/pdp/get_pc` response bodies.
- Fallback to existing DOM scraping if capture fails.
- Tab reuse and session maintenance.

### Out of Scope
- Implementing a completely new browser orchestration layer.
- Changing the catalog schema.
- Automated CAPTCHA solving (manual recovery is already handled).

## 4. Success Criteria
- No more `90309999` errors caused by `fetch` detection.
- Successful extraction of search results via network capture.
- Graceful fallback to DOM scraping when capture fails or times out.
- Minimal increase in latency compared to the previous API path (keeping it faster than full DOM scraping).
- Accurate profile health reporting.

## 5. User Stories
- **As a search user**, I want to receive fresh search results reliably without seeing "something went wrong" errors.
- **As an operator**, I want the scraper to stay "under the radar" and avoid triggering anti-bot measures that affect profile health.
- **As a developer**, I want a clean way to get JSON search data without being blocked by Shopee's CDP detection.

## 6. Functional Requirements
- **Capture Strategy**: Use `page.listen` to capture requests matching `api/v4/search/search_items`.
- **Search Trigger**:
  1. Ensure the page is at `shopee.vn`.
  2. Start network listener.
  3. Locate search input, click, and type the keyword (mimicking human speed).
  4. Fallback: Press Enter if no request is captured.
- **Implementation Scope**: Keep the change inside the existing worker search flow; do not add a new orchestration layer just for capture.
- **Data Extraction**: Parse the captured JSON response (body) and map it to the `Product` model/listing shape.
- **Tab Reuse**: Keep the same tab open for subsequent searches; do not close/re-open.
- **Performance**: Stop processing as soon as the relevant API response is captured; do not wait for the full page to render.
- **Error Handling**: Fallback to DOM scraping if:
  - No request is captured within timeout (e.g., 5-10 seconds).
  - Response is invalid or missing items.
  - CAPTCHA is detected.

## 7. Non-Functional Requirements
- **Aesthetics/Human-Likeness**: Interactions must look realistic to avoid detection.
- **Reliability**: Timeouts and retries must be robust.
- **Maintainability**: Clear separation between capture logic and extraction logic.

## 8. Constraints
- Do NOT use `run_js(fetch(...))`.
- Do NOT use `DrissionPage` methods that are known to trigger CDP detection for API calls.
- Reuse the existing `Listing[]` normalization logic.

## 9. Open Questions
- What is the optimal typing speed/delay to avoid detection while maintaining performance?
- Should we open `https://shopee.vn/` every time or only when the current tab is not already on a usable Shopee page?
