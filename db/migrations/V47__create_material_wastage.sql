-- V44__material_wastage.sql
-- Track actual usage vs issued quantity per task

CREATE TABLE material_wastage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  store_item_id    UUID NOT NULL REFERENCES project_store(id) ON DELETE CASCADE,
  task_id          UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  request_id       UUID REFERENCES material_requests(id) ON DELETE SET NULL,
  quantity_issued  NUMERIC(12,2) NOT NULL,
  quantity_used    NUMERIC(12,2) NOT NULL,
  quantity_wasted  NUMERIC(12,2) GENERATED ALWAYS AS (quantity_issued - quantity_used) STORED,
  recorded_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wastage_project ON material_wastage(project_id);
CREATE INDEX idx_wastage_task    ON material_wastage(task_id);