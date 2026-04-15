-- Create plans table from hardcoded data
CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  interval VARCHAR(20) NOT NULL DEFAULT 'month',
  description TEXT,
  max_projects INTEGER NOT NULL DEFAULT 2,
  max_users INTEGER NOT NULL DEFAULT 5,
  features JSONB NOT NULL DEFAULT '[]',
  is_free BOOLEAN NOT NULL DEFAULT false,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with existing hardcoded plan data
INSERT INTO plans (id, name, price, max_projects, max_users, features, is_free, is_popular, sort_order, description) VALUES
(
  'STARTER', 'Starter', 0, 2, 5,
  '["2 active projects","5 team members","Basic reports","Material tracking","Site diary","Standard support"]',
  true, false, 1,
  'Perfect for getting started'
),
(
  'PRO', 'Pro', 15000, 10, 25,
  '["10 active projects","25 team members","Advanced reports","All modules included","Client portal","Priority support","Data export"]',
  false, true, 2,
  'For growing construction firms'
),
(
  'ENTERPRISE', 'Enterprise', 40000, 999, 999,
  '["Unlimited projects","Unlimited team members","White label branding","Dedicated account manager","Custom integrations","SLA support","AI features included"]',
  false, false, 3,
  'For large construction companies'
)
ON CONFLICT (id) DO NOTHING;

-- Commission settings (already created in pgAdmin but migration-safe)
CREATE TABLE IF NOT EXISTS commission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_rate NUMERIC(5,2) NOT NULL DEFAULT 3.00,
  minimum_amount INTEGER NOT NULL DEFAULT 500,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO commission_settings (global_rate, minimum_amount)
SELECT 3.00, 500
WHERE NOT EXISTS (SELECT 1 FROM commission_settings);

-- Add commission columns to supplier_profiles (safe if already exists)
ALTER TABLE supplier_profiles
  ADD COLUMN IF NOT EXISTS custom_commission_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_note TEXT;

-- Add plan override columns to companies (safe if already exists)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_override_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS plan_override_note TEXT;