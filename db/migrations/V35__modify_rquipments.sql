-- ── Equipment: owned vs hired ─────────────────────────────────────────────

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS ownership_type VARCHAR(10) NOT NULL DEFAULT 'OWNED'
    CHECK (ownership_type IN ('OWNED','HIRED')),
  ADD COLUMN IF NOT EXISTS hire_company     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS hire_start_date  DATE,
  ADD COLUMN IF NOT EXISTS hire_end_date    DATE,
  ADD COLUMN IF NOT EXISTS hire_rate        NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS hire_rate_unit   VARCHAR(10)
    CHECK (hire_rate_unit IN ('DAY','WEEK','MONTH')),
  ADD COLUMN IF NOT EXISTS hire_project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_maintenance_at DATE;

-- Hired status values: ACTIVE, RETURNED
-- Owned status values: AVAILABLE, IN_USE, MAINTENANCE, RETIRED
-- The CHECK on status is removed so both sets can coexist
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;

-- ── Activity log ─────────────────────────────────────────────────────────
-- Single table for all events on any equipment item

CREATE TABLE IF NOT EXISTS equipment_activity_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id   UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES projects(id) ON DELETE SET NULL,

  event_type     VARCHAR(30) NOT NULL,
  -- OWNED:  USAGE_START, USAGE_END, MAINTENANCE, STATUS_CHANGE
  -- HIRED:  HIRE_START, HIRE_END, MAINTENANCE, STATUS_CHANGE

  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  cost           NUMERIC(15,2),          -- cost of this event (maintenance cost, hire cost)
  notes          TEXT,
  metadata       JSONB DEFAULT '{}',     -- duration_hrs, rate, technician_name, etc.

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eq_activity_equipment ON equipment_activity_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_eq_activity_company   ON equipment_activity_log(company_id);
CREATE INDEX IF NOT EXISTS idx_eq_activity_created   ON equipment_activity_log(created_at DESC);