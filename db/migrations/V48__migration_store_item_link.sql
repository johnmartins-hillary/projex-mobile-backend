-- migrations/xxxx_add_store_item_link.sql

ALTER TABLE project_task_resources
  ADD COLUMN store_item_id UUID REFERENCES project_store(id) ON DELETE SET NULL;

CREATE INDEX idx_ptr_store_item_id ON project_task_resources(store_item_id);

-- Once you're confident nothing still reads `materials`/`material_id` on this
-- table (the dead flow from linkResourceToMaterial / requestFromStore),
-- material_id can be dropped in a follow-up migration. Left alone here —
-- dropping a column isn't something to bundle into the feature migration.