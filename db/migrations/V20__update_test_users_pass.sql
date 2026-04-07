-- V20__update_test_users_pass.sql
-- Update test users password to: Test1234

UPDATE users SET password_hash = '$2a$12$WhHWN6jKB0QN4bgkO.FGOerQPb413Gi3PWVeDAomIPAwyPax6jo7y'
WHERE email IN (
  'admin@okafor-construction.ng',
  'sitemanager@okafor-construction.ng',
  'qs@okafor-construction.ng',
  'accountant@okafor-construction.ng'
);