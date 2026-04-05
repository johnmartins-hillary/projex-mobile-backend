ALTER TABLE subcontracts 
ADD COLUMN IF NOT EXISTS retention_percentage DECIMAL(5,2) DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS retention_amount DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS retention_released BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS retention_released_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE,
ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE subcontract_milestones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcontract_id UUID NOT NULL REFERENCES subcontracts(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  due_date DATE,
  completed_date DATE,
  status VARCHAR(20) DEFAULT 'PENDING',
  payment_date DATE,
  payment_reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subcontract_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subcontract_id UUID NOT NULL REFERENCES subcontracts(id) ON DELETE CASCADE,
  milestone_id UUID REFERENCES subcontract_milestones(id) ON DELETE SET NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(50) DEFAULT 'BANK_TRANSFER',
  reference VARCHAR(255),
  notes TEXT,
  recorded_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subcontract_milestones_subcontract_id ON subcontract_milestones(subcontract_id);
CREATE INDEX idx_subcontract_payments_subcontract_id ON subcontract_payments(subcontract_id);

CREATE TRIGGER trg_milestones_updated_at
  BEFORE UPDATE ON subcontract_milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();