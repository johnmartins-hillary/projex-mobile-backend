-- V42__store_transactions.sql
-- Stock In and Stock Out history

CREATE TABLE store_stock_in (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_item_id   UUID NOT NULL REFERENCES project_store(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quantity        NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  supplier_name   VARCHAR(255),
  invoice_no      VARCHAR(100),
  delivery_date   DATE,
  receipt_url     TEXT,
  receipt_public_id TEXT,
  recorded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store_stock_out (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_item_id   UUID NOT NULL REFERENCES project_store(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  quantity        NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  reason          VARCHAR(20) NOT NULL DEFAULT 'REQUEST'
                    CHECK (reason IN ('REQUEST','WASTAGE','MANUAL','RETURN')),
  reference_id    UUID,  -- material_request.id if reason=REQUEST
  recorded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_in_store   ON store_stock_in(store_item_id);
CREATE INDEX idx_stock_in_project ON store_stock_in(project_id);
CREATE INDEX idx_stock_out_store  ON store_stock_out(store_item_id);
CREATE INDEX idx_stock_out_project ON store_stock_out(project_id);