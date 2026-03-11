/**
 * TypeScript types for the Product Catalog feature.
 * Maps directly to the PostgreSQL schema in migrations 002–005.
 */

// ── Enums ──────────────────────────────────────────────
export type VariantStatus = 'active' | 'inactive';
export type ListingStatus = 'active' | 'inactive';

// ── Base Product ───────────────────────────────────────
export interface Product {
    id: string;                  // UUID
    normalized_name: string;
    product_signature: string;   // e.g. "apple_iphone_14_pro_max"
    brand: string | null;
    model: string | null;
    search_count: number;
    refresh_pending: boolean;
    last_searched_at: Date;
    last_scraped_at: Date;
    created_at: Date;
}

// ── Product Variant ────────────────────────────────────
export interface ProductVariant {
    id: string;                  // UUID
    product_id: string;          // FK → products.id
    variant_signature: string;   // e.g. "256gb_silver" (scoped per product)
    storage: string | null;
    color: string | null;
    normalized_variant_name: string | null;
    variant_status: VariantStatus;
    last_seen_at: Date;
    created_at: Date;
}

// ── Persisted Listing ──────────────────────────────────
export interface PersistedListing {
    id: string;                  // UUID
    variant_id: string;          // FK → product_variants.id
    marketplace: string;
    shop_id: string;
    item_id: string;
    shop_name: string;
    price: number;
    rating: number | null;
    sold: number;
    product_url: string;
    image_url: string | null;
    listing_status: ListingStatus;
    is_deal: boolean;
    discount_percent: number;
    last_seen_at: Date;
    updated_at: Date;
}

// ── Price History ──────────────────────────────────────
export interface PriceHistoryEntry {
    id: number;                  // BIGSERIAL
    listing_id: string;          // FK → listings.id
    price: number;
    recorded_at: Date;
}

// ── Freshness Tiers ────────────────────────────────────
export interface FreshnessTier {
    label: string;
    minSearchCount: number;
    maxSearchCount: number;
    ttlMinutes: number;
}

export const FRESHNESS_TIERS: FreshnessTier[] = [
    { label: 'hot', minSearchCount: 101, maxSearchCount: Infinity, ttlMinutes: 10 },
    { label: 'normal', minSearchCount: 10, maxSearchCount: 100, ttlMinutes: 30 },
    { label: 'low', minSearchCount: 0, maxSearchCount: 9, ttlMinutes: 120 },
];

export const MAX_STALENESS_MINUTES = 24 * 60; // 24 hours hard limit
