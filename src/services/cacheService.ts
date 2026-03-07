import redis from '../config/redis';
import { config } from '../config/env';
import { Listing } from '../types/listing';

const PREFIX = 'df:search:';

/**
 * Build a deterministic cache key from a normalised query.
 */
function cacheKey(query: string): string {
    return `${PREFIX}${query.toLowerCase().trim()}`;
}

/**
 * Get cached listings for a query. Returns null on cache miss.
 */
export async function getCachedListings(query: string): Promise<Listing[] | null> {
    const raw = await redis.get(cacheKey(query));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as Listing[];
    } catch {
        return null;
    }
}

/**
 * Store listings in cache for the configured TTL.
 */
export async function setCachedListings(query: string, listings: Listing[]): Promise<void> {
    await redis.set(cacheKey(query), JSON.stringify(listings), 'EX', config.cacheTtlSeconds);
}

/**
 * Check whether a scraping job for this query is already in‑flight.
 */
export async function isJobInFlight(query: string): Promise<boolean> {
    const key = `${PREFIX}inflight:${query.toLowerCase().trim()}`;
    return (await redis.exists(key)) === 1;
}

/**
 * Mark a query as in‑flight (set a short TTL so it auto‑clears on crash).
 */
export async function markJobInFlight(query: string): Promise<void> {
    const key = `${PREFIX}inflight:${query.toLowerCase().trim()}`;
    await redis.set(key, '1', 'EX', 30); // 30 seconds max
}

/**
 * Clear the in‑flight marker for a query.
 */
export async function clearJobInFlight(query: string): Promise<void> {
    const key = `${PREFIX}inflight:${query.toLowerCase().trim()}`;
    await redis.del(key);
}
