-- UP
CREATE TABLE IF NOT EXISTS scraper_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0,
  assigned_worker_id TEXT NOT NULL UNIQUE,
  profile_mount_name TEXT NOT NULL,
  container_profile_path TEXT NOT NULL,
  browser_host TEXT NOT NULL,
  browser_port INTEGER NOT NULL,
  browser_target_port INTEGER NOT NULL,
  debug_tunnel_port INTEGER,
  last_heartbeat_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_captcha_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  recovery_started_at TIMESTAMPTZ,
  warmup_requested_at TIMESTAMPTZ,
  warmup_success_streak INTEGER NOT NULL DEFAULT 0,
  last_risk_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  notes TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scraper_profiles_status_check CHECK (
    status IN (
      'pending_setup',
      'active',
      'warning',
      'blocked',
      'recovering',
      'warming',
      'cooldown',
      'archived'
    )
  ),
  CONSTRAINT scraper_profiles_risk_score_check CHECK (risk_score >= 0 AND risk_score <= 100),
  CONSTRAINT scraper_profiles_warmup_success_streak_check CHECK (warmup_success_streak >= 0)
);

CREATE INDEX IF NOT EXISTS idx_scraper_profiles_status ON scraper_profiles(status);
CREATE INDEX IF NOT EXISTS idx_scraper_profiles_last_heartbeat_at ON scraper_profiles(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_scraper_profiles_archived_at ON scraper_profiles(archived_at);

CREATE TABLE IF NOT EXISTS scraper_profile_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES scraper_profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  risk_delta INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_profile_events_profile_id_created_at
  ON scraper_profile_events(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scraper_profile_events_event_type
  ON scraper_profile_events(event_type);

-- DOWN
DROP TABLE IF EXISTS scraper_profile_events CASCADE;
DROP TABLE IF EXISTS scraper_profiles CASCADE;
