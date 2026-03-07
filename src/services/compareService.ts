import { Listing } from '../types/listing';

export interface RankedListing extends Listing {
    score: number;
}

export interface ComparisonResult {
    bestDeal: RankedListing;
    sellerList: RankedListing[];
}

/**
 * Normalise a value into a 0–1 range within a set.
 * Lower values get a HIGHER score when `invertForPrice` is true.
 */
function normalise(value: number, min: number, max: number, invert: boolean): number {
    if (max === min) return 0.5; // All identical
    const normalised = (value - min) / (max - min);
    return invert ? 1 - normalised : normalised;
}

/**
 * Price comparison engine.
 *
 * Ranking formula (from requirements):
 *   score = 0.6 * price_norm + 0.2 * rating_norm + 0.2 * sales_norm
 *
 * - price_norm is inverted (lower price = higher score)
 * - rating_norm is direct  (higher rating = higher score)
 * - sales_norm is direct   (higher sold count = higher score)
 */
export function compareListings(listings: Listing[]): ComparisonResult | null {
    if (!listings || listings.length === 0) return null;

    const prices = listings.map((l) => l.price);
    const ratings = listings.map((l) => l.rating);
    const sales = listings.map((l) => l.sold);

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    const minSales = Math.min(...sales);
    const maxSales = Math.max(...sales);

    const ranked: RankedListing[] = listings.map((listing) => {
        const priceScore = normalise(listing.price, minPrice, maxPrice, true);
        const ratingScore = normalise(listing.rating, minRating, maxRating, false);
        const salesScore = normalise(listing.sold, minSales, maxSales, false);

        const score = parseFloat(
            (0.6 * priceScore + 0.2 * ratingScore + 0.2 * salesScore).toFixed(4)
        );

        return { ...listing, score };
    });

    // Sort descending by score (best deal first)
    ranked.sort((a, b) => b.score - a.score);

    return {
        bestDeal: ranked[0],
        sellerList: ranked,
    };
}
