-- UP
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_deal BOOLEAN DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 0;

-- CREATE INDEX for fast retrieval of hot deals
CREATE INDEX IF NOT EXISTS idx_listings_hot_deals ON listings(is_deal, discount_percent DESC) 
WHERE listing_status = 'active' AND is_deal = true;

-- DOWN
ALTER TABLE listings DROP COLUMN IF EXISTS is_deal;
ALTER TABLE listings DROP COLUMN IF EXISTS discount_percent;
DROP INDEX IF EXISTS idx_listings_hot_deals;
