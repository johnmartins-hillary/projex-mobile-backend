-- ─────────────────────────────────────────────────────────────────────────────
-- V35: Project Labour Logs
-- Tracks daily casual labourer costs against schedule LABOUR resources
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_labour_logs (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id       UUID         NOT NULL REFERENCES projects(id)             ON DELETE CASCADE,
  company_id       UUID         NOT NULL REFERENCES companies(id)            ON DELETE CASCADE,
  phase_id         UUID                  REFERENCES project_phases(id)       ON DELETE SET NULL,
  task_id          UUID                  REFERENCES project_tasks(id)        ON DELETE SET NULL,
  task_resource_id UUID                  REFERENCES project_task_resources(id) ON DELETE SET NULL,

  log_date         DATE         NOT NULL DEFAULT CURRENT_DATE,
  trade            VARCHAR(100) NOT NULL,   -- e.g. "Mason", "Carpenter", "Steel Fixer"
  headcount        INTEGER      NOT NULL CHECK (headcount > 0),
  day_rate         NUMERIC(12,2) NOT NULL CHECK (day_rate >= 0),
  total_cost       NUMERIC(12,2) GENERATED ALWAYS AS (headcount * day_rate) STORED,

  notes            TEXT,
  recorded_by      UUID         REFERENCES users(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labour_logs_project   ON project_labour_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_labour_logs_date      ON project_labour_logs(project_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_labour_logs_trade     ON project_labour_logs(project_id, trade);
CREATE INDEX IF NOT EXISTS idx_labour_logs_resource  ON project_labour_logs(task_resource_id);

CREATE TRIGGER trg_labour_logs_updated_at
  BEFORE UPDATE ON project_labour_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();