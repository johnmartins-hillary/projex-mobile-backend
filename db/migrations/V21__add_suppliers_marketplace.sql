-- Supplier profiles
CREATE TABLE supplier_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  business_name VARCHAR(200) NOT NULL,
  cac_number VARCHAR(50),
  description TEXT,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  delivery_radius_km INTEGER DEFAULT 50,
  whatsapp VARCHAR(20),
  phone VARCHAR(20),
  email VARCHAR(200),
  logo_url TEXT,
  banner_url TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  rating DECIMAL(3,2) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  categories TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products/Materials listed by suppliers
CREATE TABLE supplier_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  min_order DECIMAL(10,2) DEFAULT 1,
  max_order DECIMAL(10,2),
  available_quantity DECIMAL(10,2),
  images TEXT[] DEFAULT '{}',
  is_available BOOLEAN DEFAULT TRUE,
  is_featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketplace orders
CREATE TABLE marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  company_id UUID REFERENCES companies(id),
  supplier_id UUID REFERENCES supplier_profiles(id),
  project_id UUID REFERENCES projects(id),
  status VARCHAR(50) DEFAULT 'PENDING',
  subtotal DECIMAL(15,2) NOT NULL,
  delivery_fee DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) NOT NULL,
  delivery_address TEXT,
  delivery_lat DECIMAL(10,8),
  delivery_lng DECIMAL(11,8),
  notes TEXT,
  payment_status VARCHAR(50) DEFAULT 'PENDING',
  payment_reference VARCHAR(100),
  escrow_released BOOLEAN DEFAULT FALSE,
  expected_delivery_date DATE,
  delivered_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order items
CREATE TABLE marketplace_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES supplier_products(id),
  product_name VARCHAR(200) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  total DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Supplier reviews
CREATE TABLE supplier_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES supplier_profiles(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  order_id UUID REFERENCES marketplace_orders(id),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add supplier role to enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPPLIER';

-- Indexes for performance
CREATE INDEX idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_category ON supplier_products(category);
CREATE INDEX idx_marketplace_orders_company ON marketplace_orders(company_id);
CREATE INDEX idx_marketplace_orders_supplier ON marketplace_orders(supplier_id);
CREATE INDEX idx_supplier_profiles_location ON supplier_profiles(latitude, longitude);