-- ============================================================
-- V1__initial_schema.sql
-- Projex Construction Resource Management
-- Full database schema — PostgreSQL 16
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
  'SUPER_ADMIN','PROJECT_OWNER','SITE_MANAGER',
  'QS_ESTIMATOR','ACCOUNTANT','FOREMAN',
  'SUBCONTRACTOR','CLIENT'
);

CREATE TYPE subscription_plan AS ENUM ('STARTER','PRO','ENTERPRISE');
CREATE TYPE project_status AS ENUM ('PLANNING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED');
CREATE TYPE material_status AS ENUM ('OK','LOW','CRITICAL','OUT_OF_STOCK');
CREATE TYPE stock_tx_type AS ENUM ('STOCK_IN','STOCK_OUT','ADJUSTMENT','DAMAGE');
CREATE TYPE equipment_status AS ENUM ('AVAILABLE','IN_USE','MAINTENANCE','RETIRED');
CREATE TYPE expense_status AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE po_status AS ENUM ('DRAFT','SENT','APPROVED','DELIVERED','CANCELLED');
CREATE TYPE visitor_status AS ENUM ('ON_SITE','CHECKED_OUT');
CREATE TYPE notification_type AS ENUM (
  'STOCK_ALERT','BUDGET_ALERT','MAINTENANCE_ALERT',
  'EXPENSE_ALERT','GENERAL','PUSH'
);
CREATE TYPE sync_action AS ENUM ('CREATE','UPDATE','DELETE');

-- ── Companies ────────────────────────────────────────────────
CREATE TABLE companies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255) NOT NULL,
  registration_no VARCHAR(100),
  address         TEXT,
  phone           VARCHAR(20),
  email           VARCHAR(255),
  logo_url        TEXT,
  plan            subscription_plan NOT NULL DEFAULT 'STARTER',
  plan_expires_at TIMESTAMPTZ,
  max_projects    INT NOT NULL DEFAULT 2,
  max_users       INT NOT NULL DEFAULT 5,
  language        VARCHAR(10) NOT NULL DEFAULT 'en',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  email            VARCHAR(255) NOT NULL UNIQUE,
  phone            VARCHAR(20),
  password_hash    VARCHAR(255) NOT NULL,
  role             user_role NOT NULL DEFAULT 'SITE_MANAGER',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url       TEXT,
  language         VARCHAR(10) NOT NULL DEFAULT 'en',
  push_token       TEXT,
  last_login_at    TIMESTAMPTZ,
  refresh_token    TEXT,
  reset_token      VARCHAR(255),
  reset_token_exp  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_email ON users(email);

-- ── Projects ─────────────────────────────────────────────────
CREATE TABLE projects (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  type         VARCHAR(100) NOT NULL,
  status       project_status NOT NULL DEFAULT 'ACTIVE',
  location     VARCHAR(255),
  latitude     DECIMAL(10,7),
  longitude    DECIMAL(10,7),
  start_date   DATE,
  end_date     DATE,
  total_budget DECIMAL(15,2) NOT NULL DEFAULT 0,
  client_name  VARCHAR(255),
  client_email VARCHAR(255),
  client_phone VARCHAR(20),
  image_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_projects_company_id ON projects(company_id);
CREATE INDEX idx_projects_status ON projects(status);

CREATE TABLE project_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       user_role NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- ── Suppliers ────────────────────────────────────────────────
CREATE TABLE suppliers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  phone        VARCHAR(20),
  email        VARCHAR(255),
  address      TEXT,
  rating       SMALLINT DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_suppliers_company_id ON suppliers(company_id);

-- ── Materials ────────────────────────────────────────────────
CREATE TABLE materials (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id  UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  name         VARCHAR(255) NOT NULL,
  category     VARCHAR(100) NOT NULL,
  unit         VARCHAR(50) NOT NULL,
  unit_cost    DECIMAL(15,2) NOT NULL DEFAULT 0,
  quantity     DECIMAL(15,3) NOT NULL DEFAULT 0,
  min_quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
  status       material_status NOT NULL DEFAULT 'OK',
  description  TEXT,
  image_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_materials_company_id ON materials(company_id);
CREATE INDEX idx_materials_status ON materials(status);
CREATE INDEX idx_materials_name_trgm ON materials USING GIN (name gin_trgm_ops);

CREATE TABLE stock_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  material_id     UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES users(id),
  type            stock_tx_type NOT NULL,
  quantity        DECIMAL(15,3) NOT NULL,
  unit_cost       DECIMAL(15,2) NOT NULL,
  total_cost      DECIMAL(15,2) NOT NULL,
  quantity_before DECIMAL(15,3) NOT NULL,
  quantity_after  DECIMAL(15,3) NOT NULL,
  notes           TEXT,
  receipt_url     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stock_tx_material_id ON stock_transactions(material_id);
CREATE INDEX idx_stock_tx_project_id ON stock_transactions(project_id);
CREATE INDEX idx_stock_tx_created_at ON stock_transactions(created_at DESC);

-- ── Equipment ────────────────────────────────────────────────
CREATE TABLE equipment (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  type                VARCHAR(100) NOT NULL,
  serial_no           VARCHAR(100),
  rate_per_hour       DECIMAL(15,2) NOT NULL DEFAULT 0,
  status              equipment_status NOT NULL DEFAULT 'AVAILABLE',
  total_hours_logged  DECIMAL(10,2) NOT NULL DEFAULT 0,
  next_maintenance_at TIMESTAMPTZ,
  image_url           TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_equipment_company_id ON equipment(company_id);
CREATE INDEX idx_equipment_status ON equipment(status);

CREATE TABLE equipment_usages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id),
  operator_id  UUID NOT NULL REFERENCES users(id),
  start_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time     TIMESTAMPTZ,
  duration_hrs DECIMAL(10,2),
  total_cost   DECIMAL(15,2),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_eq_usages_equipment_id ON equipment_usages(equipment_id);
CREATE INDEX idx_eq_usages_project_id ON equipment_usages(project_id);

CREATE TABLE maintenance_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id    UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  type            VARCHAR(50) NOT NULL,
  description     TEXT NOT NULL,
  cost            DECIMAL(15,2),
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_due_at     TIMESTAMPTZ,
  technician_name VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Budget & Expenses ────────────────────────────────────────
CREATE TABLE budgets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category   VARCHAR(100) NOT NULL,
  allocated  DECIMAL(15,2) NOT NULL,
  spent      DECIMAL(15,2) NOT NULL DEFAULT 0,
  period     VARCHAR(50),
  start_date DATE,
  end_date   DATE,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_budgets_project_id ON budgets(project_id);

CREATE TABLE expenses (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  budget_id        UUID REFERENCES budgets(id) ON DELETE SET NULL,
  submitted_by_id  UUID NOT NULL REFERENCES users(id),
  category         VARCHAR(100) NOT NULL,
  description      TEXT NOT NULL,
  amount           DECIMAL(15,2) NOT NULL,
  status           expense_status NOT NULL DEFAULT 'PENDING',
  receipt_url      TEXT,
  approved_by_id   UUID REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  rejected_reason  TEXT,
  expense_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_expenses_project_id ON expenses(project_id);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_date ON expenses(expense_date DESC);

-- ── Visitors ─────────────────────────────────────────────────
CREATE TABLE visitors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  logged_by_id  UUID NOT NULL REFERENCES users(id),
  full_name     VARCHAR(255) NOT NULL,
  company       VARCHAR(255),
  phone         VARCHAR(20),
  email         VARCHAR(255),
  purpose       VARCHAR(255) NOT NULL,
  host_name     VARCHAR(255),
  time_in       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_out      TIMESTAMPTZ,
  duration_mins INT,
  status        visitor_status NOT NULL DEFAULT 'ON_SITE',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_visitors_project_id ON visitors(project_id);
CREATE INDEX idx_visitors_time_in ON visitors(time_in DESC);

-- ── Attendance ───────────────────────────────────────────────
CREATE TABLE attendances (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  check_in     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out    TIMESTAMPTZ,
  latitude     DECIMAL(10,7),
  longitude    DECIMAL(10,7),
  hours_worked DECIMAL(6,2),
  daily_rate   DECIMAL(15,2),
  total_pay    DECIMAL(15,2),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_attendances_project_id ON attendances(project_id);
CREATE INDEX idx_attendances_user_id ON attendances(user_id);
CREATE INDEX idx_attendances_check_in ON attendances(check_in DESC);

-- ── Purchase Orders ──────────────────────────────────────────
CREATE TABLE purchase_orders (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  supplier_id  UUID NOT NULL REFERENCES suppliers(id),
  created_by_id UUID NOT NULL REFERENCES users(id),
  po_number    VARCHAR(50) NOT NULL UNIQUE,
  status       po_status NOT NULL DEFAULT 'DRAFT',
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  expected_at  TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pos_project_id ON purchase_orders(project_id);

CREATE TABLE po_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  quantity         DECIMAL(15,3) NOT NULL,
  unit             VARCHAR(50) NOT NULL,
  unit_price       DECIMAL(15,2) NOT NULL,
  total_price      DECIMAL(15,2) NOT NULL
);

-- ── Subcontracts ─────────────────────────────────────────────
CREATE TABLE subcontracts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_name    VARCHAR(255) NOT NULL,
  contact_name    VARCHAR(255),
  phone           VARCHAR(20),
  email           VARCHAR(255),
  scope           TEXT NOT NULL,
  contract_value  DECIMAL(15,2) NOT NULL,
  amount_paid     DECIMAL(15,2) NOT NULL DEFAULT 0,
  start_date      DATE,
  end_date        DATE,
  status          VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subcontracts_project_id ON subcontracts(project_id);

-- ── Notifications ────────────────────────────────────────────
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(255) NOT NULL,
  body       TEXT NOT NULL,
  type       notification_type NOT NULL DEFAULT 'GENERAL',
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- ── Reports ──────────────────────────────────────────────────
CREATE TABLE reports (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type       VARCHAR(100) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  file_url   TEXT,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Offline Sync Queue (server-side) ─────────────────────────
CREATE TABLE sync_queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  entity_type  VARCHAR(100) NOT NULL,
  entity_id    UUID NOT NULL,
  action       sync_action NOT NULL,
  payload      JSONB NOT NULL,
  processed    BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_queue_company_id ON sync_queue(company_id);
CREATE INDEX idx_sync_queue_processed ON sync_queue(processed);

-- ── Server sync cursor (tracks last pull per device) ─────────
CREATE TABLE sync_cursors (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  VARCHAR(255) NOT NULL,
  last_pulled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);

-- ── Updated_at trigger function ──────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'companies','users','projects','suppliers','materials',
    'equipment','budgets','expenses','purchase_orders','subcontracts'
  ] LOOP
    EXECUTE format('
      CREATE TRIGGER trg_%s_updated_at
      BEFORE UPDATE ON %s
      FOR EACH ROW EXECUTE FUNCTION update_updated_at()', tbl, tbl);
  END LOOP;
END $$;
