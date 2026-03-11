-- UP
CREATE TABLE IF NOT EXISTS click_events (
    id BIGSERIAL PRIMARY KEY,
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    clicked_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_click_events_listing ON click_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_click_events_time ON click_events(clicked_at);

-- DOWN
DROP TABLE IF EXISTS click_events;
