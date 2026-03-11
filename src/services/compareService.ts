import { Listing } from '../types/listing';

export interface RankedListing extends Listing {
    score: number;
    isDeal: boolean;
    discountPercent: number;
    medianPrice: number;
    lowestPrice: number;
}

export interface ComparisonResult {
    bestDeal: RankedListing;
    sellerList: RankedListing[];
}

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
 * Price comparison engine (v2 — Log-based normalization + Deal Detection).
 *
 * Scoring formula:
 *   normPrice  = maxPrice === minPrice ? 1 : (maxPrice - price) / (maxPrice - minPrice)
 *   normRating = rating ? rating / 5 : 0.5
 *   normSales  = maxSold === 0 ? 0 : Math.log(sold + 1) / Math.log(maxSold + 1)
 *   score      = 0.6 * normPrice + 0.2 * normRating + 0.2 * normSales
 *
 * Deal detection:
 *   isDeal = (listingsCount >= 4) && (price < medianPrice * 0.85)
 *   discountPercent = Math.round((medianPrice - price) / medianPrice * 100)
 */
export function compareListings(listings: Listing[]): ComparisonResult | null {
    if (!listings || listings.length === 0) return null;

    const prices = listings.map((l) => l.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const maxSold = Math.max(...listings.map((l) => l.sold));
    const medianPrice = calculateMedian(prices);
    const lowestPrice = minPrice;
    const listingsCount = listings.length;

    const ranked: RankedListing[] = listings.map((listing) => {
        // Normalized price (higher = cheaper relative to others)
        const normPrice = maxPrice === minPrice
            ? 1
            : (maxPrice - listing.price) / (maxPrice - minPrice);

        // Normalized rating (0–1, default to 0.5 if no rating)
        const normRating = listing.rating ? listing.rating / 5 : 0.5;

        // Log-based sales normalization (handles skewed distributions)
        const normSales = maxSold === 0
            ? 0
            : Math.log(listing.sold + 1) / Math.log(maxSold + 1);

        const score = parseFloat(
            (0.6 * normPrice + 0.2 * normRating + 0.2 * normSales).toFixed(4)
        );

        // Deal detection — only flag if we have enough market data
        const isDeal = listingsCount >= 4 && listing.price < medianPrice * 0.85;
        const discountPercent = isDeal
            ? Math.round(((medianPrice - listing.price) / medianPrice) * 100)
            : 0;

        return {
            ...listing,
            score,
            isDeal,
            discountPercent,
            medianPrice,
            lowestPrice,
        };
    });

    // Sort descending by score (best deal first)
    ranked.sort((a, b) => b.score - a.score);

    return {
        bestDeal: ranked[0],
        sellerList: ranked,
    };
}
