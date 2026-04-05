CREATE TABLE material_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  material_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name VARCHAR(255),
  market VARCHAR(100),
  location VARCHAR(255),
  notes TEXT,
  recorded_by_id UUID REFERENCES users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_material_prices_company_id ON material_prices(company_id);
CREATE INDEX idx_material_prices_material_name ON material_prices(material_name);
CREATE INDEX idx_material_prices_recorded_at ON material_prices(recorded_at);

-- Seed some Nigerian market prices
INSERT INTO material_prices (company_id, material_name, category, unit, price, supplier_name, market, location, recorded_at)
VALUES
('a1b2c3d4-0000-0000-0000-000000000001', 'Dangote Cement 50kg', 'Binding', 'bag', 8500, 'Dangote Distributor', 'Mile 2 Market', 'Lagos', NOW() - INTERVAL '1 day'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Dangote Cement 50kg', 'Binding', 'bag', 8200, 'Local Supplier', 'Ojodu Market', 'Lagos', NOW() - INTERVAL '7 days'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Iron Rod 16mm', 'Steel', 'length', 12500, 'Steel Depot', 'Oshodi', 'Lagos', NOW() - INTERVAL '2 days'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Iron Rod 16mm', 'Steel', 'length', 11800, 'Steel Depot', 'Oshodi', 'Lagos', NOW() - INTERVAL '14 days'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Sharp Sand', 'Aggregate', 'trip', 85000, 'Sand Supplier', 'Ikorodu', 'Lagos', NOW() - INTERVAL '3 days'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Granite 3/4', 'Aggregate', 'trip', 120000, 'Quarry Direct', 'Sagamu', 'Ogun', NOW() - INTERVAL '5 days');