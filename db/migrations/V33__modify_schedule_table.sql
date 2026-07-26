-- ─────────────────────────────────────────────────────────────
-- V33: MS Project / P6 Import Support
-- Adds sub-phase hierarchy, flexible resource costs,
-- task duration, milestones and predecessor tracking
-- ─────────────────────────────────────────────────────────────

-- ── 1. project_phases: add sub-phase support ─────────────────

ALTER TABLE project_phases
  ADD COLUMN IF NOT EXISTS parent_phase_id UUID REFERENCES project_phases(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS duration_days   INTEGER,
  ADD COLUMN IF NOT EXISTS is_summary      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_id       VARCHAR(100),  -- original MS Project / P6 ID
  ADD COLUMN IF NOT EXISTS outline_level   INTEGER NOT NULL DEFAULT 1; -- 1=phase, 2=sub-phase, 3=sub-sub etc

-- Index for sub-phase queries
CREATE INDEX IF NOT EXISTS idx_phases_parent ON project_phases(parent_phase_id);
CREATE INDEX IF NOT EXISTS idx_phases_project_outline ON project_phases(project_id, outline_level);

-- ── 2. project_tasks: add duration, milestone, predecessors ──

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS is_milestone  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS predecessors  TEXT,        -- raw string e.g. "4,5FS+2d"
  ADD COLUMN IF NOT EXISTS source_id     VARCHAR(100), -- original MS Project task ID
  ADD COLUMN IF NOT EXISTS outline_level INTEGER NOT NULL DEFAULT 1;

-- ── 3. project_task_resources: drop GENERATED estimated_cost ─
-- Replace with a regular column that can store MS Project costs directly

-- Step 1: drop dependent view first, then the generated column
DROP VIEW IF EXISTS v_procurement_schedule;
DROP VIEW IF EXISTS v_project_progress;

ALTER TABLE project_task_resources
  DROP COLUMN IF EXISTS estimated_cost;

-- Step 2: add as regular column
ALTER TABLE project_task_resources
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(15,2) NOT NULL DEFAULT 0;

-- Step 3: allow quantity and unit_cost to be nullable
--         (MS Project gives total cost, not unit breakdown)
ALTER TABLE project_task_resources
  ALTER COLUMN quantity  DROP NOT NULL,
  ALTER COLUMN unit_cost DROP NOT NULL;

-- Step 4: add source tracking
ALTER TABLE project_task_resources
  ADD COLUMN IF NOT EXISTS source        VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS source_id     VARCHAR(100);

-- Check: source must be MANUAL, MSPROJECT, or P6
ALTER TABLE project_task_resources
  DROP CONSTRAINT IF EXISTS chk_resource_source;
ALTER TABLE project_task_resources
  ADD CONSTRAINT chk_resource_source
  CHECK (source IN ('MANUAL','MSPROJECT','P6','EXCEL'));

-- ── 4. Update trigger to handle new estimated_cost column ────
-- Old trigger called quantity * unit_cost — now estimated_cost
-- is set directly on import, and calculated on MANUAL entry

CREATE OR REPLACE FUNCTION recalc_task_cost(p_task_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE project_tasks SET
    estimated_cost = COALESCE((
      SELECT SUM(estimated_cost)
      FROM project_task_resources
      WHERE task_id = p_task_id
    ), 0),
    actual_cost = COALESCE((
      SELECT SUM(actual_cost)
      FROM project_task_resources
      WHERE task_id = p_task_id
    ), 0)
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql;

-- ── 5. New trigger: auto-calc estimated_cost on MANUAL entry ─
-- When source=MANUAL and quantity+unit_cost are set, compute it

CREATE OR REPLACE FUNCTION trg_resource_auto_calc()
RETURNS TRIGGER AS $$
BEGIN
  -- For manual entries with quantity and unit_cost, auto-calculate
  IF NEW.source = 'MANUAL'
     AND NEW.quantity IS NOT NULL
     AND NEW.unit_cost IS NOT NULL
     AND NEW.quantity > 0 THEN
    NEW.estimated_cost := NEW.quantity * NEW.unit_cost;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resource_auto_calc ON project_task_resources;
CREATE TRIGGER trg_resource_auto_calc
  BEFORE INSERT OR UPDATE ON project_task_resources
  FOR EACH ROW EXECUTE FUNCTION trg_resource_auto_calc();

-- ── 6. Update cost cascade trigger (already exists, refresh) ─

CREATE OR REPLACE FUNCTION trg_resource_cost_cascade()
RETURNS TRIGGER AS $$
DECLARE
  v_phase_id   UUID;
  v_project_id UUID;
BEGIN
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

-- ── 7. Update recalc_phase_cost to include sub-phases ────────
-- Phase cost = direct task costs + child phase costs

CREATE OR REPLACE FUNCTION recalc_phase_cost(p_phase_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Direct tasks under this phase
  UPDATE project_phases SET
    estimated_cost = COALESCE((
      SELECT SUM(t.estimated_cost)
      FROM project_tasks t
      WHERE t.phase_id = p_phase_id
    ), 0) + COALESCE((
      -- Child sub-phases
      SELECT SUM(cp.estimated_cost)
      FROM project_phases cp
      WHERE cp.parent_phase_id = p_phase_id
    ), 0),
    actual_cost = COALESCE((
      SELECT SUM(t.actual_cost)
      FROM project_tasks t
      WHERE t.phase_id = p_phase_id
    ), 0) + COALESCE((
      SELECT SUM(cp.actual_cost)
      FROM project_phases cp
      WHERE cp.parent_phase_id = p_phase_id
    ), 0)
  WHERE id = p_phase_id;

  -- Bubble up to parent phase if this is a sub-phase
  PERFORM recalc_phase_cost(parent_phase_id)
  FROM project_phases
  WHERE id = p_phase_id AND parent_phase_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 8. Update progress view to handle sub-phases ─────────────

CREATE OR REPLACE VIEW v_project_progress AS
WITH phase_stats AS (
  SELECT
    ph.project_id,
    ph.id                                                              AS phase_id,
    ph.parent_phase_id,
    ph.weight,
    ph.status,
    ph.estimated_cost,
    ph.actual_cost,
    ph.outline_level,
    COUNT(t.id)::FLOAT                                                 AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::FLOAT          AS completed_tasks
  FROM project_phases ph
  LEFT JOIN project_tasks t ON t.phase_id = ph.id
  GROUP BY ph.id, ph.project_id, ph.parent_phase_id, ph.weight,
           ph.status, ph.estimated_cost, ph.actual_cost, ph.outline_level
),
-- Only top-level phases contribute to overall progress
top_phases AS (
  SELECT * FROM phase_stats WHERE parent_phase_id IS NULL
),
phase_progress AS (
  SELECT
    project_id, phase_id, weight, status, estimated_cost, actual_cost,
    total_tasks, completed_tasks,
    CASE
      WHEN total_tasks = 0 THEN
        CASE WHEN status = 'COMPLETED' THEN 1.0 ELSE 0.0 END
      ELSE completed_tasks / total_tasks
    END AS completion_ratio
  FROM top_phases
)
SELECT
  p.id                        AS project_id,
  p.name                      AS project_name,
  p.schedule_estimated_budget AS estimated_budget,
  COALESCE(p.budget_override, p.schedule_estimated_budget) AS total_budget,
  COUNT(pp.phase_id)::INT     AS total_phases,
  COUNT(pp.phase_id) FILTER (WHERE pp.status = 'COMPLETED')::INT AS completed_phases,
  SUM(pp.total_tasks)::INT    AS total_tasks,
  SUM(pp.completed_tasks)::INT AS completed_tasks,
  COALESCE(
    CASE
      WHEN SUM(pp.weight) = 0 THEN 0
      ELSE ROUND(SUM(pp.weight * pp.completion_ratio) / SUM(pp.weight) * 100)
    END, 0
  )::INTEGER                  AS overall_progress_pct,
  COALESCE(SUM(pp.estimated_cost), 0) AS total_estimated_cost,
  COALESCE(SUM(pp.actual_cost),    0) AS total_actual_cost,
  COALESCE(SUM(pp.actual_cost), 0) - COALESCE(SUM(pp.estimated_cost), 0) AS cost_variance
FROM projects p
LEFT JOIN phase_progress pp ON pp.project_id = p.id
GROUP BY p.id, p.name, p.schedule_estimated_budget, p.budget_override;