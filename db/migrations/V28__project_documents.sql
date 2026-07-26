-- Enable uuid extension if not already
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Project Documents ─────────────────────────────────────────
CREATE TABLE project_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by_id  UUID NOT NULL REFERENCES users(id),
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  category        VARCHAR(50) NOT NULL DEFAULT 'OTHER'
                  CHECK (category IN ('DRAWING','CONTRACT','BOQ','SPECIFICATION','REPORT','PERMIT','OTHER')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_documents_project_id  ON project_documents(project_id);
CREATE INDEX idx_project_documents_company_id  ON project_documents(company_id);
CREATE INDEX idx_project_documents_category    ON project_documents(category);

CREATE TRIGGER trg_project_documents_updated_at
  BEFORE UPDATE ON project_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Document Versions ─────────────────────────────────────────
CREATE TABLE document_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id     UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  uploaded_by_id  UUID NOT NULL REFERENCES users(id),
  version_number  INTEGER NOT NULL,
  file_url        TEXT NOT NULL,
  file_name       VARCHAR(255) NOT NULL,
  file_size       BIGINT NOT NULL,       -- bytes
  file_type       VARCHAR(100) NOT NULL, -- mime type
  public_id       TEXT NOT NULL,         -- Cloudinary public_id for deletion
  notes           TEXT,                  -- revision notes
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (document_id, version_number)
);

CREATE INDEX idx_document_versions_document_id ON document_versions(document_id);
CREATE INDEX idx_document_versions_is_current  ON document_versions(document_id, is_current);