import { Job, Worker } from 'bullmq';
import { config } from '../config/env';
import { clearJobInFlight, setCachedListings } from '../services/cacheService';
import { scrapeListingsWithTelemetry } from '../services/scraperService';
import { scraperProfileService } from '../services/scraperProfileService';
import { Listing } from '../types/listing';
import { ScraperProfile } from '../types/scraperProfile';

const WORKER_ID = process.env.SCRAPER_WORKER_ID || 'worker-default';
const WARMUP_MAX_ITEMS = 20;

export interface ScraperJobData {
    query: string;
    marketplace?: string;
    maxItems?: number;
}

export interface ScraperJobResult {
    listings: Listing[];
}

let scraperWorker: Worker<ScraperJobData, ScraperJobResult> | null = null;
let queuePaused = false;
let currentProfile: ScraperProfile | null = null;
let warmupInFlight = false;
let heartbeatTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;

async function pauseWorker(reason: string): Promise<void> {
    if (!scraperWorker || queuePaused) {
        return;
    }

    await scraperWorker.pause(true);
    queuePaused = true;
    console.log(`[ScraperWorker][${WORKER_ID}] Queue paused: ${reason}`);
}

async function resumeWorker(reason: string): Promise<void> {
    if (!scraperWorker || !queuePaused) {
        return;
    }

    await scraperWorker.resume();
    queuePaused = false;
    console.log(`[ScraperWorker][${WORKER_ID}] Queue resumed: ${reason}`);
}

async function syncWorkerState(profile: ScraperProfile | null, reason: string): Promise<void> {
    currentProfile = profile;

    if (!profile) {
        await pauseWorker(`${reason}; no assigned scraper profile`);
        return;
    }

    if (profile.isRunnable) {
        await resumeWorker(`${reason}; profile ${profile.displayName} is runnable`);
        return;
    }

    await pauseWorker(`${reason}; profile ${profile.displayName} is ${profile.effectiveStatus}`);
}

async function bootstrapWorkerProfile(): Promise<void> {
    try {
        const profile = await scraperProfileService.claimWorkerProfile(WORKER_ID);
        await syncWorkerState(profile, 'startup');

        if (!profile) {
            console.error(`[ScraperWorker][${WORKER_ID}] No scraper profile is assigned to this worker ID.`);
        } else {
            console.log(`[ScraperWorker][${WORKER_ID}] Claimed profile "${profile.displayName}" (${profile.id}).`);
        }
    } catch (error) {
        console.error(`[ScraperWorker][${WORKER_ID}] Failed to claim profile:`, error);
        await pauseWorker('startup claim failure');
    }
}

async function heartbeatWorker(): Promise<void> {
    try {
        const profile = await scraperProfileService.heartbeatWorker(WORKER_ID);
        await syncWorkerState(profile, 'heartbeat');
    } catch (error) {
        console.error(`[ScraperWorker][${WORKER_ID}] Heartbeat failed:`, error);
    }
}

async function runWarmupIfNeeded(): Promise<void> {
    if (warmupInFlight) {
        return;
    }

    try {
        const pendingWarmup = await scraperProfileService.getPendingWarmupQuery(WORKER_ID);
        if (!pendingWarmup) {
            return;
        }

        warmupInFlight = true;
        const { profile, query } = pendingWarmup;
        console.log(`[ScraperWorker][${WORKER_ID}] Running warmup for profile "${profile.displayName}" with query "${query}"`);

        const telemetry = await scrapeListingsWithTelemetry(query, 'shopee', WARMUP_MAX_ITEMS, true);
        const updatedProfile = await scraperProfileService.reportScrapeOutcome(profile.id, query, telemetry, true);
        await syncWorkerState(updatedProfile, 'warmup');
    } catch (error) {
        console.error(`[ScraperWorker][${WORKER_ID}] Warmup failed:`, error);
    } finally {
        warmupInFlight = false;
    }
}

function registerRuntimeLoops(): void {
    const intervalMs = scraperProfileService.getHeartbeatIntervalMs();

    heartbeatTimer = setInterval(() => {
        void heartbeatWorker();
    }, intervalMs);

    maintenanceTimer = setInterval(() => {
        void runWarmupIfNeeded();
    }, intervalMs);
}

async function shutdownWorker(signal: string): Promise<void> {
    console.log(`[ScraperWorker][${WORKER_ID}] Received ${signal}, shutting down...`);

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }
    if (maintenanceTimer) {
        clearInterval(maintenanceTimer);
    }

    try {
        await scraperProfileService.releaseWorker(WORKER_ID, signal);
    } catch (error) {
        console.error(`[ScraperWorker][${WORKER_ID}] Failed to release profile:`, error);
    }

    if (scraperWorker) {
        await scraperWorker.close();
    }

    process.exit(0);
}

if (!config.redis.useMock) {
    scraperWorker = new Worker<ScraperJobData, ScraperJobResult>(
        'scraper',
        async (job: Job<ScraperJobData>) => {
            const { query, marketplace, maxItems = 60 } = job.data;
            const runtimeProfile = await scraperProfileService.getWorkerProfile(WORKER_ID);

            if (!runtimeProfile) {
                throw new Error(`Worker ${WORKER_ID} does not have an assigned scraper profile.`);
            }

            if (!runtimeProfile.isRunnable) {
                await syncWorkerState(runtimeProfile, 'job gate');
                throw new Error(`Worker ${WORKER_ID} is not runnable while profile status is ${runtimeProfile.effectiveStatus}.`);
            }

            console.log(
                `[ScraperWorker][${WORKER_ID}] Processing job ${job.id}: query="${query}", marketplace="${marketplace || 'all'}", maxItems="${maxItems}"`
            );

            try {
                const telemetry = await scrapeListingsWithTelemetry(query, marketplace, maxItems);
                const updatedProfile = await scraperProfileService.reportScrapeOutcome(runtimeProfile.id, query, telemetry);
                await syncWorkerState(updatedProfile, 'job outcome');

                if (telemetry.failureReason) {
                    throw new Error(telemetry.failureReason);
                }

                if (telemetry.listings.length > 0) {
                    await setCachedListings(query, telemetry.listings);
                }

                return { listings: telemetry.listings };
            } finally {
                await clearJobInFlight(query);
            }
        },
        {
            connection: {
                host: config.redis.host,
                port: config.redis.port,
            },
            concurrency: 1,
        }
    );

    scraperWorker.on('completed', (job: Job<ScraperJobData> | undefined, result: ScraperJobResult) => {
        console.log(`[ScraperWorker][${WORKER_ID}] Job ${job?.id} completed with ${result.listings.length} listings`);
    });

    scraperWorker.on('failed', (job: Job<ScraperJobData> | undefined, err: Error) => {
        console.error(`[ScraperWorker][${WORKER_ID}] Job ${job?.id} failed:`, err.message);
    });

    console.log(`[ScraperWorker][${WORKER_ID}] Worker started, waiting for jobs...`);
    void bootstrapWorkerProfile();
    registerRuntimeLoops();

    process.on('SIGINT', () => {
        void shutdownWorker('SIGINT');
    });
    process.on('SIGTERM', () => {
        void shutdownWorker('SIGTERM');
    });
} else {
    console.log('[ScraperWorker] Worker disabled (Mock Mode)');
}

export default scraperWorker;
