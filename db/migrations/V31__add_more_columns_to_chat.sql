-- Add columns to chat_messages
ALTER TABLE chat_messages 
  ADD COLUMN IF NOT EXISTS group_id    UUID,
  ADD COLUMN IF NOT EXISTS is_edited   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edited_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mentions    JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS thumb_url   TEXT,        -- video thumbnail
  ADD COLUMN IF NOT EXISTS media_width  INTEGER,    -- image/video width px
  ADD COLUMN IF NOT EXISTS media_height INTEGER;   -- image/video height px

-- Index for group fetching
CREATE INDEX IF NOT EXISTS idx_chat_messages_group_id ON chat_messages(group_id);

-- Update type check to include VIDEO
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_type_check
  CHECK (type IN ('TEXT','VOICE','FILE','IMAGE','VIDEO','SYSTEM'));