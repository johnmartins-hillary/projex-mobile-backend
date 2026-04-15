-- Featured placements table (full creation)
CREATE TABLE IF NOT EXISTS featured_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL, -- 'STORE' or 'PRODUCT'
  supplier_id UUID REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES supplier_products(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 30,
  amount_paid DECIMAL(15,2) DEFAULT 0,
  payment_reference VARCHAR(200),
  payment_status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED
  paystack_authorization_code VARCHAR(200), -- stored for auto-renewal
  is_active BOOLEAN DEFAULT FALSE,
  is_free BOOLEAN DEFAULT FALSE, -- admin granted free placement
  auto_renew BOOLEAN DEFAULT FALSE,
  renewal_count INTEGER DEFAULT 0,
  last_renewed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  granted_by UUID REFERENCES users(id), -- null if paid, admin id if free
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_featured_supplier ON featured_placements(supplier_id);
CREATE INDEX IF NOT EXISTS idx_featured_product ON featured_placements(product_id);
CREATE INDEX IF NOT EXISTS idx_featured_active ON featured_placements(is_active, ends_at);
CREATE INDEX IF NOT EXISTS idx_featured_type ON featured_placements(type, is_active);

-- Every payment tracked here (initial + renewals)
CREATE TABLE IF NOT EXISTS featured_placement_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  featured_placement_id UUID REFERENCES featured_placements(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  paystack_ref VARCHAR(200),
  paystack_authorization_code VARCHAR(200),
  amount DECIMAL(15,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  is_free BOOLEAN DEFAULT FALSE,
  granted_by UUID REFERENCES users(id),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fp_payments_supplier ON featured_placement_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_fp_payments_placement ON featured_placement_payments(featured_placement_id);
CREATE INDEX IF NOT EXISTS idx_fp_payments_status ON featured_placement_payments(status, paid_at);

-- Platform settings (for managing prices from admin)
CREATE TABLE IF NOT EXISTS platform_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  label VARCHAR(200),
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO platform_settings (key, value, label, description) VALUES
  ('featured_store_price_monthly', '15000', 'Featured Store Price (₦/month)', 'Price suppliers pay to feature their store at the top of the marketplace for 30 days'),
  ('featured_product_price_weekly', '5000', 'Featured Product Price (₦/week)', 'Price suppliers pay to feature a single product at the top of search results for 7 days')
ON CONFLICT (key) DO NOTHING;