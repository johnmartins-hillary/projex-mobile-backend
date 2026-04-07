-- Allow null company_id for super admins and suppliers
ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;

-- Seed super admin
INSERT INTO users (
  first_name, last_name, email, password_hash, role, is_active, created_at
)
VALUES (
  'Projex',
  'Admin',
  'admin@projex.ng',
  '$2a$12$6jgKBpNmFIyrosIMi8SJcOcD3vo5BzAq4Siwg6DKuvR223EbQfV9C',
  'SUPER_ADMIN_PROJEX',
  TRUE,
  NOW()
)
ON CONFLICT (email) DO NOTHING;