-- Link equipment to schedule resources
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS task_resource_id UUID
    REFERENCES project_task_resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_task_resource
  ON equipment(task_resource_id);