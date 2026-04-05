-- ============================================================
-- V3__employees_and_billing.sql
-- Employees, payroll, billing
-- ============================================================

CREATE TYPE employee_status AS ENUM ('ACTIVE','INACTIVE','TERMINATED');
CREATE TYPE pay_period AS ENUM ('DAILY','WEEKLY','MONTHLY');
CREATE TYPE billing_status AS ENUM ('PENDING','ACTIVE','EXPIRED','CANCELLED');

-- ── Employees ─────────────────────────────────────────────────
CREATE TABLE employees (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  phone            VARCHAR(20),
  email            VARCHAR(255),
  role             VARCHAR(100) NOT NULL DEFAULT 'Labourer',
  department       VARCHAR(100),
  status           employee_status NOT NULL DEFAULT 'ACTIVE',
  daily_rate       DECIMAL(15,2) NOT NULL DEFAULT 0,
  pay_period       pay_period NOT NULL DEFAULT 'DAILY',
  bank_name        VARCHAR(100),
  account_number   VARCHAR(20),
  avatar_url       TEXT,
  address          TEXT,
  emergency_name   VARCHAR(255),
  emergency_phone  VARCHAR(20),
  hire_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  termination_date DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_employees_company_id ON employees(company_id);
CREATE INDEX idx_employees_status ON employees(status);

-- ── Employee Documents ────────────────────────────────────────
CREATE TABLE employee_documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        VARCHAR(100) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  url         TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_emp_docs_employee_id ON employee_documents(employee_id);

-- ── Link attendance to employees ──────────────────────────────
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX idx_attendances_employee_id ON attendances(employee_id);

-- ── Subscriptions / Billing ───────────────────────────────────
CREATE TABLE subscriptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan              subscription_plan NOT NULL,
  status            billing_status NOT NULL DEFAULT 'PENDING',
  paystack_ref      VARCHAR(255) UNIQUE,
  paystack_sub_code VARCHAR(255),
  amount            DECIMAL(15,2) NOT NULL,
  currency          VARCHAR(10) NOT NULL DEFAULT 'NGN',
  started_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subscriptions_company_id ON subscriptions(company_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  paystack_ref   VARCHAR(255) NOT NULL UNIQUE,
  amount         DECIMAL(15,2) NOT NULL,
  currency       VARCHAR(10) NOT NULL DEFAULT 'NGN',
  status         VARCHAR(50) NOT NULL DEFAULT 'pending',
  paid_at        TIMESTAMPTZ,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_company_id ON payments(company_id);

-- updated_at triggers
CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Seed demo employees ───────────────────────────────────────
INSERT INTO employees (company_id, first_name, last_name, phone, role, department, daily_rate, pay_period, hire_date, status) VALUES
('a1b2c3d4-0000-0000-0000-000000000001','Rotimi','Adebayo','+234 811 000 0001','Foreman','Civil Works',12000,'DAILY','2023-01-10','ACTIVE'),
('a1b2c3d4-0000-0000-0000-000000000001','Ngozi','Okonkwo','+234 812 000 0002','Mason','Civil Works',8500,'DAILY','2023-03-15','ACTIVE'),
('a1b2c3d4-0000-0000-0000-000000000001','Suleiman','Garba','+234 813 000 0003','Electrician','MEP',10000,'DAILY','2023-02-20','ACTIVE'),
('a1b2c3d4-0000-0000-0000-000000000001','Chisom','Eze','+234 814 000 0004','Steel Fixer','Civil Works',7500,'DAILY','2023-04-05','ACTIVE'),
('a1b2c3d4-0000-0000-0000-000000000001','Abdullahi','Musa','+234 815 000 0005','Driver','Logistics',6500,'DAILY','2022-11-01','ACTIVE'),
('a1b2c3d4-0000-0000-0000-000000000001','Taiwo','Oladele','+234 816 000 0006','Plumber','MEP',9000,'DAILY','2023-06-01','INACTIVE');
