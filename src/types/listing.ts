/** Shared listing type used across scraper, cache, and comparison engine. */
export interface Listing {
    title: string;
    price: number;       // numeric, in the marketplace's local currency
    rating: number;      // 0–5
    sold: number;        // total sold count
    shop: string;
    url: string;
    image: string;
    marketplace: string;
    score?: number;
    relevanceScore?: number;
    matchRate?: number;
}
