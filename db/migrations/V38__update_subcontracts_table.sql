-- V36: Add task_resource_id to subcontracts table
-- Links a subcontract back to a SUBCONTRACT resource in the schedule

ALTER TABLE subcontracts
  ADD COLUMN IF NOT EXISTS task_resource_id UUID REFERENCES project_task_resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subcontracts_task_resource ON subcontracts(task_resource_id);