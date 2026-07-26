-- migrations/xxxx_generalize_resource_catalog.sql

-- Postgres automatically repoints any FK referencing material_catalog
-- (e.g. project_store.catalog_item_id) after this rename — no need to
-- touch that constraint separately.
ALTER TABLE material_catalog RENAME TO resource_catalog;

ALTER TABLE resource_catalog
  ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'MATERIAL';

ALTER TABLE resource_catalog
  ALTER COLUMN type DROP DEFAULT;

ALTER TABLE resource_catalog
  ADD CONSTRAINT resource_catalog_type_check
  CHECK (type IN ('LABOUR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACT'));

-- Prevents duplicate catalog entries per company/type/name at the DB
-- level, case-insensitively — the same defensive pattern used for
-- project_store's name uniqueness. Application code (see
-- ScheduleRepository._resolveOrCreateCatalog) already does a
-- create-or-get lookup before inserting, so this should rarely fire in
-- practice; it's a backstop against races, not the primary guard.
CREATE UNIQUE INDEX resource_catalog_company_type_name_uq
  ON resource_catalog (company_id, type, LOWER(name))
  WHERE is_active = TRUE;

-- Every task resource — not just MATERIAL — can now point at its catalog
-- entry. MATERIAL resources carry BOTH catalog_id (cross-project identity)
-- and store_item_id (this project's stock row for that catalog item).
-- LABOUR/EQUIPMENT/SUBCONTRACT only ever get catalog_id — there's no
-- per-project stock concept for a Mason or an Excavator.
ALTER TABLE project_task_resources
  ADD COLUMN catalog_id UUID REFERENCES resource_catalog(id) ON DELETE SET NULL;

CREATE INDEX idx_ptr_catalog_id ON project_task_resources(catalog_id);