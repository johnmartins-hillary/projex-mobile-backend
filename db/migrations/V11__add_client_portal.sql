CREATE TABLE IF NOT EXISTS client_portals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  client_name VARCHAR(255),
  client_email VARCHAR(255),
  client_phone VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  show_budget BOOLEAN DEFAULT TRUE,
  show_expenses BOOLEAN DEFAULT FALSE,
  show_materials BOOLEAN DEFAULT TRUE,
  show_visitors BOOLEAN DEFAULT FALSE,
  show_photos BOOLEAN DEFAULT TRUE,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_portals_token ON client_portals(token);
CREATE INDEX IF NOT EXISTS idx_client_portals_project_id ON client_portals(project_id);