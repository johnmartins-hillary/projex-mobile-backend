DO $$
DECLARE
  view_def TEXT;
BEGIN
  SELECT pg_get_viewdef('v_task_resource_procurement'::regclass, true)
    INTO view_def;

  EXECUTE 'DROP VIEW v_task_resource_procurement';

  ALTER TABLE project_task_resources
    ALTER COLUMN quantity TYPE NUMERIC USING quantity::NUMERIC;

  ALTER TABLE project_task_resources
    ALTER COLUMN duration_days TYPE NUMERIC USING duration_days::NUMERIC;

  EXECUTE 'CREATE VIEW v_task_resource_procurement AS ' || view_def;
END $$;