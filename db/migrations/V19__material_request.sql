CREATE TABLE material_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_number VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  priority VARCHAR(20) DEFAULT 'NORMAL',
  needed_by DATE,
  notes TEXT,
  rejection_reason TEXT,
  approved_by_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  requested_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE material_request_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  material_name VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit VARCHAR(50) DEFAULT 'units',
  unit_price DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_material_requests_company_id ON material_requests(company_id);
CREATE INDEX idx_material_requests_project_id ON material_requests(project_id);
CREATE INDEX idx_material_requests_status ON material_requests(status);