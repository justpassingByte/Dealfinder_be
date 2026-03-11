-- UP
CREATE INDEX IF NOT EXISTS idx_listings_variant_active
ON listings(variant_id)
WHERE listing_status = 'active';

-- DOWN
DROP INDEX IF EXISTS idx_listings_variant_active;
