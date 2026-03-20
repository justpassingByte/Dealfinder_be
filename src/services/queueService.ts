import { Queue, Worker, Job } from 'bullmq';
import redis from '../config/redis';
import { config } from '../config/env';
import { runMaintenanceCycle, flushPopularityCounts } from './catalogMaintenance';

// ── Queue Definitions ──────────────────────────────────
/**
 * Catalog queue manages maintenance tasks and background refreshes.
 * Only created when using real Redis (BullMQ doesn't support ioredis-mock).
 */
export const catalogQueue = !config.redis.useMock
    ? new Queue('catalog-maintenance', {
        connection: redis as any,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
            removeOnComplete: true,
            removeOnFail: 1000,
        }
    })
    : null;

// ── Worker Definition ───────────────────────────────────
export const catalogWorker = !config.redis.useMock
    ? new Worker('catalog-maintenance', async (job: Job) => {
        console.log(`[Worker] Running job: ${job.name} (id: ${job.id})`);

        switch (job.name) {
            case 'maintenance-cycle':
                await runMaintenanceCycle();
                break;
            case 'popularity-flush':
                await flushPopularityCounts();
                break;
            default:
                console.warn(`[Worker] Unknown job name: ${job.name}`);
        }
    }, { connection: redis as any })
    : null;

if (catalogWorker) {
    catalogWorker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.name} completed.`);
    });

    catalogWorker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.name} failed:`, err);
    });
}

// ── Scheduler Setup ─────────────────────────────────────
/**
 * Setup repeatable jobs in the queue.
 * Skipped when using Redis mock (uses setInterval fallback instead).
 */
export async function setupRepeatableJobs() {
    if (!catalogQueue) {
        console.log('[Queue] Mock mode: using setInterval for maintenance tasks.');
        // Fallback: use setInterval for maintenance in mock mode
        setInterval(async () => {
            try { await flushPopularityCounts(); } catch (e) { console.error('[Mock Queue] popularity flush error:', e); }
        }, 5 * 60 * 1000); // every 5 min

        setInterval(async () => {
            try { await runMaintenanceCycle(); } catch (e) { console.error('[Mock Queue] maintenance error:', e); }
        }, 30 * 60 * 1000); // every 30 min
        return;
    }

    // 1. Only add if not already present (BullMQ handles this by pattern/name)
    // We remove the explicit clean here because it causes the job to trigger immediately on restart
    // if the scheduler thinks it's a "new" job.

    // 2. Add popularity flush (every 5 minutes)
    await catalogQueue.add('popularity-flush', {}, {
        repeat: { pattern: '*/5 * * * *' },
        jobId: 'repeat:popularity-flush' // Stable ID to prevent duplicates
    });

    // 3. Add maintenance cycle (every 30 minutes)
    await catalogQueue.add('maintenance-cycle', {}, {
        repeat: { pattern: '0,30 * * * *' },
        jobId: 'repeat:maintenance-cycle' // Stable ID to prevent duplicates
    });

    console.log('[Queue] Repeatable jobs scheduled (BullMQ).');
}
