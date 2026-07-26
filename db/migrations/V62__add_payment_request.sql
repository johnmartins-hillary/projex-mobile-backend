

CREATE TABLE IF NOT EXISTS payment_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              VARCHAR(20) NOT NULL CHECK (type IN ('STOCK_IN', 'LABOUR', 'SUBCONTRACT')),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  status            VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
  payload           JSONB NOT NULL,
  notes             TEXT,

  requested_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,


  receipt_url       TEXT,
  receipt_public_id TEXT,
  completed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at      TIMESTAMPTZ,
  linked_record_id  UUID, 

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_company_status ON payment_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_project ON payment_requests(project_id);