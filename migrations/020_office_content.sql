CREATE TABLE IF NOT EXISTS office_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  document_kind TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  version_no INTEGER NOT NULL DEFAULT 1,
  published_by TEXT,
  published_at TEXT,
  archived_by TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_document_versions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  UNIQUE(document_id, version_no),
  FOREIGN KEY (document_id) REFERENCES office_documents(id)
);

CREATE TABLE IF NOT EXISTS office_document_reads (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  UNIQUE(document_id, user_id),
  FOREIGN KEY (document_id) REFERENCES office_documents(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_office_documents_scope
  ON office_documents(company_id, store_id, document_kind, status, published_at);
