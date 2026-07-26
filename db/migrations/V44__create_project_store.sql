-- V41__project_store.sql
-- Per-project store (stock ledger per material)

CREATE TABLE project_store (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES material_catalog(id) ON DELETE SET NULL,
  name            VARCHAR(255) NOT NULL,  -- denormalized for flexibility
  unit            VARCHAR(50)  NOT NULL DEFAULT 'units',
  current_qty     NUMERIC(12,2) NOT NULL DEFAULT 0,
  reserved_qty    NUMERIC(12,2) NOT NULL DEFAULT 0,  -- pending requests
  min_stock_level NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);

-- available_qty = current_qty - reserved_qty (computed in queries)
CREATE INDEX idx_project_store_project   ON project_store(project_id);
CREATE INDEX idx_project_store_company   ON project_store(company_id);
CREATE INDEX idx_project_store_catalog   ON project_store(catalog_item_id);