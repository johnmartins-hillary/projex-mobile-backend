-- ── material_requests — ALTER existing table to match full schema ──────────────
-- Your V46 table exists but is missing these columns — add them safely
 
ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS store_item_id       UUID REFERENCES project_store(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS task_resource_id    UUID REFERENCES project_task_resources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phase_id            UUID REFERENCES project_phases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_id             UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity_requested  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS quantity_approved   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS needed_by_date      DATE,
  ADD COLUMN IF NOT EXISTS requested_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason    TEXT,
  ADD COLUMN IF NOT EXISTS requested_at        TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW();
 
-- Fix status constraint to include all values
DO $$
BEGIN
  ALTER TABLE material_requests
    DROP CONSTRAINT IF EXISTS material_requests_status_check;
  ALTER TABLE material_requests
    ADD CONSTRAINT material_requests_status_check
    CHECK (status IN ('PENDING','APPROVED','PARTIAL','REJECTED','CANCELLED'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
 
-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_mat_req_store  ON material_requests(store_item_id);
CREATE INDEX IF NOT EXISTS idx_mat_req_status ON material_requests(status);
CREATE INDEX IF NOT EXISTS idx_mat_req_task   ON material_requests(task_id);