-- Schedule type on project (add column to existing projects table)
ALTER TABLE projects ADD COLUMN schedule_type VARCHAR(20) 
  CHECK (schedule_type IN ('SCHEDULE', 'MILESTONE', 'UPLOAD')) DEFAULT NULL;

-- Phases (also serves as milestones when is_milestone = true)
CREATE TABLE project_phases (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  weight          NUMERIC(5,2) NOT NULL DEFAULT 0,  -- must total 100 per project
  order_index     INTEGER NOT NULL,                  -- enforces phase sequence
  is_milestone    BOOLEAN NOT NULL DEFAULT FALSE,
  due_date        DATE,
  start_date      DATE,
  end_date        DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED')),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_phases_project_id ON project_phases(project_id);
CREATE INDEX idx_project_phases_order      ON project_phases(project_id, order_index);

CREATE TRIGGER trg_project_phases_updated_at
  BEFORE UPDATE ON project_phases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tasks (only for SCHEDULE/UPLOAD mode, not milestones)
CREATE TABLE project_tasks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase_id        UUID NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  start_date      DATE,
  end_date        DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED')),
  completed_at    TIMESTAMPTZ,
  assigned_to_id  UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_tasks_phase_id   ON project_tasks(phase_id);
CREATE INDEX idx_project_tasks_project_id ON project_tasks(project_id);

CREATE TRIGGER trg_project_tasks_updated_at
  BEFORE UPDATE ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();