/**
 * Catalog Search Service
 *
 * Orchestrates the full search flow:
 *   Redis Cache → DB (Signature Lookup → Similarity) → Scraper → Persist
 *
 * Implements scraper concurrency guard, freshness checks, and fallback logic.
 */
import redis from '../config/redis';
import { generateSignatures, SignatureResult } from './signatureService';
import * as catalog from './catalogRepository';
import { scrapeListings } from './scraperService';
import { Listing } from '../types/listing';
import { Product, ProductVariant, PersistedListing } from '../types/product';
import { compareListings } from './compareService';

// ── Constants ──────────────────────────────────────────
const CACHE_TTL_SECONDS = 600;       // 10 minutes
const SCRAPE_LOCK_TTL_SECONDS = 30;  // 30 seconds
const SIMILARITY_THRESHOLD = 0.3;    // pg_trgm minimum
const SIMILARITY_AUTO_CREATE = 0.6;  // Below this, create new product

// ── Cache Keys ─────────────────────────────────────────
const cacheKey = {
    search: (q: string) => `df:search:${q}`,
    product: (id: string) => `df:product:${id}`,
    variantListings: (vid: string) => `df:variant:${vid}:listings`,
    scrapeLock: (sig: string) => `df:scrape_lock:${sig}`,
    searchCount: (pid: string) => `df:search_count:${pid}`,
};

// ── Response Types ─────────────────────────────────────
export interface CatalogSearchResult {
    source: 'cache' | 'db' | 'scraper' | 'stale-fallback';
    product: Product | null;
    variants: {
        variant: ProductVariant;
        listings: PersistedListing[];
    }[];
    rawListings?: Listing[];  // Only set when serving from scraper directly
}

// ═══════════════════════════════════════════════════════
//  MAIN SEARCH FLOW
// ═══════════════════════════════════════════════════════

export async function catalogSearch(
    query: string, 
    maxItems = 60, 
    forceRefresh = false
): Promise<CatalogSearchResult> {
    const normalizedQuery = query.toLowerCase().trim();
    const signatures = generateSignatures(normalizedQuery);

    // Log the search query for real-time trends
    await catalog.logSearchQuery(normalizedQuery).catch(err => {
        console.error('[Catalog] Failed to log search query:', err);
    });

    // ── Step 0: Redis Cache ────────────────────────────
    if (forceRefresh) {
        console.log(`[Catalog] Force refresh requested for "${normalizedQuery}". Clearing cache...`);
        await redis.del(cacheKey.search(normalizedQuery));
    } else {
        const cachedRaw = await redis.get(cacheKey.search(normalizedQuery));
        if (cachedRaw) {
            try {
                const cached = JSON.parse(cachedRaw) as CatalogSearchResult;
                console.log(`[Catalog] Redis CACHE HIT for "${normalizedQuery}"`);
                
                // Buffer popularity increment even on cache hit!
                if (cached.product?.id) {
                    await redis.incr(cacheKey.searchCount(cached.product.id));
                }
                
                return { ...cached, source: 'cache' };
            } catch { /* ignore parse errors, proceed */ }
        }
    }

    // ── Step 1: Exact Signature Lookup ─────────────────
    let product = await catalog.findProductBySignature(signatures.productSignature);

    // ── Step 2: Fuzzy Similarity Fallback ──────────────
    if (!product) {
        const similar = await catalog.findProductsBySimilarity(
            normalizedQuery, SIMILARITY_THRESHOLD, 1
        );
        if (similar.length > 0 && similar[0].similarity_score >= SIMILARITY_AUTO_CREATE) {
            product = similar[0];
        }
    }

    // ── Fresh data? Return from DB ─────────────────────
    if (!forceRefresh && product && catalog.isProductFresh(product)) {
        console.log(`[Catalog] DATABASE HIT (fresh) for "${normalizedQuery}" [ID: ${product.id}]`);
        const result = await buildProductResponse(product, 'db');

        // Buffer popularity increment
        await redis.incr(cacheKey.searchCount(product.id));

        // Seed cache
        await redis.set(
            cacheKey.search(normalizedQuery),
            JSON.stringify(result),
            'EX', CACHE_TTL_SECONDS
        );

        return result;
    }

    // ── Step 3: Scraper (with concurrency guard) ───────
    const lockKey = cacheKey.scrapeLock(signatures.productSignature);
    const lockAcquired = await redis.set(lockKey, '1', 'EX', SCRAPE_LOCK_TTL_SECONDS, 'NX');

    if (!lockAcquired) {
        // Another scraper is running for this product; serve stale if available
        if (product) {
            console.log(`[Catalog] Lock active, serving stale for "${normalizedQuery}"`);
            return buildProductResponse(product, 'stale-fallback');
        }
        // No data at all, wait briefly
        await new Promise(r => setTimeout(r, 3000));
        const retryCache = await redis.get(cacheKey.search(normalizedQuery));
        if (retryCache) {
            return { ...JSON.parse(retryCache), source: 'cache' };
        }
    }

    try {
        console.log(`[Catalog] Scraping for "${normalizedQuery}"...`);
        let rawListings: Listing[] = [];

        try {
            rawListings = await scrapeListings(normalizedQuery, 'shopee', maxItems);
        } catch (err) {
            console.error(`[Catalog] Scraper EXCEPTION for "${normalizedQuery}":`, err);
            if (product) {
                console.log(`[Catalog] Serving stale data after scraper failure.`);
                return buildProductResponse(product, 'stale-fallback');
            }
            throw err;
        }

        if (rawListings.length === 0) {
            if (product) {
                console.warn(`[Catalog] Scraper returned 0 items; marking refresh-pending for "${normalizedQuery}"`);
                await catalog.markProductRefreshPending(product.id);
                return buildProductResponse(product, 'stale-fallback');
            }
            console.warn(`[Catalog] Scraper returned 0 items for new product "${normalizedQuery}". Not persisting.`);
            return {
                source: 'scraper',
                product: null,
                variants: [],
            };
        }

        // Persist scraped data into catalog
        const persistedProduct = await persistScrapedData(signatures, rawListings, product);
        const result = await buildProductResponse(persistedProduct, 'scraper');

        // Buffer popularity
        await redis.incr(cacheKey.searchCount(persistedProduct.id));

        // Seed cache
        await redis.set(
            cacheKey.search(normalizedQuery),
            JSON.stringify(result),
            'EX', CACHE_TTL_SECONDS
        );

        return result;
    } catch (err) {
        console.error(`[Catalog] Scraper failed for "${normalizedQuery}":`, err);

        // Safety fallback: serve stale data if available
        if (product) {
            await catalog.markProductRefreshPending(product.id);
            return buildProductResponse(product, 'stale-fallback');
        }

        return {
            source: 'scraper',
            product: null,
            variants: [],
        };
    } finally {
        // Release lock
        await redis.del(lockKey);
    }
}

// ═══════════════════════════════════════════════════════
//  PERSIST SCRAPED DATA
// ═══════════════════════════════════════════════════════

async function persistScrapedData(
    signatures: SignatureResult,
    rawListings: Listing[],
    existingProduct: Product | null
): Promise<Product> {
    // 1. Upsert product
    const product = existingProduct
        ? existingProduct
        : await catalog.createProduct({
            normalized_name: signatures.normalizedName,
            product_signature: signatures.productSignature,
            brand: signatures.brand,
            model: signatures.model,
        });

    // 2. Pre-calculate deal status using compareListings logic
    const comparison = compareListings(rawListings);
    const rankedMap = new Map<string, any>();
    if (comparison) {
        comparison.sellerList.forEach(r => {
            rankedMap.set(r.url, { isDeal: r.isDeal, discountPercent: r.discountPercent });
        });
    }

    // 3. Process each listing
    for (const raw of rawListings) {
        const listingSigs = generateSignatures(raw.title);
        const ranked = rankedMap.get(raw.url) || { isDeal: false, discountPercent: 0 };

        // Upsert variant
        const variant = await catalog.upsertVariant({
            product_id: product.id,
            variant_signature: listingSigs.variantSignature,
            storage: listingSigs.storage,
            color: listingSigs.color,
            normalized_variant_name: raw.title,
        });

        // Extract shop_id and item_id from URL
        const { shopId, itemId } = extractShopeeIds(raw.url);

        // Upsert listing
        const { listing, priceChanged } = await catalog.upsertListing({
            variant_id: variant.id,
            marketplace: raw.marketplace || 'shopee',
            shop_id: shopId,
            item_id: itemId,
            shop_name: raw.shop,
            price: raw.price,
            rating: raw.rating || null,
            sold: raw.sold || 0,
            product_url: raw.url,
            image_url: raw.image || null,
            is_deal: ranked.isDeal,
            discount_percent: ranked.discountPercent,
        });

        // Record price change
        if (priceChanged) {
            await catalog.recordPriceHistory(listing.id, listing.price);
        }
    }

    // 4. Mark product as freshly scraped (ONLY if we actually got items)
    if (rawListings.length > 0) {
        await catalog.markProductScraped(product.id);
    }

    return product;
}

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Calculate the median of a numeric array.
 */
function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build a grouped response: Product → Variants → Listings.
 * Includes deal intelligence (score, isDeal, medianPrice, lowestPrice).
 * Uses a single joined query to prevent N+1 overhead.
 */
async function buildProductResponse(
    product: Product,
    source: CatalogSearchResult['source']
): Promise<CatalogSearchResult> {
    const rawData = await catalog.getVariantsWithListings(product.id);

    // Grouping in memory
    const variantMap = new Map<string, any>();

    for (const row of rawData) {
        if (!variantMap.has(row.variant_id)) {
            variantMap.set(row.variant_id, {
                variant: {
                    id: row.variant_id,
                    product_id: product.id,
                    variant_signature: row.variant_signature,
                    storage: row.storage,
                    color: row.color,
                    normalized_variant_name: row.normalized_variant_name,
                    variant_status: row.variant_status,
                    last_seen_at: row.variant_last_seen_at,
                },
                listings: []
            });
        }

        if (row.listing_id) {
            variantMap.get(row.variant_id).listings.push({
                id: row.listing_id,
                variant_id: row.variant_id,
                marketplace: row.marketplace,
                shop_id: row.shop_id,
                item_id: row.item_id,
                shop_name: row.shop_name,
                price: Number(row.price),
                rating: row.rating ? Number(row.rating) : null,
                sold: Number(row.sold),
                product_url: row.product_url,
                image_url: row.image_url,
                listing_status: row.listing_status,
                updated_at: row.listing_updated_at,
            });
        }
    }

    // ── Deal Intelligence: compute per-variant scoring ──
    const variants = Array.from(variantMap.values());
    for (const group of variants) {
        const listings = group.listings as any[];
        if (listings.length === 0) continue;

        const prices = listings.map((l: any) => l.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const maxSold = Math.max(...listings.map((l: any) => l.sold));
        const medianPrice = calculateMedian(prices);
        const lowestPrice = minPrice;
        const count = listings.length;

        for (const listing of listings) {
            // Log-based scoring
            const normPrice = maxPrice === minPrice ? 1 : (maxPrice - listing.price) / (maxPrice - minPrice);
            const normRating = listing.rating ? listing.rating / 5 : 0.5;
            const normSales = maxSold === 0 ? 0 : Math.log(listing.sold + 1) / Math.log(maxSold + 1);
            listing.score = parseFloat((0.6 * normPrice + 0.2 * normRating + 0.2 * normSales).toFixed(4));

            // Deal detection
            listing.isDeal = count >= 4 && listing.price < medianPrice * 0.85;
            listing.discountPercent = listing.isDeal
                ? Math.round(((medianPrice - listing.price) / medianPrice) * 100)
                : 0;
            listing.medianPrice = medianPrice;
            listing.lowestPrice = lowestPrice;
        }
    }

    return {
        source,
        product,
        variants,
    };
}

/**
 * Extract shop_id and item_id from a Shopee URL.
 * Shopee URLs typically: shopee.vn/product/{shopId}/{itemId}
 * Or: shopee.vn/{title}-i.{shopId}.{itemId}
 */
function extractShopeeIds(url: string): { shopId: string; itemId: string } {
    // Pattern 1: /product/{shopId}/{itemId}
    const productPattern = /\/product\/(\d+)\/(\d+)/;
    const match1 = url.match(productPattern);
    if (match1) {
        return { shopId: match1[1], itemId: match1[2] };
    }

    // Pattern 2: -i.{shopId}.{itemId}
    const iPattern = /i\.(\d+)\.(\d+)/;
    const match2 = url.match(iPattern);
    if (match2) {
        return { shopId: match2[1], itemId: match2[2] };
    }

    // Fallback: hash the URL as a unique identifier
    const hash = simpleHash(url);
    return { shopId: 'unknown', itemId: hash };
}

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
