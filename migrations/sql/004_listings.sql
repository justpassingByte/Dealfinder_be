-- UP
DO $$ BEGIN
    CREATE TYPE listing_status_enum AS ENUM ('active', 'inactive');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) DEFAULT 'shopee',
  shop_id VARCHAR(100) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  shop_name VARCHAR(255) NOT NULL,
  price DECIMAL(15, 2) NOT NULL,
  rating DECIMAL(3, 2),
  sold INTEGER DEFAULT 0,
  product_url TEXT NOT NULL,
  image_url TEXT,
  listing_status listing_status_enum DEFAULT 'active',
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(marketplace, shop_id, item_id)
);

-- DOWN
DROP TABLE IF EXISTS listings CASCADE;
DROP TYPE IF EXISTS listing_status_enum;
