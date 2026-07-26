-- V40__material_catalog.sql
-- Company-level material catalog

CREATE TABLE material_catalog (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  unit        VARCHAR(50)  NOT NULL DEFAULT 'units',
  category    VARCHAR(50)  NOT NULL DEFAULT 'GENERAL'
                CHECK (category IN ('CONCRETE','STEEL','TIMBER','FINISHING',
                                    'ELECTRICAL','PLUMBING','GENERAL')),
  min_stock_level NUMERIC(12,2) DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);

CREATE INDEX idx_material_catalog_company ON material_catalog(company_id);