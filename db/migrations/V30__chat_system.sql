-- One room per project (created automatically when project is created)
CREATE TABLE chat_rooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages
CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id     UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id),
  type        VARCHAR(20) NOT NULL DEFAULT 'TEXT'
              CHECK (type IN ('TEXT','VOICE','FILE','IMAGE','SYSTEM')),
  content     TEXT,         -- text content or transcription
  file_url    TEXT,         -- Cloudinary URL for voice/file/image
  file_name   TEXT,
  file_size   BIGINT,
  duration    INTEGER,      -- voice note duration in seconds
  reply_to_id UUID REFERENCES chat_messages(id),  -- reply threading
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_room_id  ON chat_messages(room_id, created_at DESC);
CREATE INDEX idx_chat_messages_sender   ON chat_messages(sender_id);

-- Read receipts
CREATE TABLE chat_read_receipts (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id     UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, room_id)
);

-- Reactions
CREATE TABLE chat_reactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       VARCHAR(10) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);