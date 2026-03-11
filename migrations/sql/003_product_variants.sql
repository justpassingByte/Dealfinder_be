-- UP
DO $$ BEGIN
    CREATE TYPE variant_status_enum AS ENUM ('active', 'inactive');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_signature VARCHAR(255) NOT NULL, -- e.g. "256gb_silver" (scoped per product)
  storage VARCHAR(50),
  color VARCHAR(50),
  normalized_variant_name TEXT, -- e.g. "iPhone 14 Pro Max 256GB Silver"
  variant_status variant_status_enum DEFAULT 'active',
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(product_id, variant_signature) -- Scoped uniqueness
);

-- DOWN
DROP TABLE IF EXISTS product_variants CASCADE;
DROP TYPE IF EXISTS variant_status_enum;
