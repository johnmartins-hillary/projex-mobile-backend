-- V37: Add missing columns to subcontract_payments and subcontracts

ALTER TABLE subcontract_payments
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE subcontract_payments
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Also ensure milestone_id is nullable FK if not already
ALTER TABLE subcontract_payments
  ALTER COLUMN milestone_id DROP NOT NULL;