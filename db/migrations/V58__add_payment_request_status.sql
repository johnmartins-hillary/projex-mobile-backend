
ALTER TABLE store_stock_in
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE store_stock_in
  ADD CONSTRAINT store_stock_in_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));

ALTER TABLE project_labour_logs
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE project_labour_logs
  ADD CONSTRAINT project_labour_logs_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));

ALTER TABLE subcontract_payments
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE subcontract_payments
  ADD CONSTRAINT subcontract_payments_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));