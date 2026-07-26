-- V58__add_wastage_source.sql
--
-- Distinguishes auto-calculated wastage (from task completion: issued
-- minus planned quantity) from manually-entered records. Both remain
-- editable — editing an AUTO record flips it to MANUAL, since a human
-- has now overridden the estimate with something more deliberate.

ALTER TABLE material_wastage
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE material_wastage
  ADD CONSTRAINT material_wastage_source_check CHECK (source IN ('AUTO', 'MANUAL'));