-- UP
-- 1. Products Performance
CREATE INDEX IF NOT EXISTS idx_products_trgm_name ON products USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_signature ON products(product_signature);
CREATE INDEX IF NOT EXISTS idx_products_popularity ON products(search_count DESC);

-- 2. Variants Mapping
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variant_lookup ON product_variants(product_id, variant_signature);

-- 3. Listings Retrieval
CREATE INDEX IF NOT EXISTS idx_listings_variant_status ON listings(variant_id, listing_status);
CREATE INDEX IF NOT EXISTS idx_listings_variant_price ON listings(variant_id, price); 

-- 4. Price History Analysis
CREATE INDEX IF NOT EXISTS idx_price_history_listing_time ON price_history(listing_id, recorded_at);

-- DOWN
DROP INDEX IF EXISTS idx_products_trgm_name;
DROP INDEX IF EXISTS idx_products_signature;
DROP INDEX IF EXISTS idx_products_popularity;
DROP INDEX IF EXISTS idx_variants_product;
DROP INDEX IF EXISTS idx_variant_lookup;
DROP INDEX IF EXISTS idx_listings_variant_status;
DROP INDEX IF EXISTS idx_listings_variant_price;
DROP INDEX IF EXISTS idx_price_history_listing_time;
