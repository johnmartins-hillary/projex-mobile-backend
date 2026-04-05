CREATE TABLE timesheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  mon_hours DECIMAL(4,2) DEFAULT 0,
  tue_hours DECIMAL(4,2) DEFAULT 0,
  wed_hours DECIMAL(4,2) DEFAULT 0,
  thu_hours DECIMAL(4,2) DEFAULT 0,
  fri_hours DECIMAL(4,2) DEFAULT 0,
  sat_hours DECIMAL(4,2) DEFAULT 0,
  sun_hours DECIMAL(4,2) DEFAULT 0,
  total_hours DECIMAL(6,2) GENERATED ALWAYS AS 
    (mon_hours + tue_hours + wed_hours + thu_hours + fri_hours + sat_hours + sun_hours) STORED,
  daily_rate DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_pay DECIMAL(15,2) GENERATED ALWAYS AS 
    (ROUND((mon_hours + tue_hours + wed_hours + thu_hours + fri_hours + sat_hours + sun_hours) / 8 * daily_rate, 2)) STORED,
  status VARCHAR(20) DEFAULT 'DRAFT',
  approved_by_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, week_start, project_id)
);

CREATE INDEX idx_timesheets_company_id ON timesheets(company_id);
CREATE INDEX idx_timesheets_project_id ON timesheets(project_id);
CREATE INDEX idx_timesheets_employee_id ON timesheets(employee_id);
CREATE INDEX idx_timesheets_week_start ON timesheets(week_start);
CREATE TRIGGER trg_timesheets_updated_at 
  BEFORE UPDATE ON timesheets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();