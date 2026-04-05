CREATE TABLE maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  maintenance_type VARCHAR(50) DEFAULT 'ROUTINE',
  scheduled_date DATE NOT NULL,
  completed_date DATE,
  cost DECIMAL(15,2) DEFAULT 0,
  technician_name VARCHAR(255),
  technician_phone VARCHAR(20),
  status VARCHAR(20) DEFAULT 'SCHEDULED',
  priority VARCHAR(20) DEFAULT 'MEDIUM',
  notes TEXT,
  next_schedule_date DATE,
  interval_days INTEGER DEFAULT 90,
  photos JSONB DEFAULT '[]',
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_maintenance_company_id ON maintenance_schedules(company_id);
CREATE INDEX idx_maintenance_equipment_id ON maintenance_schedules(equipment_id);
CREATE INDEX idx_maintenance_scheduled_date ON maintenance_schedules(scheduled_date);
CREATE INDEX idx_maintenance_status ON maintenance_schedules(status);
CREATE TRIGGER trg_maintenance_updated_at
  BEFORE UPDATE ON maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();