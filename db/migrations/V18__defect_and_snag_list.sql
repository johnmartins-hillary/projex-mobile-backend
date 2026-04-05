CREATE TABLE defects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255),
  category VARCHAR(50) DEFAULT 'GENERAL',
  priority VARCHAR(20) DEFAULT 'MEDIUM',
  status VARCHAR(20) DEFAULT 'OPEN',
  photos JSONB DEFAULT '[]',
  resolution_notes TEXT,
  resolution_photos JSONB DEFAULT '[]',
  assigned_to VARCHAR(255),
  due_date DATE,
  resolved_at TIMESTAMPTZ,
  raised_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_defects_company_id ON defects(company_id);
CREATE INDEX idx_defects_project_id ON defects(project_id);
CREATE INDEX idx_defects_status ON defects(status);