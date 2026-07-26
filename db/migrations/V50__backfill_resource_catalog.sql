-- migrations/xxxx_backfill_resource_catalog.sql
--
-- Must run AFTER migration_resource_catalog.sql (needs resource_catalog.type,
-- project_task_resources.catalog_id, and the case-insensitive unique index
-- to already exist).

-- ── Step 0: drop the stale legacy constraint ──────────────────────────────
-- The original material_catalog table had its own UNIQUE(company_id, name)
-- constraint (auto-named material_catalog_company_id_name_key), predating
-- everything in this migration series — it was never shown in any file up
-- to this point, only surfaced when this migration hit it. Renaming the
-- table does NOT rename or drop its constraints, so it survived under its
-- old name and is now actively wrong: it enforces "one name per company"
-- with no concept of type, so e.g. a MATERIAL and a LABOUR entry can't
-- share a name even though they're clearly different things. The new
-- resource_catalog_company_type_name_uq index (added in the prior
-- migration) is the correct replacement — type-aware — so this one is
-- just dropped, not replaced 1:1.
ALTER TABLE resource_catalog
  DROP CONSTRAINT IF EXISTS material_catalog_company_id_name_key;

-- ── Step 1: create any missing resource_catalog entries ──────────────────
-- One catalog row per distinct (company, type, case-insensitive trimmed
-- name) among currently-unlinked resources. Where two resources differ
-- only by casing/whitespace, the earliest-created one's exact text becomes
-- the catalog's canonical name.
INSERT INTO resource_catalog (company_id, type, name, unit)
SELECT DISTINCT ON (ptr.company_id, ptr.type, LOWER(TRIM(ptr.description)))
  ptr.company_id,
  ptr.type,
  TRIM(ptr.description),
  COALESCE(
    NULLIF(TRIM(ptr.unit), ''),
    CASE WHEN ptr.type = 'MATERIAL' THEN 'units' ELSE 'lump sum' END
  )
FROM project_task_resources ptr
WHERE ptr.catalog_id IS NULL
  AND ptr.description IS NOT NULL
  AND TRIM(ptr.description) <> ''
  AND ptr.type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM resource_catalog rc
    WHERE rc.company_id = ptr.company_id
      AND rc.type = ptr.type
      AND LOWER(rc.name) = LOWER(TRIM(ptr.description))
      AND rc.is_active = TRUE
  )
ORDER BY ptr.company_id, ptr.type, LOWER(TRIM(ptr.description)), ptr.created_at ASC
ON CONFLICT (company_id, type, (LOWER(name))) WHERE is_active = TRUE DO NOTHING;

-- ── Step 2: link every unlinked resource to its catalog entry ────────────
-- By this point step 1 guarantees a matching catalog row exists for every
-- resource that has a usable description.
UPDATE project_task_resources ptr
SET catalog_id = rc.id
FROM resource_catalog rc
WHERE ptr.catalog_id IS NULL
  AND ptr.description IS NOT NULL
  AND TRIM(ptr.description) <> ''
  AND ptr.type IS NOT NULL
  AND rc.company_id = ptr.company_id
  AND rc.type = ptr.type
  AND LOWER(rc.name) = LOWER(TRIM(ptr.description))
  AND rc.is_active = TRUE;

-- ── Step 3a: backfill catalog_item_id on existing project_store rows ─────
-- Store items created before catalog_item_id existed get linked by
-- case-insensitive name match against the (now-complete) catalog.
UPDATE project_store ps
SET catalog_item_id = rc.id
FROM resource_catalog rc
WHERE ps.catalog_item_id IS NULL
  AND rc.type = 'MATERIAL'
  AND rc.company_id = ps.company_id
  AND LOWER(rc.name) = LOWER(TRIM(ps.name));

-- ── Step 3b: create missing project_store rows ────────────────────────────
-- For any (project, catalog entry) pair a MATERIAL resource needs but that
-- project doesn't have a store item for yet.
INSERT INTO project_store (project_id, company_id, catalog_item_id, name, unit, min_stock_level)
SELECT DISTINCT ON (ptr.project_id, rc.id)
  ptr.project_id,
  ptr.company_id,
  rc.id,
  rc.name,
  rc.unit,
  0
FROM project_task_resources ptr
JOIN resource_catalog rc ON rc.id = ptr.catalog_id
WHERE ptr.type = 'MATERIAL'
  AND ptr.store_item_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_store ps
    WHERE ps.project_id = ptr.project_id
      AND ps.catalog_item_id = rc.id
  )
ORDER BY ptr.project_id, rc.id, ptr.created_at ASC
ON CONFLICT DO NOTHING;

-- ── Step 4: link MATERIAL resources to their project's store item ────────
-- Every store item a resource needs is now guaranteed to exist.
UPDATE project_task_resources ptr
SET store_item_id = ps.id
FROM project_store ps
WHERE ptr.type = 'MATERIAL'
  AND ptr.store_item_id IS NULL
  AND ptr.catalog_id IS NOT NULL
  AND ps.project_id = ptr.project_id
  AND ps.catalog_item_id = ptr.catalog_id;

-- ── Sanity check (informational, no effect on data) ───────────────────────
-- Run manually after migrating to confirm the backfill covered everything
-- resolvable. Any remaining count here has no description/type to resolve
-- against and was left untouched intentionally.
--
-- SELECT type, COUNT(*) FROM project_task_resources
-- WHERE catalog_id IS NULL GROUP BY type;