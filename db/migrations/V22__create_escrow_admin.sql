CREATE TABLE escrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES marketplace_orders(id),
  company_id UUID REFERENCES companies(id),
  supplier_id UUID REFERENCES supplier_profiles(id),
  amount DECIMAL(15,2) NOT NULL,
  commission_rate DECIMAL(5,2) DEFAULT 3.00,
  commission_amount DECIMAL(15,2),
  supplier_amount DECIMAL(15,2),
  status VARCHAR(50) DEFAULT 'HOLDING',
  paystack_reference VARCHAR(100),
  paystack_transfer_code VARCHAR(100),
  held_at TIMESTAMPTZ DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE marketplace_orders 
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS escrow_id UUID REFERENCES escrow_transactions(id),
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_by UUID REFERENCES users(id);

-- Super admin role
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN_PROJEX';

CREATE INDEX idx_escrow_order ON escrow_transactions(order_id);
CREATE INDEX idx_escrow_status ON escrow_transactions(status);