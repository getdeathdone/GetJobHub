const API_PREFIX = "/api/v1";
const DEFAULT_LIMIT = 50;
let schemaReady = false;

const SCHEMA_SQL = `
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
`;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function noContent() {
  return new Response(null, { status: 204 });
}

function notFound() {
  return json({ detail: "Not found" }, { status: 404 });
}

function dbUnavailable() {
  return json(
    {
      detail:
        "Cloudflare D1 is not bound. Create a D1 database, apply migrations, and bind it as DB.",
    },
    { status: 503 },
  );
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA_SQL);
  schemaReady = true;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

async function readJson(request) {
  if (!request.body) return {};
  return request.json().catch(() => ({}));
}

function rowToJob(row) {
  return {
    internal_id: row.internal_id,
    source: row.source,
    source_url: row.source_url,
    external_id: row.external_id,
    title: row.title,
    company_name: row.company_name,
    city: row.city,
    remote: Boolean(row.remote),
    salary_raw: row.salary_raw,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    description: row.description,
    description_hash: row.description_hash,
    posted_at: row.posted_at,
    scraped_at: row.scraped_at,
    updated_at: row.updated_at,
    is_saved: Boolean(row.is_saved),
  };
}

function searchWhere(url) {
  const clauses = [];
  const params = [];
  const q = url.searchParams.get("q");
  const city = url.searchParams.get("city");
  const remote = url.searchParams.get("remote");
  const salaryMin = url.searchParams.get("salary_min");
  const sources = url.searchParams.getAll("source");

  if (q) {
    clauses.push("(lower(j.title) LIKE ? OR lower(j.company_name) LIKE ? OR lower(j.description) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like);
  }

  if (city) {
    clauses.push("lower(j.city) LIKE ?");
    params.push(`%${city.toLowerCase()}%`);
  }

  if (remote === "true" || remote === "false") {
    clauses.push("j.remote = ?");
    params.push(remote === "true" ? 1 : 0);
  }

  if (salaryMin) {
    clauses.push("(j.salary_min IS NULL OR j.salary_min >= ? OR j.salary_max >= ?)");
    params.push(Number(salaryMin), Number(salaryMin));
  }

  if (sources.length) {
    clauses.push(`j.source IN (${sources.map(() => "?").join(", ")})`);
    params.push(...sources);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

async function listJobs(db, url, extraWhere = "", extraParams = []) {
  const limit = Math.min(Number(url.searchParams.get("limit") || DEFAULT_LIMIT), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  const { where, params } = searchWhere(url);
  const joinWhere = [where.replace(/^WHERE\s*/, ""), extraWhere].filter(Boolean).join(" AND ");
  const whereSql = joinWhere ? `WHERE ${joinWhere}` : "";

  const result = await db
    .prepare(
      `
      SELECT j.*, CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS is_saved
      FROM jobs j
      LEFT JOIN saved_jobs s ON s.job_id = j.internal_id
      ${whereSql}
      ORDER BY COALESCE(j.posted_at, j.scraped_at) DESC
      LIMIT ? OFFSET ?
      `,
    )
    .bind(...params, ...extraParams, limit, offset)
    .all();

  return result.results.map(rowToJob);
}

async function upsertJob(db, item) {
  const timestamp = now();
  const existing = await db
    .prepare("SELECT internal_id FROM jobs WHERE source_url = ?")
    .bind(item.source_url)
    .first();

  if (existing) {
    await db
      .prepare(
        `
        UPDATE jobs
        SET source = ?, external_id = ?, title = ?, company_name = ?, city = ?, remote = ?,
            salary_raw = ?, salary_min = ?, salary_max = ?, description = ?,
            description_hash = ?, posted_at = ?, updated_at = ?
        WHERE internal_id = ?
        `,
      )
      .bind(
        item.source,
        item.external_id || null,
        item.title,
        item.company_name || null,
        item.city || null,
        item.remote ? 1 : 0,
        item.salary_raw || null,
        item.salary_min || null,
        item.salary_max || null,
        item.description || null,
        item.description_hash || null,
        item.posted_at || null,
        timestamp,
        existing.internal_id,
      )
      .run();
    return { id: existing.internal_id, created: false };
  }

  const id = uuid();
  await db
    .prepare(
      `
      INSERT INTO jobs (
        internal_id, source, source_url, external_id, title, company_name, city, remote,
        salary_raw, salary_min, salary_max, description, description_hash, posted_at,
        scraped_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      id,
      item.source,
      item.source_url,
      item.external_id || null,
      item.title,
      item.company_name || null,
      item.city || null,
      item.remote ? 1 : 0,
      item.salary_raw || null,
      item.salary_min || null,
      item.salary_max || null,
      item.description || null,
      item.description_hash || null,
      item.posted_at || null,
      timestamp,
      timestamp,
    )
    .run();

  return { id, created: true };
}

function normalizeRemotive(job) {
  return {
    source: "remotive",
    source_url: job.url,
    external_id: String(job.id || job.url),
    title: job.title || "Untitled role",
    company_name: job.company_name || null,
    city: job.candidate_required_location || "Remote",
    remote: true,
    salary_raw: job.salary || null,
    description: (job.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    posted_at: job.publication_date || null,
  };
}

function normalizeArbeitnow(job) {
  return {
    source: "arbeitnow",
    source_url: job.url,
    external_id: job.slug || job.url,
    title: job.title || "Untitled role",
    company_name: job.company_name || null,
    city: job.location || "Remote",
    remote: Boolean(job.remote),
    salary_raw: null,
    description: (job.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    posted_at: job.created_at ? new Date(job.created_at * 1000).toISOString() : null,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "GetJobHub Cloudflare Worker" },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function scrapeSources(db, url) {
  const query = url.searchParams.get("q") || "full stack";
  const pageLimit = Math.min(Number(url.searchParams.get("page_limit") || 1), 5);
  const jobs = [];

  const remotiveUrl = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
  const arbeitnowUrl = `https://www.arbeitnow.com/api/job-board-api?page=${pageLimit}`;

  const [remotive, arbeitnow] = await Promise.allSettled([
    fetchJson(remotiveUrl),
    fetchJson(arbeitnowUrl),
  ]);

  if (remotive.status === "fulfilled") {
    jobs.push(...(remotive.value.jobs || []).slice(0, 80).map(normalizeRemotive));
  }

  if (arbeitnow.status === "fulfilled") {
    jobs.push(
      ...(arbeitnow.value.data || [])
        .filter((job) => `${job.title} ${job.description}`.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 80)
        .map(normalizeArbeitnow),
    );
  }

  let created = 0;
  let updated = 0;
  for (const job of jobs) {
    const result = await upsertJob(db, job);
    created += result.created ? 1 : 0;
    updated += result.created ? 0 : 1;
  }

  return json({
    source: "remotive,arbeitnow",
    parsed: jobs.length,
    created,
    updated,
  });
}

async function categoryWithCounts(db, row) {
  const counts = await db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN date(cj.first_seen_at) = date('now') THEN 1 ELSE 0 END) AS new_today
      FROM category_jobs cj
      WHERE cj.category_id = ?
      `,
    )
    .bind(row.id)
    .first();

  return {
    id: row.id,
    name: row.name,
    query: row.query,
    city: row.city,
    remote: row.remote === null ? null : Boolean(row.remote),
    salary_min: row.salary_min,
    sources: row.sources ? row.sources.split(",").filter(Boolean) : null,
    created_at: row.created_at,
    last_synced_at: row.last_synced_at,
    total: counts.total || 0,
    new_today: counts.new_today || 0,
  };
}

async function listCategories(db) {
  const result = await db.prepare("SELECT * FROM search_categories ORDER BY created_at DESC").all();
  return json(await Promise.all(result.results.map((row) => categoryWithCounts(db, row))));
}

async function createCategory(db, request) {
  const payload = await readJson(request);
  if (!payload.name || !payload.query) {
    return json({ detail: "name and query are required" }, { status: 422 });
  }

  const id = uuid();
  const timestamp = now();
  await db
    .prepare(
      `
      INSERT INTO search_categories (id, name, query, city, remote, salary_min, sources, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      id,
      String(payload.name).slice(0, 120),
      String(payload.query).slice(0, 255),
      payload.city || null,
      payload.remote === null || payload.remote === undefined ? null : payload.remote ? 1 : 0,
      payload.salary_min || null,
      Array.isArray(payload.sources) ? payload.sources.join(",") : null,
      timestamp,
    )
    .run();

  const row = await db.prepare("SELECT * FROM search_categories WHERE id = ?").bind(id).first();
  return json(await categoryWithCounts(db, row), { status: 201 });
}

async function syncCategory(db, id) {
  const category = await db.prepare("SELECT * FROM search_categories WHERE id = ?").bind(id).first();
  if (!category) return notFound();

  const scrapeUrl = new URL("https://worker.local/api/v1/scrape/all");
  scrapeUrl.searchParams.set("q", category.query);
  const scrapeResponse = await scrapeSources(db, scrapeUrl);
  const scrapeResult = await scrapeResponse.json();

  const searchUrl = new URL("https://worker.local/api/v1/vacancies/search");
  searchUrl.searchParams.set("q", category.query);
  if (category.city) searchUrl.searchParams.set("city", category.city);
  if (category.remote !== null) searchUrl.searchParams.set("remote", category.remote ? "true" : "false");
  if (category.salary_min) searchUrl.searchParams.set("salary_min", category.salary_min);
  searchUrl.searchParams.set("limit", "100");

  const jobs = await listJobs(db, searchUrl);
  let linked = 0;
  const timestamp = now();

  for (const job of jobs) {
    const result = await db
      .prepare(
        `
        INSERT OR IGNORE INTO category_jobs (id, category_id, job_id, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
        `,
      )
      .bind(uuid(), id, job.internal_id, timestamp, timestamp)
      .run();
    linked += result.meta.changes || 0;

    await db
      .prepare("UPDATE category_jobs SET last_seen_at = ? WHERE category_id = ? AND job_id = ?")
      .bind(timestamp, id, job.internal_id)
      .run();
  }

  await db
    .prepare("UPDATE search_categories SET last_synced_at = ? WHERE id = ?")
    .bind(timestamp, id)
    .run();

  return json({
    category_id: id,
    parsed: scrapeResult.parsed,
    created: scrapeResult.created,
    updated: scrapeResult.updated,
    linked,
  });
}

async function stats(db) {
  const total = await db.prepare("SELECT COUNT(*) AS total FROM jobs").first();
  const saved = await db.prepare("SELECT COUNT(*) AS total FROM saved_jobs").first();
  const bySource = await db
    .prepare(
      `
      SELECT source, COUNT(*) AS total,
        SUM(CASE WHEN date(scraped_at) = date('now') THEN 1 ELSE 0 END) AS today
      FROM jobs
      GROUP BY source
      ORDER BY total DESC
      `,
    )
    .all();
  const categories = await db
    .prepare(
      `
      SELECT c.id, c.name, COUNT(cj.job_id) AS total,
        SUM(CASE WHEN date(cj.first_seen_at) = date('now') THEN 1 ELSE 0 END) AS new_today
      FROM search_categories c
      LEFT JOIN category_jobs cj ON cj.category_id = c.id
      GROUP BY c.id, c.name
      ORDER BY c.created_at DESC
      `,
    )
    .all();

  const salaryRanges = await db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN salary_min < 1000 THEN 1 ELSE 0 END) AS under_1k,
        SUM(CASE WHEN salary_min >= 1000 AND salary_min < 3000 THEN 1 ELSE 0 END) AS between_1k_3k,
        SUM(CASE WHEN salary_min >= 3000 THEN 1 ELSE 0 END) AS over_3k
      FROM jobs
      `,
    )
    .first();

  return json({
    total: total.total || 0,
    saved_total: saved.total || 0,
    by_source: bySource.results.map((row) => ({
      source: row.source,
      total: row.total || 0,
      today: row.today || 0,
    })),
    salary_ranges: [
      { label: "< $1k", count: salaryRanges.under_1k || 0 },
      { label: "$1k-$3k", count: salaryRanges.between_1k_3k || 0 },
      { label: "$3k+", count: salaryRanges.over_3k || 0 },
    ],
    categories: categories.results.map((row) => ({
      id: row.id,
      name: row.name,
      total: row.total || 0,
      new_today: row.new_today || 0,
    })),
  });
}

async function handleApi(request, env) {
  if (!env.DB) return dbUnavailable();

  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;

  await ensureSchema(db);

  if (path === `${API_PREFIX}/ping`) {
    return json({ status: "ok", message: "GetJobHub Worker API is alive", storage: "d1" });
  }

  if (path === `${API_PREFIX}/stats` && request.method === "GET") return stats(db);
  if (path === `${API_PREFIX}/scrape/all` && request.method === "POST") return scrapeSources(db, url);
  if (path === `${API_PREFIX}/vacancies/search` && request.method === "GET") {
    return json(await listJobs(db, url));
  }

  if (path === `${API_PREFIX}/categories` && request.method === "GET") return listCategories(db);
  if (path === `${API_PREFIX}/categories` && request.method === "POST") {
    return createCategory(db, request);
  }

  const categoryMatch = path.match(/^\/api\/v1\/categories\/([^/]+)(?:\/(sync|vacancies))?$/);
  if (categoryMatch) {
    const [, id, action] = categoryMatch;
    if (!action && request.method === "DELETE") {
      await db.prepare("DELETE FROM search_categories WHERE id = ?").bind(id).run();
      return noContent();
    }
    if (action === "sync" && request.method === "POST") return syncCategory(db, id);
    if (action === "vacancies" && request.method === "GET") {
      return json(await listJobs(db, url, "j.internal_id IN (SELECT job_id FROM category_jobs WHERE category_id = ?)", [id]));
    }
  }

  if (path === `${API_PREFIX}/saved` && request.method === "GET") {
    const result = await db
      .prepare(
        `
        SELECT s.id, s.saved_at, s.notes, j.*, 1 AS is_saved
        FROM saved_jobs s
        JOIN jobs j ON j.internal_id = s.job_id
        ORDER BY s.saved_at DESC
        `,
      )
      .all();
    return json(
      result.results.map((row) => ({
        id: row.id,
        saved_at: row.saved_at,
        notes: row.notes,
        job: rowToJob(row),
      })),
    );
  }

  const savedMatch = path.match(/^\/api\/v1\/saved\/([^/]+)$/);
  if (savedMatch) {
    const jobId = savedMatch[1];
    if (request.method === "POST") {
      const payload = await readJson(request);
      await db
        .prepare("INSERT OR REPLACE INTO saved_jobs (id, job_id, notes, saved_at) VALUES (?, ?, ?, ?)")
        .bind(uuid(), jobId, payload.notes || null, now())
        .run();
      return json({ status: "saved" });
    }
    if (request.method === "DELETE") {
      await db.prepare("DELETE FROM saved_jobs WHERE job_id = ?").bind(jobId).run();
      return noContent();
    }
  }

  return notFound();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        return json(
          {
            detail: error instanceof Error ? error.message : "Internal Worker error",
          },
          { status: 500 },
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
