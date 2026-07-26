-- Add HIRED status values to the equipment_status enum
-- Run this before creating any HIRED equipment

ALTER TYPE equipment_status ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE equipment_status ADD VALUE IF NOT EXISTS 'RETURNED';