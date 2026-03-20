import { Worker, Job } from 'bullmq';
import { config } from '../config/env';
import { scrapeListings } from '../services/scraperService';
import { setCachedListings, clearJobInFlight } from '../services/cacheService';
import { Listing } from '../types/listing';

const WORKER_ID = process.env.SCRAPER_WORKER_ID || 'worker-default';

export interface ScraperJobData {
    query: string;
    marketplace?: string;
    maxItems?: number;
}

export interface ScraperJobResult {
    listings: Listing[];
}

let scraperWorker: Worker<ScraperJobData, ScraperJobResult> | null = null;

if (!config.redis.useMock) {
    scraperWorker = new Worker<ScraperJobData, ScraperJobResult>(
        'scraper',
        async (job: Job<ScraperJobData>) => {
            const { query, marketplace, maxItems = 60 } = job.data;
            console.log(
                `[ScraperWorker][${WORKER_ID}] Processing job ${job.id}: query="${query}", marketplace="${marketplace || 'all'}", maxItems="${maxItems}"`
            );

            try {
                const listings = await scrapeListings(query, marketplace, maxItems);

                if (listings.length > 0) {
                    await setCachedListings(query, listings);
                }

                return { listings };
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
} else {
    console.log('[ScraperWorker] Worker disabled (Mock Mode)');
}

export default scraperWorker;
