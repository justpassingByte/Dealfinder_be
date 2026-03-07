import Redis from 'ioredis';
import { config } from './env';

let redis: Redis;

if (config.redis.useMock) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MockRedis = require('ioredis-mock');
    redis = new MockRedis() as Redis;
    console.log('[Redis] Using memory mock (ioredis-mock)');
} else {
    redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        maxRetriesPerRequest: null, // Required by BullMQ
    });

    redis.on('error', (err: Error) => {
        console.error('[Redis] Connection error:', err.message);
    });

    redis.on('connect', () => {
        console.log('[Redis] Connected to Redis at', config.redis.host);
    });
}

export default redis;
