ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS kiosk_pin VARCHAR(4),
ADD COLUMN IF NOT EXISTS kiosk_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_checkout_at TIMESTAMPTZ;

-- Add kiosk_project_id to track which project the kiosk is for
CREATE TABLE kiosk_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kiosk_sessions_company_id ON kiosk_sessions(company_id);