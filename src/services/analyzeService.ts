/**
 * Marketplace identifier patterns.
 * Each entry maps a regex to a marketplace name and a product‑ID capture group.
 */

export type Marketplace = 'shopee' | 'lazada' | 'tiktok';

interface MarketplacePattern {
    marketplace: Marketplace;
    /** Regex that matches a product URL. Group 1 should capture the product ID when possible. */
    pattern: RegExp;
}

const PATTERNS: MarketplacePattern[] = [
    {
        marketplace: 'shopee',
        // Matches shopee.vn, shopee.co.th, shopee.com.my, etc.
        // Product URL formats:
        //   https://shopee.vn/product-name-i.{shopId}.{itemId}
        //   https://shopee.vn/product/shopId/itemId
        pattern: /shopee\.\w+(?:\.\w+)?\/.*?(?:i\.(\d+\.\d+)|product\/(\d+\/\d+))/i,
    },
    {
        marketplace: 'lazada',
        // Matches lazada.vn, lazada.co.th, lazada.com.my, etc.
        // Product URL formats:
        //   https://www.lazada.vn/products/product-name-i{itemId}.html
        //   https://www.lazada.vn/products/product-name-i{itemId}-s{skuId}.html
        pattern: /lazada\.\w+(?:\.\w+)?\/products\/.*-i(\d+)/i,
    },
    {
        marketplace: 'tiktok',
        // Matches tiktok shop links such as:
        //   https://www.tiktok.com/view/product/{productId}
        //   https://shop.tiktok.com/view/product/{productId}
        //   https://vt.tiktok.com/xxxx (short link — treated as TikTok without ID extraction)
        pattern: /tiktok\.com\/.*?product\/(\d+)/i,
    },
];

export interface AnalysisResult {
    title: string;
    marketplace: Marketplace;
    productId: string | null;
    query: string;
}

/**
 * Detect the marketplace from a raw URL.
 */
export function detectMarketplace(url: string): { marketplace: Marketplace; productId: string | null } | null {
    for (const { marketplace, pattern } of PATTERNS) {
        const match = url.match(pattern);
        if (match) {
            // Use the first non-undefined capture group as the product ID.
            const productId = match.slice(1).find((g) => g !== undefined) ?? null;
            return { marketplace, productId };
        }
    }
    return null;
}

/**
 * Build a normalised search query from a product title.
 * - Lowercases
 * - Strips common filler words and special characters
 * - Trims to max 120 chars
 */
export function normalizeQuery(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s\u00C0-\u024F\u1E00-\u1EFF\u3000-\u9FFF\uAC00-\uD7AF]/g, ' ') // keep alphanumeric + accented + CJK
        .replace(/\b(official|store|shop|sale|flash|deal|hot|new|free shipping)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

/**
 * Extract a rough product title from a marketplace URL path segment.
 * This is a fast, zero-network heuristic used before any scraping.
 */
export function extractTitleFromUrl(url: string): string {
    try {
        const { pathname } = new URL(url);
        // Take the last meaningful path segment, strip IDs and extensions.
        const segments = pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1] || '';
        return last
            .replace(/[-_]/g, ' ')
            .replace(/\.[^.]+$/, '')        // remove .html etc.
            .replace(/i\d[\d.]*/g, '')      // remove trailing product IDs (Shopee / Lazada)
            .replace(/s\d+/g, '')           // remove sku IDs
            .replace(/\s+/g, ' ')
            .trim();
    } catch {
        return '';
    }
}
