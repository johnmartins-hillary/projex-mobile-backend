-- ============================================================
-- V2__seed_data.sql
-- Demo data for Projex — Nigerian construction company
-- ============================================================

-- Company
INSERT INTO companies (id, name, registration_no, address, phone, email, plan, plan_expires_at, max_projects, max_users)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Okafor Construction Ltd.',
  'RC-2019-004521',
  '14 Admiralty Way, Lekki Phase 1, Lagos',
  '+234 801 234 5678',
  'admin@okafor-construction.ng',
  'PRO',
  NOW() + INTERVAL '365 days',
  10, 25
);

-- Users (passwords are bcrypt of "Admin@1234", "Site@1234", "QS@1234", "Acc@1234")
INSERT INTO users (id, company_id, first_name, last_name, email, phone, password_hash, role, is_active, is_email_verified) VALUES
(
  'b1b2c3d4-0000-0000-0000-000000000001',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Chukwuma', 'Okafor',
  'admin@okafor-construction.ng',
  '+234 801 234 5678',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8m.KfkOlqXsFlgFenku',
  'PROJECT_OWNER', TRUE, TRUE
),
(
  'b1b2c3d4-0000-0000-0000-000000000002',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Adunola', 'Bello',
  'sitemanager@okafor-construction.ng',
  '+234 802 345 6789',
  '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWEwcDe',
  'SITE_MANAGER', TRUE, TRUE
),
(
  'b1b2c3d4-0000-0000-0000-000000000003',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Emeka', 'Eze',
  'qs@okafor-construction.ng',
  '+234 803 456 7890',
  '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWEwcDe',
  'QS_ESTIMATOR', TRUE, TRUE
),
(
  'b1b2c3d4-0000-0000-0000-000000000004',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Khadijah', 'Musa',
  'accountant@okafor-construction.ng',
  '+234 804 567 8901',
  '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWEwcDe',
  'ACCOUNTANT', TRUE, TRUE
);

-- Projects
INSERT INTO projects (id, company_id, name, description, type, status, location, latitude, longitude, start_date, end_date, total_budget, client_name, client_email) VALUES
(
  'c1b2c3d4-0000-0000-0000-000000000001',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Lekki Phase II Towers',
  '24-floor twin residential towers with penthouse suites',
  'Residential', 'ACTIVE',
  'Lekki Phase II, Lagos',
  6.4698, 3.5852,
  '2024-01-15', '2026-06-30',
  45000000.00,
  'Lekki Dev. Corp.', 'client@lekkidev.ng'
),
(
  'c1b2c3d4-0000-0000-0000-000000000002',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Abuja Ring Road Bridge',
  '600m dual-carriageway bridge over River Gurara',
  'Infrastructure', 'ACTIVE',
  'Gwagwalada, Abuja FCT',
  8.9403, 7.0858,
  '2023-08-01', '2026-12-31',
  180000000.00,
  'FCT Infrastructure Agency', NULL
),
(
  'c1b2c3d4-0000-0000-0000-000000000003',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Ibadan Tech Hub',
  '5-floor modern tech campus with co-working spaces',
  'Commercial', 'ACTIVE',
  'Bodija, Ibadan, Oyo',
  7.3986, 3.9007,
  '2024-03-01', '2025-09-30',
  28000000.00,
  'TechNaija Ventures', 'contact@technaija.ng'
);

-- Project members
INSERT INTO project_members (project_id, user_id, role) VALUES
('c1b2c3d4-0000-0000-0000-000000000001', 'b1b2c3d4-0000-0000-0000-000000000001', 'PROJECT_OWNER'),
('c1b2c3d4-0000-0000-0000-000000000001', 'b1b2c3d4-0000-0000-0000-000000000002', 'SITE_MANAGER'),
('c1b2c3d4-0000-0000-0000-000000000002', 'b1b2c3d4-0000-0000-0000-000000000001', 'PROJECT_OWNER'),
('c1b2c3d4-0000-0000-0000-000000000003', 'b1b2c3d4-0000-0000-0000-000000000001', 'PROJECT_OWNER'),
('c1b2c3d4-0000-0000-0000-000000000003', 'b1b2c3d4-0000-0000-0000-000000000003', 'QS_ESTIMATOR');

-- Suppliers
INSERT INTO suppliers (id, company_id, name, contact_name, phone, email, rating) VALUES
('d1b2c3d4-0000-0000-0000-000000000001','a1b2c3d4-0000-0000-0000-000000000001','Dangote Cement PLC','Segun Adeyemi','+234 700 326 4683','sales@dangote-cement.ng',5),
('d1b2c3d4-0000-0000-0000-000000000002','a1b2c3d4-0000-0000-0000-000000000001','Delta Steel Company','Chidi Okonkwo','+234 803 000 1111','orders@deltasteel.ng',4),
('d1b2c3d4-0000-0000-0000-000000000003','a1b2c3d4-0000-0000-0000-000000000001','Quarry Direct Nigeria','Musa Ibrahim','+234 805 222 3333','info@quarrydirect.ng',4);

-- Materials
INSERT INTO materials (id, company_id, supplier_id, name, category, unit, unit_cost, quantity, min_quantity, status) VALUES
('e1000000-0000-0000-0000-000000000001','a1b2c3d4-0000-0000-0000-000000000001','d1b2c3d4-0000-0000-0000-000000000001','Portland Cement (50kg)','Binding','bags',9500,240,50,'OK'),
('e1000000-0000-0000-0000-000000000002','a1b2c3d4-0000-0000-0000-000000000001','d1b2c3d4-0000-0000-0000-000000000002','Reinforcement Rods 16mm','Steel','tons',890000,12,15,'LOW'),
('e1000000-0000-0000-0000-000000000003','a1b2c3d4-0000-0000-0000-000000000001','d1b2c3d4-0000-0000-0000-000000000003','Sharp Sand','Aggregate','tons',28000,80,20,'OK'),
('e1000000-0000-0000-0000-000000000004','a1b2c3d4-0000-0000-0000-000000000001','d1b2c3d4-0000-0000-0000-000000000003','Granite 3/4 inch','Aggregate','tons',42000,45,20,'OK'),
('e1000000-0000-0000-0000-000000000005','a1b2c3d4-0000-0000-0000-000000000001',NULL,'Plywood 18mm','Timber','sheets',18500,8,20,'CRITICAL'),
('e1000000-0000-0000-0000-000000000006','a1b2c3d4-0000-0000-0000-000000000001','d1b2c3d4-0000-0000-0000-000000000002','BRC Mesh A142','Steel','rolls',125000,34,10,'OK');

-- Equipment
INSERT INTO equipment (id, company_id, name, type, serial_no, rate_per_hour, status, total_hours_logged, next_maintenance_at) VALUES
('f1000000-0000-0000-0000-000000000001','a1b2c3d4-0000-0000-0000-000000000001','CAT 320 Excavator','Earthworks','CAT320-2021-NG0045',45000,'IN_USE',142,NOW() + INTERVAL '2 days'),
('f1000000-0000-0000-0000-000000000002','a1b2c3d4-0000-0000-0000-000000000001','Concrete Mixer 500L','Concrete Works','CM500-2022-NG0018',8500,'AVAILABLE',380,NULL),
('f1000000-0000-0000-0000-000000000003','a1b2c3d4-0000-0000-0000-000000000001','Tower Crane TC6013','Lifting','TC6013-2020-NG0007',65000,'MAINTENANCE',210,NOW() + INTERVAL '1 day'),
('f1000000-0000-0000-0000-000000000004','a1b2c3d4-0000-0000-0000-000000000001','Diesel Generator 100kVA','Power','GEN100-2023-NG0032',12000,'IN_USE',760,NULL),
('f1000000-0000-0000-0000-000000000005','a1b2c3d4-0000-0000-0000-000000000001','Vibrating Rammer','Compaction','VR200-2022-NG0010',4500,'AVAILABLE',95,NULL);

-- Budgets for Lekki Phase II
INSERT INTO budgets (project_id, category, allocated, spent, period) VALUES
('c1b2c3d4-0000-0000-0000-000000000001','Materials',25000000,18500000,'Project-Total'),
('c1b2c3d4-0000-0000-0000-000000000001','Labour',12000000,9800000,'Project-Total'),
('c1b2c3d4-0000-0000-0000-000000000001','Equipment',8000000,7200000,'Project-Total'),
('c1b2c3d4-0000-0000-0000-000000000001','Transport',3000000,1400000,'Project-Total'),
('c1b2c3d4-0000-0000-0000-000000000001','Overhead',5000000,3000000,'Project-Total');

-- Sample expenses
INSERT INTO expenses (project_id, submitted_by_id, category, description, amount, status, approved_by_id, approved_at, expense_date) VALUES
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000001','Materials','Cement & Rods batch delivery',4250000,'APPROVED','b1b2c3d4-0000-0000-0000-000000000001',NOW(),NOW() - INTERVAL '2 days'),
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000001','Labour','Weekly wages payout — 42 workers',1800000,'APPROVED','b1b2c3d4-0000-0000-0000-000000000001',NOW(),NOW() - INTERVAL '3 days'),
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000002','Equipment','CAT excavator rental — 3 days',960000,'APPROVED','b1b2c3d4-0000-0000-0000-000000000001',NOW(),NOW() - INTERVAL '4 days'),
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000002','Transport','Material haulage from Apapa port',380000,'PENDING',NULL,NULL,NOW() - INTERVAL '1 day'),
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000001','Overhead','Site office rent + utilities',210000,'APPROVED','b1b2c3d4-0000-0000-0000-000000000001',NOW(),NOW() - INTERVAL '5 days');

-- Visitors
INSERT INTO visitors (project_id, logged_by_id, full_name, company, phone, purpose, time_in, time_out, duration_mins, status) VALUES
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000002','Engr. Emeka Obi','COREN','+234 810 000 0001','Structural Inspection',NOW() - INTERVAL '5 hours', NOW() - INTERVAL '2 hours', 195,'CHECKED_OUT'),
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000002','Mrs. Fatima Al-Hassan','Al-Hassan Developers','+234 820 000 0002','Client Site Visit',NOW() - INTERVAL '1 hour', NULL, NULL,'ON_SITE'),
('c1b2c3d4-0000-0000-0000-000000000001','b1b2c3d4-0000-0000-0000-000000000002','Mr. Tunde Adeyemi','Lagos Timber Co.','+234 830 000 0003','Supplier Delivery',NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours 25 minutes', 35,'CHECKED_OUT');

-- Notifications
INSERT INTO notifications (user_id, title, body, type, is_read) VALUES
('b1b2c3d4-0000-0000-0000-000000000001','🚨 Critical Stock: Plywood 18mm','Only 8 sheets remaining. Minimum threshold: 20 sheets.','STOCK_ALERT',FALSE),
('b1b2c3d4-0000-0000-0000-000000000001','⚠️ Low Stock: Reinforcement Rods 16mm','Only 12 tons remaining. Minimum threshold: 15 tons.','STOCK_ALERT',FALSE),
('b1b2c3d4-0000-0000-0000-000000000001','⚠️ Budget Alert: Equipment','Equipment budget at 90% utilisation on Lekki Phase II.','BUDGET_ALERT',FALSE),
('b1b2c3d4-0000-0000-0000-000000000001','🔧 Maintenance Due: Tower Crane TC6013','500-hour service due in 1 day.','MAINTENANCE_ALERT',FALSE);
