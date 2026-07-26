-- ─────────────────────────────────────────────────────────────
-- Projex Schedule V2 Migration
-- WBS-driven budget: Phase → Task → Resources
-- ─────────────────────────────────────────────────────────────

-- ── 1. Alter projects table ───────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS schedule_estimated_budget NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_override           NUMERIC(15,2),  -- manual ceiling
  ADD COLUMN IF NOT EXISTS budget_approved           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS budget_approved_by        UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS budget_approved_at        TIMESTAMPTZ;

-- ── 2. Alter project_phases ───────────────────────────────────
ALTER TABLE project_phases
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost    NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ── 3. Alter project_tasks ────────────────────────────────────
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost    NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_pct INTEGER       NOT NULL DEFAULT 0
    CHECK (completion_pct BETWEEN 0 AND 100);

-- ── 4. Task resources (core new table) ───────────────────────
CREATE TABLE IF NOT EXISTS project_task_resources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id         UUID NOT NULL REFERENCES project_tasks(id)   ON DELETE CASCADE,
  phase_id        UUID NOT NULL REFERENCES project_phases(id)  ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id)        ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id)       ON DELETE CASCADE,

  type            VARCHAR(20) NOT NULL
                  CHECK (type IN ('LABOUR','MATERIAL','EQUIPMENT','SUBCONTRACT')),

  description     VARCHAR(255) NOT NULL,   -- "Mason", "Cement 50kg", "Concrete Mixer"
  unit            VARCHAR(50)  NOT NULL,   -- "days", "bags", "trips", "lump sum", "m³"
  quantity        NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(15,2) NOT NULL DEFAULT 0,
  estimated_cost  NUMERIC(15,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,

  actual_cost     NUMERIC(15,2) NOT NULL DEFAULT 0,  -- fed from expenses/timesheets
  is_procured     BOOLEAN NOT NULL DEFAULT FALSE,     -- ordered/arranged?
  procured_at     TIMESTAMPTZ,
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_resources_task_id    ON project_task_resources(task_id);
CREATE INDEX IF NOT EXISTS idx_task_resources_project_id ON project_task_resources(project_id);
CREATE INDEX IF NOT EXISTS idx_task_resources_type       ON project_task_resources(type);

CREATE TRIGGER trg_task_resources_updated_at
  BEFORE UPDATE ON project_task_resources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 5. Link expenses → tasks (optional, for actual cost tracking) ──
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS task_id     UUID REFERENCES project_tasks(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES project_task_resources(id) ON DELETE SET NULL;

-- ── 6. Link timesheets → tasks ─────────────────────────────────
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES project_tasks(id) ON DELETE SET NULL;

-- ── 7. Functions to recalculate costs up the tree ─────────────

-- Recalculate task estimated_cost from its resources
CREATE OR REPLACE FUNCTION recalc_task_cost(p_task_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE project_tasks SET
    estimated_cost = COALESCE((
      SELECT SUM(estimated_cost) FROM project_task_resources
      WHERE task_id = p_task_id
    ), 0),
    actual_cost = COALESCE((
      SELECT SUM(actual_cost) FROM project_task_resources
      WHERE task_id = p_task_id
    ), 0)
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql;

-- Recalculate phase estimated_cost from its tasks
CREATE OR REPLACE FUNCTION recalc_phase_cost(p_phase_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE project_phases SET
    estimated_cost = COALESCE((
      SELECT SUM(estimated_cost) FROM project_tasks
      WHERE phase_id = p_phase_id
    ), 0),
    actual_cost = COALESCE((
      SELECT SUM(actual_cost) FROM project_tasks
      WHERE phase_id = p_phase_id
    ), 0)
  WHERE id = p_phase_id;
END;
$$ LANGUAGE plpgsql;

-- Recalculate project schedule_estimated_budget from phases
CREATE OR REPLACE FUNCTION recalc_project_budget(p_project_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE projects SET
    schedule_estimated_budget = COALESCE((
      SELECT SUM(estimated_cost) FROM project_phases
      WHERE project_id = p_project_id
    ), 0)
  WHERE id = p_project_id;

  -- Ensure budget_override never goes below estimated
  UPDATE projects SET
    budget_override = schedule_estimated_budget
  WHERE id = p_project_id
    AND budget_override IS NOT NULL
    AND budget_override < schedule_estimated_budget;
END;
$$ LANGUAGE plpgsql;

-- ── 8. Trigger: auto-cascade cost recalc on resource change ───

CREATE OR REPLACE FUNCTION trg_resource_cost_cascade()
RETURNS TRIGGER AS $$
DECLARE
  v_phase_id  UUID;
  v_project_id UUID;
BEGIN
  -- Get phase and project from task
  SELECT phase_id, project_id INTO v_phase_id, v_project_id
  FROM project_tasks
  WHERE id = COALESCE(NEW.task_id, OLD.task_id);

  PERFORM recalc_task_cost(COALESCE(NEW.task_id, OLD.task_id));
  PERFORM recalc_phase_cost(v_phase_id);
  PERFORM recalc_project_budget(v_project_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_resource_cost ON project_task_resources;
CREATE TRIGGER trg_task_resource_cost
  AFTER INSERT OR UPDATE OR DELETE ON project_task_resources
  FOR EACH ROW EXECUTE FUNCTION trg_resource_cost_cascade();

-- ── 9. Trigger: auto-cascade cost recalc on task change ───────

CREATE OR REPLACE FUNCTION trg_task_cost_cascade()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalc_phase_cost(COALESCE(NEW.phase_id, OLD.phase_id));
  PERFORM recalc_project_budget(COALESCE(NEW.project_id, OLD.project_id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_cost ON project_tasks;
CREATE TRIGGER trg_task_cost
  AFTER UPDATE OF estimated_cost, actual_cost ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_task_cost_cascade();

-- ── 10. Progress calculation view ──────────────────────────────
-- Uses a subquery to avoid nested aggregates (PostgreSQL restriction)

CREATE OR REPLACE VIEW v_project_progress AS
WITH phase_stats AS (
  -- Aggregate tasks per phase first, then aggregate phases per project
  SELECT
    ph.project_id,
    ph.id                                                         AS phase_id,
    ph.weight,
    ph.status,
    ph.estimated_cost,
    ph.actual_cost,
    COUNT(t.id)::FLOAT                                            AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::FLOAT     AS completed_tasks
  FROM project_phases ph
  LEFT JOIN project_tasks t ON t.phase_id = ph.id
  GROUP BY ph.id, ph.project_id, ph.weight, ph.status,
           ph.estimated_cost, ph.actual_cost
),
phase_progress AS (
  -- Calculate per-phase completion ratio
  SELECT
    project_id,
    phase_id,
    weight,
    status,
    estimated_cost,
    actual_cost,
    total_tasks,
    completed_tasks,
    CASE
      WHEN total_tasks = 0 THEN
        CASE WHEN status = 'COMPLETED' THEN 1.0 ELSE 0.0 END
      ELSE completed_tasks / total_tasks
    END AS completion_ratio
  FROM phase_stats
)
SELECT
  p.id                        AS project_id,
  p.name                      AS project_name,
  p.schedule_estimated_budget AS estimated_budget,
  COALESCE(p.budget_override, p.schedule_estimated_budget)
                              AS total_budget,
  COUNT(pp.phase_id)::INT     AS total_phases,
  COUNT(pp.phase_id) FILTER (WHERE pp.status = 'COMPLETED')::INT
                              AS completed_phases,
  SUM(pp.total_tasks)::INT    AS total_tasks,
  SUM(pp.completed_tasks)::INT AS completed_tasks,
  -- Weighted progress: SUM(weight * ratio) / SUM(weight)
  COALESCE(
    CASE
      WHEN SUM(pp.weight) = 0 THEN 0
      ELSE ROUND(
        SUM(pp.weight * pp.completion_ratio) /
        SUM(pp.weight) * 100
      )
    END,
    0
  )::INTEGER                  AS overall_progress_pct,
  COALESCE(SUM(pp.estimated_cost), 0) AS total_estimated_cost,
  COALESCE(SUM(pp.actual_cost),    0) AS total_actual_cost,
  COALESCE(SUM(pp.actual_cost), 0) - COALESCE(SUM(pp.estimated_cost), 0)
                              AS cost_variance
FROM projects p
LEFT JOIN phase_progress pp ON pp.project_id = p.id
GROUP BY p.id, p.name, p.schedule_estimated_budget, p.budget_override;

-- ── 11. Resource procurement view ─────────────────────────────

CREATE OR REPLACE VIEW v_procurement_schedule AS
SELECT
  r.id,
  r.project_id,
  r.phase_id,
  r.task_id,
  r.type,
  r.description,
  r.unit,
  r.quantity,
  r.unit_cost,
  r.estimated_cost,
  r.actual_cost,
  r.is_procured,
  t.name          AS task_name,
  t.start_date    AS needed_by,
  t.status        AS task_status,
  ph.name         AS phase_name,
  ph.order_index  AS phase_order
FROM project_task_resources r
JOIN project_tasks  t  ON t.id  = r.task_id
JOIN project_phases ph ON ph.id = r.phase_id
ORDER BY t.start_date ASC NULLS LAST, r.type;