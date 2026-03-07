import { Queue } from 'bullmq';
import { config } from './env';

export const scraperQueue = !config.redis.useMock
    ? new Queue('scraper', {
        connection: {
            host: config.redis.host,
            port: config.redis.port,
        },
        defaultJobOptions: {
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: 50,
        },
    })
    : null;
