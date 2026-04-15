CREATE TABLE IF NOT EXISTS advertisements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  link_url TEXT,
  placement VARCHAR(50) NOT NULL, -- 'MARKETPLACE_BANNER', 'MARKETPLACE_FEED', 'DASHBOARD_BANNER'
  advertiser_name VARCHAR(200) NOT NULL,
  advertiser_contact VARCHAR(200),
  amount_paid DECIMAL(15,2) DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ads_placement ON advertisements(placement, is_active, ends_at);
CREATE INDEX IF NOT EXISTS idx_ads_active ON advertisements(is_active, starts_at, ends_at);