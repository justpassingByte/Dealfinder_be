import { Router, Request, Response } from 'express';
import { scraperQueue } from '../config/queue';
import { QueueEvents } from 'bullmq';
import { config } from '../config/env';
import {
    getCachedListings,
    isJobInFlight,
    markJobInFlight,
    clearJobInFlight,
    setCachedListings,
} from '../services/cacheService';
import { scrapeListings } from '../services/scraperService';
import { compareListings } from '../services/compareService';
import { detectDeals, DealAlert } from '../services/aiService';
import { catalogSearch } from '../services/catalogSearchService';
import { Listing } from '../types/listing';

const router = Router();

type SearchSource = 'cache' | 'mock-scraper' | 'scraper';

interface SearchSuccess {
    ok: true;
    source: SearchSource;
    listings: Listing[];
}

interface SearchFailure {
    ok: false;
    status: number;
    payload: { error?: string; message?: string };
}

type SearchResult = SearchSuccess | SearchFailure;

// Only initialize QueueEvents if not in mock mode
const queueEvents = !config.redis.useMock
    ? new QueueEvents('scraper', {
        connection: {
            host: config.redis.host,
            port: config.redis.port,
        },
    })
    : null;

function parseLimit(rawLimit: string | undefined, fallback = 10): number {
    if (!rawLimit) return fallback;
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, 1), 50);
}

function buildListingKey(listing: Pick<Listing, 'url' | 'title' | 'price'>): string {
    return `${listing.url}|${listing.title}|${listing.price}`;
}

async function fetchListingsForQuery(query: string, maxItems = 60): Promise<SearchResult> {
    // 1. Check Redis cache first (ioredis-mock works here)
    const cached = await getCachedListings(query);
    if (cached) {
        console.log(`[Search] Cache hit for "${query}" with ${cached.length} results`);
        return { ok: true, source: 'cache', listings: cached };
    }
    console.log(`[Search] Cache miss for "${query}". Proceeding to scrape...`);

    // 2. Handle Mock Mode (Redis-free)
    if (config.redis.useMock) {
        console.log(`[Search] Mock Mode: Scraping directly for "${query}"`);
        try {
            const listings = await scrapeListings(query, 'shopee', maxItems);
            if (listings.length > 0) {
                await setCachedListings(query, listings);
            }
            console.log(`[Search] Mock-scraper returned ${listings.length} results for "${query}"`);
            return { ok: true, source: 'mock-scraper', listings };
        } catch (err: unknown) {
            console.error('[Search] Mock scraping failed:', err);
            return { ok: false, status: 500, payload: { error: 'Scraping failed during mock mode.' } };
        }
    }

    // 3. Normal Flow (BullMQ + Redis)
    const inFlight = await isJobInFlight(query);
    if (inFlight) {
        return {
            ok: false,
            status: 202,
            payload: { message: 'Search in progress, please retry in a few seconds.' },
        };
    }

    if (!scraperQueue || !queueEvents) {
        return { ok: false, status: 500, payload: { error: 'Scraper queue initialization failed.' } };
    }

    await markJobInFlight(query);
    try {
        const job = await scraperQueue.add('search', { query, marketplace: 'shopee', maxItems });
        const result = await job.waitUntilFinished(queueEvents, 10_000);
        const payload = result as { listings?: Listing[] } | undefined;
        return { ok: true, source: 'scraper', listings: payload?.listings ?? [] };
    } catch (err: unknown) {
        console.error('[Search] Queue job failed:', err);
        await clearJobInFlight(query);
        return { ok: false, status: 504, payload: { error: 'Scraper timed out or failed. Please try again.' } };
    }
}

router.get('/search', async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined)?.trim();
    const maxItemsParam = req.query.maxItems as string | undefined;
    const maxItems = maxItemsParam ? parseInt(maxItemsParam, 10) : 80;

    if (!q) {
        console.warn('[Search] Rejecting request: missing query parameter "q"');
        res.status(400).json({ error: 'Missing query parameter "q".' });
        return;
    }

    console.log(`[Search] New request for query: "${q}" (maxItems=${maxItems})`);

    // Special logic for Mock Mode to support 202 Polling
    if (config.redis.useMock) {
        const cached = await getCachedListings(q);
        if (cached) {
            res.json({ source: 'cache', listings: cached });
            return;
        }

        const inFlight = await isJobInFlight(q);
        if (inFlight) {
            res.status(202).json({ message: 'Search in progress...' });
            return;
        }

        // Run non-blocking so we can return 202
        markJobInFlight(q);
        scrapeListings(q, 'shopee', maxItems)
            .then(async (listings) => {
                if (listings.length > 0) {
                    await setCachedListings(q, listings);
                }
                await clearJobInFlight(q);
                console.log(`[Search] Mock-scraper background job finished for "${q}"`);
            })
            .catch(async (err) => {
                console.error('[Search] Mock-scraper background job failed:', err);
                await clearJobInFlight(q);
            });

        res.status(202).json({ message: 'Search started, please poll again in 5-10 seconds.' });
        return;
    }

    const result = await fetchListingsForQuery(q, maxItems);

    if (!result.ok) {
        res.status(result.status).json(result.payload);
        return;
    }

    res.json({ source: result.source, listings: result.listings });
});

router.get('/shopee/best-deals', async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined)?.trim();

    if (!q) {
        res.status(400).json({ error: 'Missing query parameter "q".' });
        return;
    }

    const limit = parseLimit(req.query.limit as string | undefined, 10);
    console.log(`[Deals] One-click best deals request for query: "${q}" (limit=${limit})`);

    const maxItems = Math.max(limit, 60);
    const result = await fetchListingsForQuery(q, maxItems);
    if (!result.ok) {
        res.status(result.status).json(result.payload);
        return;
    }

    if (result.listings.length === 0) {
        res.json({
            source: result.source,
            query: q,
            totalListings: 0,
            bestDeal: null,
            deals: [],
            priceInsights: {
                meanPrice: 0,
                stdDev: 0,
                greatDealCount: 0,
            },
        });
        return;
    }

    const comparison = compareListings(result.listings);
    if (!comparison) {
        res.status(500).json({ error: 'Could not rank listings.' });
        return;
    }

    const dealDetection = detectDeals(result.listings);
    const alertsByKey = new Map<string, DealAlert>();

    for (const alert of dealDetection.alerts) {
        alertsByKey.set(buildListingKey(alert.listing), alert);
    }

    const deals = comparison.sellerList
        .map((listing) => {
            const alert = alertsByKey.get(buildListingKey(listing));
            return {
                ...listing,
                anomalyType: alert?.anomalyType ?? 'normal',
                savingsPercent: alert?.savingsPercent ?? 0,
                priceZScore: alert?.priceZScore ?? 0,
            };
        })
        .slice(0, limit);

    const greatDealCount = dealDetection.alerts.filter((alert) => alert.anomalyType === 'great_deal').length;

    res.json({
        source: result.source,
        query: q,
        totalListings: comparison.sellerList.length,
        bestDeal: deals[0] ?? null,
        deals,
        priceInsights: {
            meanPrice: dealDetection.meanPrice,
            stdDev: dealDetection.stdDev,
            greatDealCount,
        },
    });
});

// ═══════════════════════════════════════════════════════
//  URL DETECTION HELPER
// ═══════════════════════════════════════════════════════
const MARKETPLACE_URL_REGEX = /^https?:\/\/(www\.)?(shopee\.(vn|co\.id|com\.my|ph|sg|co\.th|com\.br)|lazada\.(vn|co\.id|com\.my|com\.ph|sg|co\.th))\//i;

function isMarketplaceUrl(input: string): boolean {
    return MARKETPLACE_URL_REGEX.test(input.trim());
}

/**
 * Extract a product title from a marketplace URL path.
 * e.g. "https://shopee.vn/Dien-thoai-iPhone-15-Pro-Max-i.123.456" → "Dien thoai iPhone 15 Pro Max"
 */
function extractTitleFromUrl(url: string): string {
    try {
        const parsed = new URL(url.trim());
        let pathPart = parsed.pathname.split('/').filter(Boolean).pop() || '';
        // Remove Shopee's "-i.shopId.itemId" suffix
        pathPart = pathPart.replace(/-i\.\d+\.\d+$/, '');
        // Replace hyphens with spaces and clean up
        return pathPart.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    } catch {
        return url;
    }
}

// ═══════════════════════════════════════════════════════
//  CATALOG-POWERED SEARCH (New Pipeline)
// ═══════════════════════════════════════════════════════
router.get('/search/catalog', async (req: Request, res: Response) => {
    let q = (req.query.q as string | undefined)?.trim();
    if (!q) {
        res.status(400).json({ error: 'Missing query parameter "q".' });
        return;
    }

    // ── URL Detection: if user pastes a marketplace URL, extract the title ──
    if (isMarketplaceUrl(q)) {
        console.log(`[Catalog Search] Detected marketplace URL, extracting title...`);
        q = extractTitleFromUrl(q);
        console.log(`[Catalog Search] Extracted query: "${q}"`);
    }

    const maxItems = parseInt(req.query.maxItems as string || '60', 10);
    console.log(`[Catalog Search] Query: "${q}" (maxItems=${maxItems})`);

    try {
        const result = await catalogSearch(q, maxItems);

        // Flatten variants+listings into a unified response with deal intelligence
        interface FlatListing extends Listing {
            listingId?: string;
            isDeal?: boolean;
            discountPercent?: number;
            medianPrice?: number;
            lowestPrice?: number;
        }

        const flatListings: FlatListing[] = [];
        for (const group of result.variants) {
            for (const listing of group.listings) {
                const l = listing as any;
                flatListings.push({
                    title: group.variant.normalized_variant_name || '',
                    price: parseFloat(l.price as unknown as string),
                    rating: l.rating ? parseFloat(l.rating as unknown as string) : 0,
                    sold: l.sold,
                    shop: l.shop_name,
                    url: l.product_url,
                    image: l.image_url || '',
                    marketplace: l.marketplace,
                    // Deal intelligence fields
                    listingId: l.id,
                    score: l.score ?? undefined,
                    isDeal: l.isDeal ?? false,
                    discountPercent: l.discountPercent ?? 0,
                    medianPrice: l.medianPrice ?? undefined,
                    lowestPrice: l.lowestPrice ?? undefined,
                });
            }
        }

        res.json({
            source: result.source,
            product: result.product ? {
                id: result.product.id,
                name: result.product.normalized_name,
                signature: result.product.product_signature,
                brand: result.product.brand,
                searchCount: result.product.search_count,
                lastScraped: result.product.last_scraped_at,
            } : null,
            variantCount: result.variants.length,
            totalListings: flatListings.length,
            listings: flatListings.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
        });
    } catch (err) {
        console.error('[Catalog Search] Error:', err);
        res.status(500).json({ error: 'Catalog search failed.' });
    }
});

export default router;
