# DealFinder Production Guide

## Architecture

- **Frontend:** Deployed on **Vercel** (CDN, serverless).
- **Backend:** Deployed on **VPS** — Node.js API, BullMQ job queue, PostgreSQL, Redis.
- **Scraper Cluster:** 2 isolated worker containers (scalable to N), each with its own Chromium instance and browser profile directory. BullMQ distributes scrape jobs across workers automatically.

---

## Part 1: Deploy Backend + Scraper Cluster on VPS

### 1. SSH into the VPS

```bash
ssh root@your_vps_ip
```

### 2. Install Docker & Add Swap

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
apt-get update && apt-get install -y git

# Add 2GB Swap (required for 3GB RAM VPS running 2+ Chromium instances)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
free -h  # Verify Swap: 2.0Gi should appear
```

### 3. Clone the Backend Repo

```bash
mkdir -p /var/www/dealfinder && cd /var/www/dealfinder
git clone https://github.com/justpassingByte/Dealfinder_be.git backend
cd backend
```

### 4. Configure Environment

```bash
cp .env.example .env
nano .env
```

Minimum values to set:

```env
PRODUCTION_DOMAIN=api.your-domain.com
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=dealfinder
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

### 5. Create Worker Profile Directories

Each worker needs its own isolated Chromium profile to avoid lock-file contention:

```bash
mkdir -p shopee_user_profile_1 shopee_user_profile_2
```

> To add a 3rd worker later: `mkdir -p shopee_user_profile_3`

### 6. Build & Start

```bash
docker compose up -d --build
```

This starts: PostgreSQL, Redis, Backend API (port 4000), Caddy (SSL), and **2 scraper workers** (`worker-1`, `worker-2`).

### 7. Run Migrations

Wait ~30 seconds for containers to initialize, then:

```bash
docker compose exec backend npm run migrate
docker compose exec backend npm run migrate:catalog
```

### 8. Verify Workers Are Running

```bash
docker compose logs worker-1 --tail 5
docker compose logs worker-2 --tail 5
```

You should see:
```
[ScraperWorker][worker-1] Worker started, waiting for jobs...
[ScraperWorker][worker-2] Worker started, waiting for jobs...
```

---

## CAPTCHA Debugging (SSH Tunnel)

Debug ports are always enabled and bound to `127.0.0.1` (loopback only — not exposed publicly).

### Open SSH Tunnel from your local machine:

```bash
ssh -L 9222:localhost:9222 -L 9223:localhost:9223 root@your_vps_ip
```

### Then inspect each worker's browser:

| Worker | URL |
|:-------|:----|
| worker-1 | `http://localhost:9222` |
| worker-2 | `http://localhost:9223` |

Open the URL in Chrome on your local machine. You will see the tabs open on the VPS. Select the Shopee tab with the CAPTCHA and solve it manually.

> **Note:** If one worker is blocked by CAPTCHA, the other worker continues to handle search requests normally.

---

## Scaling: Adding More Workers

To add a 3rd worker, do the following:

### 1. Create the profile directory on VPS:

```bash
mkdir -p shopee_user_profile_3
```

### 2. Add a `worker-3` block to `docker-compose.yml`:

Copy the `worker-2` block and change:

```yaml
  worker-3:
    <<: *worker-base
    container_name: backend-worker-3
    environment:
      SCRAPER_WORKER_ID: worker-3
      REDIS_HOST: redis
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres_password}@postgres:5432/${POSTGRES_DB:-dealfinder}
      USE_REDIS_MOCK: "false"
      NODE_ENV: production
    volumes:
      - ./shopee_user_profile_3:/app/shopee_user_profile
    ports:
      - "127.0.0.1:9224:9222"
```

### 3. Add `worker-3` to backend depends_on and rebuild:

```bash
docker compose up -d --build
```

### 4. Update your SSH tunnel:

```bash
ssh -L 9222:localhost:9222 -L 9223:localhost:9223 -L 9224:localhost:9224 root@your_vps_ip
```

---

## RAM & Resource Monitoring

Each Chromium instance uses 600Mi–1Gi during active scraping.

| Workers | Estimated Peak RAM | Swap Needed |
|:--------|:-------------------|:------------|
| 2       | ~2.1 – 2.6 Gi     | 2 Gi        |
| 3       | ~2.6 – 3.2 Gi     | 2–4 Gi      |

Monitor with:
```bash
watch free -h
docker stats --no-stream
```

---

## Frontend Deployment (Vercel)

1. Log in to [Vercel.com](https://vercel.com) with your GitHub account.
2. Import the frontend repo.
3. Set backend target environment variable:
   `DESTINATION_API_URL=https://api.your-domain.com`
4. Optional compatibility fallback:
   `NEXT_PUBLIC_API_URL=https://api.your-domain.com`
5. Deploy.

> Do **not** append `/api` - the frontend rewrite already adds it.
>
> In production, the browser calls the frontend at `/api/...` and Vercel rewrites that request to the backend target above. If `DESTINATION_API_URL` is missing or stale, frontend requests will never reach the backend worker.
