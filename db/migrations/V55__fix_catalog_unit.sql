-- V56__fix_labour_equipment_catalog_units.sql
--
-- LABOUR/EQUIPMENT catalog entries created before the workers/machines
-- unit model existed carry stale units ("days", "hours", "lump sum", etc.
-- — whatever the older parser/defaults produced). The application code
-- no longer trusts resource_catalog.unit for these two types (see
-- ScheduleRepository._fixedUnitForType), but existing rows still need a
-- one-time normalization so anything already displaying from them is
-- correct without waiting for another import to touch them.

UPDATE resource_catalog SET unit = 'workers'  WHERE type = 'LABOUR'    AND unit <> 'workers';
UPDATE resource_catalog SET unit = 'machines' WHERE type = 'EQUIPMENT' AND unit <> 'machines';

-- Existing project_task_resources rows that already copied a stale unit
-- at creation time (before this fix) also need correcting directly —
-- the catalog fix above only affects future lookups, not rows already
-- written with the wrong unit.
UPDATE project_task_resources SET unit = 'workers'  WHERE type = 'LABOUR'    AND unit <> 'workers';
UPDATE project_task_resources SET unit = 'machines' WHERE type = 'EQUIPMENT' AND unit <> 'machines';