/**
 * Product Catalog Repository
 *
 * Database operations for products, variants, listings, and price history.
 * Implements the upsert, freshness, and lifecycle logic from the design.
 */
import { db } from '../config/db';
import {
    Product,
    ProductVariant,
    PersistedListing,
    PriceHistoryEntry,
    FRESHNESS_TIERS,
    MAX_STALENESS_MINUTES,
} from '../types/product';

// ═══════════════════════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════════════════════

/**
 * Find a product by its exact deterministic signature.
 * This is Step 1 of the search pipeline.
 */
export async function findProductBySignature(signature: string): Promise<Product | null> {
    const { rows } = await db.query(
        `SELECT * FROM products WHERE product_signature = $1 LIMIT 1`,
        [signature]
    );
    return rows[0] || null;
}

/**
 * Fuzzy-search products using pg_trgm similarity.
 * This is Step 2 of the search pipeline.
 */
export async function findProductsBySimilarity(
    query: string,
    threshold = 0.3,
    limit = 5
): Promise<(Product & { similarity_score: number })[]> {
    const { rows } = await db.query(
        `SELECT *, similarity(normalized_name, $1) AS similarity_score
         FROM products
         WHERE similarity(normalized_name, $1) >= $2
         ORDER BY similarity_score DESC
         LIMIT $3`,
        [query, threshold, limit]
    );
    return rows;
}

/**
 * Autocomplete prefix / similarity search.
 */
export async function findProductsForAutocomplete(
    query: string,
    limit = 5
): Promise<string[]> {
    const { rows } = await db.query(
        `SELECT DISTINCT normalized_name, 
                CASE WHEN normalized_name ILIKE $1 THEN 1 ELSE 0 END as is_prefix,
                similarity(normalized_name, $2) as sim_score
         FROM products 
         WHERE normalized_name ILIKE $1 
            OR similarity(normalized_name, $2) >= 0.15
         ORDER BY is_prefix DESC, sim_score DESC
         LIMIT $3`,
        [`${query}%`, query, limit]
    );
    return rows.map(r => r.normalized_name);
}

/**
 * Create a new product (Auto-Discovery = Step 3).
 */
export async function createProduct(data: {
    normalized_name: string;
    product_signature: string;
    brand: string | null;
    model: string | null;
}): Promise<Product> {
    const { rows } = await db.query(
        `INSERT INTO products (normalized_name, product_signature, brand, model)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_signature) DO UPDATE SET
             search_count = products.search_count + 1,
             last_searched_at = NOW()
         RETURNING *`,
        [data.normalized_name, data.product_signature, data.brand, data.model]
    );
    return rows[0];
}

/**
 * Mark a product's data as freshly scraped.
 */
export async function markProductScraped(productId: string): Promise<void> {
    await db.query(
        `UPDATE products SET last_scraped_at = NOW(), refresh_pending = FALSE WHERE id = $1`,
        [productId]
    );
}

/**
 * Flag a product for background refresh (scraper failure).
 */
export async function markProductRefreshPending(productId: string): Promise<void> {
    await db.query(
        `UPDATE products SET refresh_pending = TRUE WHERE id = $1`,
        [productId]
    );
}

/**
 * Get top N most-searched products for background refresh.
 */
export async function getTopProducts(limit = 20): Promise<Product[]> {
    const { rows } = await db.query(
        `SELECT * FROM products ORDER BY search_count DESC LIMIT $1`,
        [limit]
    );
    return rows;
}

/**
 * Determine if a product's data is still fresh based on dynamic TTL.
 */
export function isProductFresh(product: Product): boolean {
    const age = (Date.now() - new Date(product.last_scraped_at).getTime()) / (1000 * 60);

    // Hard limit: never serve data older than 24 hours
    if (age >= MAX_STALENESS_MINUTES) return false;

    // Dynamic tier
    for (const tier of FRESHNESS_TIERS) {
        if (product.search_count >= tier.minSearchCount &&
            product.search_count <= tier.maxSearchCount) {
            return age < tier.ttlMinutes;
        }
    }

    return false;
}

/**
 * Bulk flush search counts from Redis to PostgreSQL.
 */
export async function flushSearchCounts(
    counts: { productId: string; count: number }[]
): Promise<void> {
    if (counts.length === 0) return;

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        for (const { productId, count } of counts) {
            await client.query(
                `UPDATE products SET
                    search_count = search_count + $1,
                    last_searched_at = NOW()
                 WHERE id = $2`,
                [count, productId]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ═══════════════════════════════════════════════════════
//  PRODUCT VARIANTS
// ═══════════════════════════════════════════════════════

/**
 * Find a variant by product + variant_signature.
 */
export async function findVariant(
    productId: string,
    variantSignature: string
): Promise<ProductVariant | null> {
    const { rows } = await db.query(
        `SELECT * FROM product_variants
         WHERE product_id = $1 AND variant_signature = $2
         LIMIT 1`,
        [productId, variantSignature]
    );
    return rows[0] || null;
}

/**
 * Get all active variants for a product.
 */
export async function getActiveVariants(productId: string): Promise<ProductVariant[]> {
    const { rows } = await db.query(
        `SELECT * FROM product_variants
         WHERE product_id = $1 AND variant_status = 'active'
         ORDER BY created_at`,
        [productId]
    );
    return rows;
}

/**
 * Upsert a variant (create or touch last_seen_at).
 */
export async function upsertVariant(data: {
    product_id: string;
    variant_signature: string;
    storage: string | null;
    color: string | null;
    normalized_variant_name: string | null;
}): Promise<ProductVariant> {
    const { rows } = await db.query(
        `INSERT INTO product_variants
            (product_id, variant_signature, storage, color, normalized_variant_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id, variant_signature) DO UPDATE SET
             variant_status = 'active',
             last_seen_at = NOW()
         RETURNING *`,
        [data.product_id, data.variant_signature, data.storage, data.color, data.normalized_variant_name]
    );
    return rows[0];
}

/**
 * Fetch all variants and their active listings in a single joined query.
 * Prevents N+1 problems by reducing multiple DB round-trips.
 */
export async function getVariantsWithListings(productId: string): Promise<any[]> {
    const { rows } = await db.query(
        `SELECT
            v.id AS variant_id,
            v.storage,
            v.color,
            v.variant_signature,
            v.normalized_variant_name,
            v.variant_status,
            v.last_seen_at AS variant_last_seen_at,
            l.id AS listing_id,
            l.marketplace,
            l.shop_id,
            l.item_id,
            l.shop_name,
            l.price,
            l.rating,
            l.sold,
            l.product_url,
            l.image_url,
            l.listing_status,
            l.updated_at AS listing_updated_at
         FROM product_variants v
         LEFT JOIN listings l ON l.variant_id = v.id AND l.listing_status = 'active'
         WHERE v.product_id = $1 AND v.variant_status = 'active'
         ORDER BY v.id, l.price ASC`,
        [productId]
    );
    return rows;
}

// ═══════════════════════════════════════════════════════
//  LISTINGS
// ═══════════════════════════════════════════════════════

/**
 * Get all active listings for a variant, sorted by price.
 */
export async function getActiveListings(variantId: string): Promise<PersistedListing[]> {
    const { rows } = await db.query(
        `SELECT * FROM listings
         WHERE variant_id = $1 AND listing_status = 'active'
         ORDER BY price ASC`,
        [variantId]
    );
    return rows;
}

/**
 * Upsert a listing. Returns the listing and whether the price changed.
 */
export async function upsertListing(data: {
    variant_id: string;
    marketplace: string;
    shop_id: string;
    item_id: string;
    shop_name: string;
    price: number;
    rating: number | null;
    sold: number;
    product_url: string;
    image_url: string | null;
    is_deal: boolean;
    discount_percent: number;
}): Promise<{ listing: PersistedListing; priceChanged: boolean }> {
    // First check existing price
    const existing = await db.query(
        `SELECT id, price FROM listings
         WHERE marketplace = $1 AND shop_id = $2 AND item_id = $3`,
        [data.marketplace, data.shop_id, data.item_id]
    );

    const oldPrice = existing.rows[0]?.price
        ? parseFloat(existing.rows[0].price)
        : null;

    const { rows } = await db.query(
        `INSERT INTO listings
            (variant_id, marketplace, shop_id, item_id, shop_name,
             price, rating, sold, product_url, image_url, is_deal, discount_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (marketplace, shop_id, item_id) DO UPDATE SET
             price = EXCLUDED.price,
             rating = EXCLUDED.rating,
             sold = EXCLUDED.sold,
             is_deal = EXCLUDED.is_deal,
             discount_percent = EXCLUDED.discount_percent,
             last_seen_at = NOW(),
             updated_at = NOW(),
             listing_status = 'active'
         RETURNING *`,
        [
            data.variant_id, data.marketplace, data.shop_id, data.item_id,
            data.shop_name, data.price, data.rating, data.sold,
            data.product_url, data.image_url, data.is_deal, data.discount_percent,
        ]
    );

    const listing = rows[0];
    const priceChanged = oldPrice !== null && oldPrice !== data.price;

    return { listing, priceChanged };
}

// ═══════════════════════════════════════════════════════
//  PRICE HISTORY
// ═══════════════════════════════════════════════════════

/**
 * Record a price change for a listing.
 * Only call this when priceChanged === true.
 */
export async function recordPriceHistory(
    listingId: string,
    price: number
): Promise<PriceHistoryEntry> {
    const { rows } = await db.query(
        `INSERT INTO price_history (listing_id, price) VALUES ($1, $2) RETURNING *`,
        [listingId, price]
    );
    return rows[0];
}

/**
 * Get price history for a listing (chronological order, last N entries).
 */
export async function getPriceHistory(
    listingId: string,
    limit = 60
): Promise<PriceHistoryEntry[]> {
    const { rows } = await db.query(
        `SELECT price, recorded_at
         FROM price_history
         WHERE listing_id = $1
         ORDER BY recorded_at DESC
         LIMIT $2`,
        [listingId, limit]
    );
    // Reverse to return in chronological order
    return rows.reverse();
}

// ═══════════════════════════════════════════════════════
//  LIFECYCLE MAINTENANCE
// ═══════════════════════════════════════════════════════

/**
 * Mark listings as inactive if they haven't been seen in 24 hours.
 */
export async function reapStaleListings(): Promise<number> {
    const { rowCount } = await db.query(
        `UPDATE listings SET listing_status = 'inactive'
         WHERE listing_status = 'active'
           AND last_seen_at < NOW() - INTERVAL '24 hours'`
    );
    return rowCount ?? 0;
}

/**
 * Mark variants as inactive if all their listings are inactive.
 */
export async function reapStaleVariants(): Promise<number> {
    const { rowCount } = await db.query(
        `UPDATE product_variants SET variant_status = 'inactive'
         WHERE variant_status = 'active'
           AND id NOT IN (
               SELECT DISTINCT variant_id FROM listings WHERE listing_status = 'active'
           )
           AND last_seen_at < NOW() - INTERVAL '24 hours'`
    );
    return rowCount ?? 0;
}
// ═══════════════════════════════════════════════════════
//  CLICK TRACKING & ANALYTICS
// ═══════════════════════════════════════════════════════

/**
 * Log a click event for a listing.
 */
export async function logClickEvent(data: {
    listingId: string;
    ip?: string;
    ua?: string;
}): Promise<void> {
    await db.query(
        `INSERT INTO click_events (listing_id, ip_address, user_agent)
         VALUES ($1, $2, $3)`,
        [data.listingId, data.ip, data.ua]
    );
}

/**
 * Get a single listing by ID.
 */
export async function getListingById(listingId: string): Promise<PersistedListing | null> {
    const { rows } = await db.query(
        `SELECT * FROM listings WHERE id = $1 LIMIT 1`,
        [listingId]
    );
    return rows[0] || null;
}

/**
 * Fetch the best currently detected deals from the catalog.
 */
export async function getHotDeals(limit = 12): Promise<any[]> {
    const { rows } = await db.query(
        `SELECT
            l.id as "listingId",
            l.item_id as "itemId",
            l.price,
            l.rating,
            l.sold,
            l.shop_name as "shopName",
            l.image_url as "imageUrl",
            l.discount_percent as "discountPercent",
            l.marketplace,
            v.storage,
            v.color,
            v.normalized_variant_name as "productName"
         FROM listings l
         JOIN product_variants v ON v.id = l.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE l.listing_status = 'active'
           AND l.is_deal = true
         ORDER BY l.discount_percent DESC
         LIMIT $1`,
        [limit]
    );
    return rows.map(r => ({
        ...r,
        price: Number(r.price),
        rating: Number(r.rating || 0),
        sold: Number(r.sold || 0),
        discountPercent: Number(r.discountPercent || 0)
    }));
}
// ═══════════════════════════════════════════════════════
//  SEARCH LOGGING & TRENDS
// ═══════════════════════════════════════════════════════

/**
 * Log a literal search query.
 */
export async function logSearchQuery(query: string): Promise<void> {
    if (!query || query.length < 2) return;
    await db.query(
        `INSERT INTO search_logs (query) VALUES ($1)`,
        [query.toLowerCase().trim()]
    );
}

/**
 * Get top trending queries from the last 7 days.
 */
export async function getTrendingQueries(limit = 10): Promise<string[]> {
    const { rows } = await db.query(
        `SELECT query, COUNT(*) as count 
         FROM search_logs 
         WHERE created_at > NOW() - INTERVAL '7 days'
         GROUP BY query 
         ORDER BY count DESC 
         LIMIT $1`,
        [limit]
    );
    return rows.map(r => r.query);
}
