---
type: requirement
feature: multi-scraper-workers
status: review
---

# Requirement: Multi-Scraper Workers

## 1. Problem Statement
The current scraping stack is only partially parallelized.

- The BullMQ scraper worker can claim multiple jobs, but each worker container owns one Chromium instance and `shopee_scraper.py` reuses fixed tabs in that browser.
- `catalogSearchService` still scrapes directly and uses a cluster-wide Redis key (`df:global_browser_lock`), which serializes browser access across the whole deployment.
- `docker-compose.yml` currently couples the backend to one worker endpoint, so adding more worker containers alone will not spread all scrape traffic.

The feature must introduce real worker-level isolation so multiple scrape jobs can run in parallel without shared profile locks, tab collisions, or one blocked worker stalling the full system.

## 2. Goals & Success Criteria
- Goal: Run `N` isolated scraper worker containers on one VPS.
- Goal: Keep one Chromium profile directory per worker container.
- Goal: Keep one persistent remote-debugging host port per worker container (always enabled) for SSH-tunneled debugging.
- Goal: Route all production scraping entry points through the worker pool instead of a single global browser lock.
- Goal: Limit each worker container to one active scrape job at a time unless the Python/browser model is redesigned.

Success criteria:
- Up to `N` scrape jobs can execute in parallel across `N` workers without profile or tab contention.
- A CAPTCHA or crash on one worker does not block unrelated jobs from being handled by other workers.
- The system logs which worker handled each scrape job.
- Admins can inspect a specific worker browser through a predictable port mapping when debug ports are enabled.
- A 30-minute soak test on the target VPS completes without repeated OOM restarts.

## 3. Non-Goals
- Dynamic autoscaling or worker auto-provisioning.
- Running multiple concurrent scrape jobs inside one Chromium/profile pair.
- Sharing one persistent Chromium profile across multiple worker containers.
- Eliminating CAPTCHA entirely.

## 4. User Stories
- As a user, I can submit a search while other searches are running and still get a response from an available worker.
- As an administrator, I can identify which worker is failing or blocked and inspect only that worker's browser.
- As an administrator, I can add another worker by adding another compose worker definition or generated worker block, without changing scraper logic.

## 5. Constraints
- `shopee_scraper.py` currently assumes one shared browser with two stable tabs (`user` and `maintenance`), so per-container concurrency greater than `1` is unsafe.
- `catalogSearchService` currently uses a cluster-wide browser lock and must be rerouted or refactored before multi-worker scaling is complete.
- On the current stack (Postgres + Redis + API + Chromium workers + Caddy), a 3 GB VPS is tight. Default rollout should assume `2` workers plus swap; `3` workers requires measurement and soak validation.
- Debug ports are for admin inspection only. Application traffic must not depend on host-mapped debug ports.
- Each worker needs a unique persistent profile path to avoid Chromium lock-file and SQLite contention.

## 6. Resolved Decisions
- **Queue Partitioning**: Catalog refresh and scheduled maintenance will use separate dedicated BullMQ queues (for example `catalog-scraper` and `maintenance-scraper`). To keep high-priority search traffic from being starved, the deployment must also reserve worker capacity for the `scraper` queue. Queue separation alone is not sufficient.
- **Always-on Debugging**: Remote debugging ports are enabled by default in the production docker-compose file for continuous administrative inspection via SSH tunneling, but they must be bound to loopback-only host ports.
