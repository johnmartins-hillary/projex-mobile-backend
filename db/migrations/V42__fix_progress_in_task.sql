-- V39__task_progress.sql
-- Add progress_pct to project_tasks
-- Phase progress is now derived from average task progress, not weights

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0
    CHECK (progress_pct BETWEEN 0 AND 100);

-- Backfill from existing status
UPDATE project_tasks SET progress_pct =
  CASE
    WHEN status = 'COMPLETED'  THEN 100
    WHEN status = 'IN_PROGRESS' THEN 50
    ELSE 0
  END;

-- Add a DB function to auto-calculate phase progress
-- Called after any task progress update
CREATE OR REPLACE FUNCTION calc_phase_progress(p_phase_id UUID)
RETURNS INTEGER AS $$
DECLARE
  avg_pct INTEGER;
BEGIN
  SELECT COALESCE(ROUND(AVG(progress_pct)), 0)::INTEGER
  INTO avg_pct
  FROM project_tasks
  WHERE phase_id = p_phase_id;

  UPDATE project_phases
  SET phase_progress = avg_pct
  WHERE id = p_phase_id;

  RETURN avg_pct;
END;
$$ LANGUAGE plpgsql;