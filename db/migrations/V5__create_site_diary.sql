CREATE TABLE site_diary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_id UUID NOT NULL REFERENCES users(id),
  diary_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weather VARCHAR(50) DEFAULT 'Sunny',
  temperature VARCHAR(20),
  workers_present INTEGER DEFAULT 0,
  work_summary TEXT NOT NULL,
  issues TEXT,
  safety_observations TEXT,
  materials_used TEXT,
  equipment_used TEXT,
  visitors_count INTEGER DEFAULT 0,
  photos JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, diary_date)
);

CREATE INDEX idx_site_diary_project_id ON site_diary(project_id);
CREATE INDEX idx_site_diary_date ON site_diary(diary_date);
CREATE TRIGGER trg_site_diary_updated_at 
  BEFORE UPDATE ON site_diary 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();