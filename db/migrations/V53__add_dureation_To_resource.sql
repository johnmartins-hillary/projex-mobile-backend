
ALTER TABLE project_task_resources
  ADD COLUMN IF NOT EXISTS duration_days NUMERIC;

ALTER TABLE project_task_resources
  ADD COLUMN IF NOT EXISTS source_unit VARCHAR(50);