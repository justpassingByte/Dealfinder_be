/**
 * Catalog Maintenance Jobs
 *
 * Background tasks that keep the product catalog healthy:
 * 1. Listing Reaper: marks stale listings inactive (24h)
 * 2. Variant Reaper: marks variants inactive if all listings are inactive
 * 3. Popularity Flush: syncs Redis search counts to PostgreSQL
 * 4. Top Product Refresh: triggers background scrapes for popular products
 *
 * Designed to run via node-cron or BullMQ repeatable jobs.
 */
import redis from '../config/redis';
import * as catalog from './catalogRepository';
import { catalogSearch } from './catalogSearchService';

// ── Popularity Flush ───────────────────────────────────
/**
 * Flush buffered search_count increments from Redis to PostgreSQL.
 * Scans keys matching df:search_count:* and aggregates them.
 */
export async function flushPopularityCounts(): Promise<number> {
    const pattern = 'df:search_count:*';
    const counts: { productId: string; count: number }[] = [];

    let cursor = '0';
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;

        for (const key of keys) {
            const rawCount = await redis.getdel(key);
            if (rawCount) {
                const productId = key.replace('df:search_count:', '');
                counts.push({ productId, count: parseInt(rawCount, 10) });
            }
        }
    } while (cursor !== '0');

    if (counts.length > 0) {
        await catalog.flushSearchCounts(counts);
        console.log(`[Maintenance] Flushed ${counts.length} popularity counts to DB.`);
    }

    return counts.length;
}

// ── Reaper Jobs ────────────────────────────────────────
/**
 * Full maintenance cycle (runs every 30 minutes).
 */
export async function runMaintenanceCycle(): Promise<void> {
    console.log('[Maintenance] Starting maintenance cycle...');

    // 1. Reap stale listings
    const reapedListings = await catalog.reapStaleListings();
    console.log(`[Maintenance] Marked ${reapedListings} listings as inactive.`);

    // 2. Reap stale variants
    const reapedVariants = await catalog.reapStaleVariants();
    console.log(`[Maintenance] Marked ${reapedVariants} variants as inactive.`);

    // 3. Flush popularity counts
    await flushPopularityCounts();

    // 4. Refresh top products (background scrape)
    await refreshTopProducts(20);

    console.log('[Maintenance] Maintenance cycle complete.');
}

// ── Top Product Refresh ────────────────────────────────
export async function refreshTopProducts(limit = 20): Promise<void> {
    console.log(`[Maintenance] Starting human-paced refresh for top ${limit} products...`);

    const topProducts = await catalog.getTopProducts(limit);
    let refreshed = 0;

    for (const product of topProducts) {
        // Only refresh if data is actually stale
        if (!catalog.isProductFresh(product)) {
            try {
                // Find the "best" listing URL to refresh directly (cheapest/most active)
                const data = await catalog.getVariantsWithListings(product.id);
                const bestListing = data.find(l => l.listing_id && l.listing_status === 'active');

                if (bestListing?.product_url) {
                    console.log(`[Maintenance] Refreshing via URL: ${product.normalized_name}`);
                    // Use the URL Mode for faster, stealthier updates
                    await catalogSearch(bestListing.product_url, 1, true, true);
                    refreshed++;
                } else {
                    // Fallback to name search if no URL exists
                    await catalogSearch(product.normalized_name, 30, true, true);
                    refreshed++;
                }

                // HUMAN DELAY: Wait 15-45 seconds between products to avoid detection
                const delay = 15000 + Math.random() * 30000;
                console.log(`[Maintenance] Sleeping for ${Math.round(delay/1000)}s to look human...`);
                await new Promise(r => setTimeout(r, delay));

            } catch (err) {
                console.error(`[Maintenance] Failed to refresh ${product.normalized_name}:`, err);
            }
        }
    }

    console.log(`[Maintenance] Cycle finished. Refreshed ${refreshed} products.`);
}
