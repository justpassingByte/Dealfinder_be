-- DealFinder Database Schema
-- Run this file against your PostgreSQL instance to create all tables.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  referrer_id   UUID,                          -- FK to creators.id (set after creators table exists)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Creators (KOLs)
-- ============================================
CREATE TABLE IF NOT EXISTS creators (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code     VARCHAR(64) UNIQUE NOT NULL,
  commission_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Now add the FK from users.referrer_id -> creators.id
ALTER TABLE users
  ADD CONSTRAINT fk_users_referrer
  FOREIGN KEY (referrer_id) REFERENCES creators(id)
  ON DELETE SET NULL;

-- ============================================
-- Clicks
-- ============================================
CREATE TABLE IF NOT EXISTS clicks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  creator_id  UUID REFERENCES creators(id) ON DELETE SET NULL,
  product_url TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip          VARCHAR(45),
  user_agent  TEXT
);

CREATE INDEX idx_clicks_creator   ON clicks(creator_id);
CREATE INDEX idx_clicks_timestamp ON clicks(timestamp);

-- ============================================
-- Orders
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_order_id VARCHAR(255) UNIQUE NOT NULL,
  commission_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  creator_id         UUID REFERENCES creators(id) ON DELETE SET NULL,
  user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_creator ON orders(creator_id);
