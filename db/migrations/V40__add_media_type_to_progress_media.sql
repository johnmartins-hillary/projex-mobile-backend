-- V38: Add media_type and media_url to progress_photos
-- Supports both photos and videos, upload handled server-side

ALTER TABLE progress_photos
  ADD COLUMN IF NOT EXISTS media_type  VARCHAR(10)  NOT NULL DEFAULT 'photo'
    CHECK (media_type IN ('photo', 'video')),
  ADD COLUMN IF NOT EXISTS media_url   TEXT,        -- unified URL (replaces photo_url for new records)
  ADD COLUMN IF NOT EXISTS public_id   TEXT,        -- Cloudinary public_id for deletion
  ADD COLUMN IF NOT EXISTS duration    INTEGER;     -- video duration in seconds

-- Backfill media_url from photo_url for existing records
UPDATE progress_photos SET media_url = photo_url WHERE media_url IS NULL AND photo_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_progress_photos_media_type ON progress_photos(project_id, media_type);