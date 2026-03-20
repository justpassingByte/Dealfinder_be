---
type: planning
feature: multi-scraper-workers
status: in-progress
---

# Planning: Multi-Scraper Workers

## Phase 1: Make Browser Ownership Safe
- [x] Change BullMQ scraper worker concurrency from `5` to `1`.
- [x] Add a worker identifier env var `SCRAPER_WORKER_ID` and include it in all scrape logs.
- [x] Audit every production code path that calls `scrapeListings(...)` directly and classify it as either queued or local-only.

## Phase 2: Remove Single-Worker Coupling
- [x] Refactor catalog refresh flows so browser work runs through BullMQ worker pool instead of direct `scrapeListings()` call from the API container.
- [x] Remove the cluster-wide Redis browser lock (`df:global_browser_lock`). Replaced with queue-based dispatch.
- [x] Keep only dedupe locks for duplicate queries or duplicate product refreshes (per-product `scrapeLock` retained).

## Phase 3: Reshape Compose For Multiple Workers
- [x] Introduce a reusable worker base block (`x-worker-base` YAML anchor) in `docker-compose.yml`.
- [x] Replace the single `worker` service with explicit `worker-1` and `worker-2` services (template pattern for easy scaling).
- [x] Give each worker:
  - its own profile mount (`./shopee_user_profile_n:/app/shopee_user_profile`)
  - a loopback-only debug port mapping (`127.0.0.1:9222+n-1:9222`)
  - `restart: unless-stopped`
- [x] Remove the backend's dependency on `SCRAPER_BROWSER_HOST` / `SCRAPER_BROWSER_PORT`.
- [x] Remove the `proxy.py` mount and command (file does not exist in repo).
- [x] Remove the shared `shopee_profile` volume from backend container.

## Phase 4: Update Runtime And Ops Docs
- [x] Update `PRODUCTION.md` with the new worker layout, loopback-only debug ports, and SSH tunnel examples.
- [x] Document the recommended rollout order: 2 workers first on 3 GB RAM, then evaluate 3 workers only after soak testing.
- [x] Document how to identify a failing worker from logs and how to inspect its browser.

## Phase 5: Validate
- [ ] Create `shopee_user_profile_1` and `shopee_user_profile_2` directories on VPS.
- [ ] Set up 2GB swap on VPS.
- [ ] Run with 2 workers and confirm two concurrent scrape jobs complete in parallel.
- [ ] Confirm `search` and catalog refresh traffic both use the worker pool.
- [ ] Confirm one worker hitting CAPTCHA does not stall the entire queue.
- [ ] Measure RAM over a 30-minute soak test before enabling a third worker on a 3 GB host.

## Risks
- Leaving any direct backend scraping path in place will preserve a single-worker bottleneck.
- Keeping worker concurrency above `1` will cause browser tab contention with the current Python scraper.
- Exposing Chrome debug ports publicly instead of binding to loopback increases attack surface.
