-- V60__add_material_excess.sql
--
-- Tracks excess material usage: automatically recorded when a material
-- request is approved and the resulting cumulative issued_quantity on a
-- task's resource exceeds what was actually planned for that task. This
-- is distinct from wastage (which fires at task COMPLETION comparing
-- issued vs planned) — excess fires at REQUEST APPROVAL time, catching
-- over-issuance as soon as it happens rather than waiting for the task
-- to finish.
--
-- ASSUMPTION: uses gen_random_uuid() for the PK default, matching the
-- most common Postgres 13+ convention. If this project's other tables
-- use a different UUID generation function (uuid_generate_v4() via the
-- uuid-ossp extension, for example), swap this out to match — I don't
-- have a confirmed CREATE TABLE statement from this schema to check
-- against, since every table touched so far has been an existing one.

CREATE TABLE IF NOT EXISTS material_excess (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id),
  store_item_id     UUID NOT NULL REFERENCES project_store(id),
  task_id           UUID REFERENCES project_tasks(id),
  task_resource_id  UUID REFERENCES project_task_resources(id),
  planned_quantity  NUMERIC NOT NULL,
  issued_quantity   NUMERIC NOT NULL,
  excess_quantity   NUMERIC NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_excess_project ON material_excess(project_id);
CREATE INDEX IF NOT EXISTS idx_material_excess_task ON material_excess(task_id);