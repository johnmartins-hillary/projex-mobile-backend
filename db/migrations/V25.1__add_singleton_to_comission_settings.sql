ALTER TABLE commission_settings ADD COLUMN IF NOT EXISTS singleton BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS commission_settings_singleton ON commission_settings (singleton);