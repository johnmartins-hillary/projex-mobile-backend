CREATE TABLE progress_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  photo_url TEXT NOT NULL,
  thumbnail_url TEXT,
  location VARCHAR(255),
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  taken_by_id UUID REFERENCES users(id),
  category VARCHAR(50) DEFAULT 'GENERAL',
  tags TEXT[],
  is_milestone BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_progress_photos_project_id ON progress_photos(project_id);
CREATE INDEX idx_progress_photos_taken_at ON progress_photos(taken_at);
CREATE INDEX idx_progress_photos_company_id ON progress_photos(company_id);