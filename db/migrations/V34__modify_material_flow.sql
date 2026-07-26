-- ─────────────────────────────────────────────────────────────
-- V34: Link Schedule Resources to Materials Module
-- ─────────────────────────────────────────────────────────────

-- 1. Add columns to project_task_resources
ALTER TABLE project_task_resources
  ADD COLUMN IF NOT EXISTS material_id        UUID REFERENCES materials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_quantity NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS issued_quantity    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS request_status     VARCHAR(20) NOT NULL DEFAULT 'NONE';

ALTER TABLE project_task_resources
  DROP CONSTRAINT IF EXISTS chk_resource_request_status;
ALTER TABLE project_task_resources
  ADD CONSTRAINT chk_resource_request_status
  CHECK (request_status IN ('NONE','REQUESTED','PARTIAL','FULFILLED'));

-- 2. Add columns to material_requests
--    (quantity and requested_by_id already exist — only add new ones)
ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS task_resource_id UUID REFERENCES project_task_resources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_id          UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phase_id         UUID REFERENCES project_phases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_id   UUID REFERENCES users(id) ON DELETE SET NULL;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_task_resources_material   ON project_task_resources(material_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_resource ON material_requests(task_resource_id);

-- 4. Trigger: when material_request approved → stock out + mark resource procured
CREATE OR REPLACE FUNCTION trg_material_request_approved()
RETURNS TRIGGER AS $$
DECLARE
  v_material    materials%ROWTYPE;
  v_new_qty     NUMERIC;
  v_new_status  VARCHAR;
  v_req_qty     NUMERIC;
BEGIN
  -- Only fire on status change TO APPROVED
  IF NEW.status != 'APPROVED' OR OLD.status = 'APPROVED' THEN
    RETURN NEW;
  END IF;

  -- Only process if linked to a task resource and a material
  IF NEW.task_resource_id IS NULL OR NEW.material_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the quantity from the request
  v_req_qty := COALESCE(NEW.quantity, 0);
  IF v_req_qty <= 0 THEN RETURN NEW; END IF;

  -- Get the material
  SELECT * INTO v_material FROM materials WHERE id = NEW.material_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Calculate new stock quantity
  v_new_qty := GREATEST(
    COALESCE(v_material.quantity, 0) - v_req_qty,
    0
  );

  -- Determine new stock status
  v_new_status := CASE
    WHEN v_new_qty = 0                                                    THEN 'OUT_OF_STOCK'
    WHEN v_new_qty <= COALESCE(v_material.min_quantity, 0) * 0.5         THEN 'CRITICAL'
    WHEN v_new_qty <= COALESCE(v_material.min_quantity, 0)               THEN 'LOW'
    ELSE 'OK'
  END;

  -- Create STOCK_OUT transaction
  INSERT INTO stock_transactions (
    material_id, project_id, user_id, type,
    quantity, unit_cost, total_cost,
    quantity_before, quantity_after, notes
  ) VALUES (
    NEW.material_id,
    NEW.project_id,
    COALESCE(NEW.approved_by_id, NEW.requested_by_id),
    'STOCK_OUT',
    v_req_qty,
    COALESCE(v_material.unit_cost, 0),
    v_req_qty * COALESCE(v_material.unit_cost, 0),
    COALESCE(v_material.quantity, 0),
    v_new_qty,
    CONCAT('Auto stock-out from material request approval')
  );

  -- Update material stock
  UPDATE materials
  SET
    quantity         = v_new_qty,
    status           = v_new_status,
    updated_at       = NOW()
  WHERE id = NEW.material_id;

  -- Mark task resource as procured
  UPDATE project_task_resources
  SET
    is_procured      = TRUE,
    procured_at      = NOW(),
    issued_quantity  = COALESCE(issued_quantity, 0) + v_req_qty,
    request_status   = CASE
      WHEN COALESCE(issued_quantity, 0) + v_req_qty
           >= COALESCE(quantity, requested_quantity, 0)
      THEN 'FULFILLED'
      ELSE 'PARTIAL'
    END,
    actual_cost      = (COALESCE(issued_quantity, 0) + v_req_qty)
                       * COALESCE(v_material.unit_cost, 0)
  WHERE id = NEW.task_resource_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_material_request_approved ON material_requests;
CREATE TRIGGER trg_material_request_approved
  AFTER UPDATE ON material_requests
  FOR EACH ROW EXECUTE FUNCTION trg_material_request_approved();

-- 5. View: planned vs actual procurement per task resource
CREATE OR REPLACE VIEW v_task_resource_procurement AS
SELECT
  ptr.id                                           AS resource_id,
  ptr.task_id,
  ptr.phase_id,
  ptr.project_id,
  pt.name                                          AS task_name,
  pp.name                                          AS phase_name,
  ptr.type,
  ptr.description,
  ptr.unit,
  ptr.quantity                                     AS planned_quantity,
  ptr.estimated_cost                               AS planned_cost,
  ptr.actual_cost,
  ptr.material_id,
  m.name                                           AS material_name,
  m.quantity         AS stock_available,
  m.status                                         AS stock_status,
  ptr.requested_quantity,
  ptr.issued_quantity,
  ptr.is_procured,
  ptr.request_status,
  COUNT(mr.id) FILTER (
    WHERE mr.status IN ('PENDING','APPROVED')
  )::INT                                           AS open_requests
FROM project_task_resources ptr
JOIN project_tasks pt   ON pt.id  = ptr.task_id
JOIN project_phases pp  ON pp.id  = ptr.phase_id
LEFT JOIN materials m   ON m.id   = ptr.material_id
LEFT JOIN material_requests mr ON mr.task_resource_id = ptr.id
WHERE ptr.type = 'MATERIAL'
GROUP BY
  ptr.id, pt.name, pp.name,
  m.name, m.quantity, m.status;