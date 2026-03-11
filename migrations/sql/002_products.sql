-- UP
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  normalized_name TEXT NOT NULL, 
  product_signature VARCHAR(255) UNIQUE NOT NULL, -- e.g. "apple_iphone_14_pro_max"
  brand VARCHAR(100),
  model VARCHAR(200),
  search_count INTEGER DEFAULT 1,
  refresh_pending BOOLEAN DEFAULT FALSE, -- Flag for background retry
  last_searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_scraped_at TIMESTAMP WITH TIME ZONE DEFAULT '1970-01-01',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- DOWN
DROP TABLE IF EXISTS products CASCADE;
