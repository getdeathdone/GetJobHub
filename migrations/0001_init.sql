CREATE TABLE IF NOT EXISTS jobs (
  internal_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  external_id TEXT,
  title TEXT NOT NULL,
  company_name TEXT,
  city TEXT,
  remote INTEGER NOT NULL DEFAULT 0,
  salary_raw TEXT,
  salary_min REAL,
  salary_max REAL,
  description TEXT,
  description_hash TEXT,
  posted_at TEXT,
  scraped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_jobs_title_company ON jobs (title, company_name);
CREATE INDEX IF NOT EXISTS ix_jobs_source_posted ON jobs (source, posted_at);
CREATE INDEX IF NOT EXISTS ix_jobs_source ON jobs (source);
CREATE INDEX IF NOT EXISTS ix_jobs_city ON jobs (city);
CREATE INDEX IF NOT EXISTS ix_jobs_remote ON jobs (remote);

CREATE TABLE IF NOT EXISTS saved_jobs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  notes TEXT,
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs (internal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_saved_jobs_job_id ON saved_jobs (job_id);

CREATE TABLE IF NOT EXISTS search_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL,
  city TEXT,
  remote INTEGER,
  salary_min REAL,
  sources TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_search_categories_name ON search_categories (name);
CREATE INDEX IF NOT EXISTS ix_search_categories_query ON search_categories (query);

CREATE TABLE IF NOT EXISTS category_jobs (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (category_id, job_id),
  FOREIGN KEY (category_id) REFERENCES search_categories (id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs (internal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_category_jobs_category_id ON category_jobs (category_id);
CREATE INDEX IF NOT EXISTS ix_category_jobs_job_id ON category_jobs (job_id);
