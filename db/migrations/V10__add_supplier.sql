ALTER TABLE suppliers 
ADD COLUMN IF NOT EXISTS category VARCHAR(100),
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS rating DECIMAL(3,1) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_orders INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_spent DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS account_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS account_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Seed some suppliers for Okafor Construction
INSERT INTO suppliers (company_id, name, contact_name, phone, email, address, category, rating, is_active)
VALUES
('a1b2c3d4-0000-0000-0000-000000000001', 'Dangote Cement Depot', 'Emeka Eze', '+234 803 111 2222', 'emeka@dangote.ng', 'Mile 2, Lagos', 'Binding Materials', 4.5, TRUE),
('a1b2c3d4-0000-0000-0000-000000000001', 'Lagos Steel Hub', 'Biodun Adeyemi', '+234 805 333 4444', 'biodun@lagossteel.ng', 'Oshodi, Lagos', 'Steel & Iron', 4.2, TRUE),
('a1b2c3d4-0000-0000-0000-000000000001', 'Ikorodu Sand & Gravel', 'Chidi Okonkwo', '+234 807 555 6666', NULL, 'Ikorodu, Lagos', 'Aggregates', 3.8, TRUE)
ON CONFLICT DO NOTHING;