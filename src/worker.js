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
  user_id TEXT NOT NULL DEFAULT 'legacy',
  display_name TEXT,
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
CREATE INDEX IF NOT EXISTS ix_search_categories_user_id ON search_categories (user_id);

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
  const statements = SCHEMA_SQL.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter((statement) => !statement.includes("ix_search_categories_user_id"));

  for (const statement of statements) {
    await db.prepare(statement).run();
  }

  await ensureColumn(db, "search_categories", "user_id", "TEXT NOT NULL DEFAULT 'legacy'");
  await ensureColumn(db, "search_categories", "display_name", "TEXT");
  await db.prepare("CREATE INDEX IF NOT EXISTS ix_search_categories_user_id ON search_categories (user_id)").run();

  schemaReady = true;
}

async function ensureColumn(db, tableName, columnName, definition) {
  const info = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = info.results.some((column) => column.name === columnName);
  if (!exists) {
    await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function requestUserId(request) {
  const raw = request.headers.get("x-getjobhub-user-id") || "anonymous";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "anonymous";
}

function cleanText(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/Find more English Speaking Jobs in Germany on Arbeitnow/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeText(value, maxLength = 360) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 240 ? lastSpace : maxLength).trim()}...`;
}

function queryTerms(query) {
  return cleanText(query)
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1);
}

function queryVariants(query) {
  const normalized = queryTerms(query).join(" ");
  const variants = [normalized || cleanText(query).toLowerCase()];
  const compact = compactText(query);

  if (compact && compact !== normalized.replace(/\s+/g, "")) variants.push(compact);
  if (normalized === "full stack") variants.push("fullstack", "full-stack", "full stack developer");
  if (normalized === "front end") variants.push("frontend", "front-end");
  if (normalized === "back end") variants.push("backend", "back-end");

  return [...new Set(variants.filter(Boolean))].slice(0, 5);
}

function compactText(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "");
}

function relevanceScore(job, query) {
  const terms = queryTerms(query);
  if (!terms.length) return 10;

  const title = cleanText(job.title).toLowerCase();
  const tags = cleanText(Array.isArray(job.tags) ? job.tags.join(" ") : job.tags).toLowerCase();
  const meta = cleanText(
    `${job.company_name || job.company || ""} ${job.city || job.location || ""} ${job.source || ""}`,
  ).toLowerCase();
  const description = cleanText(job.description).toLowerCase();
  const phrase = terms.join(" ");
  const compactQuery = compactText(query);
  const haystackCompact = `${compactText(title)} ${compactText(tags)} ${compactText(description)}`;

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 4;
    else if (tags.includes(term)) score += 3;
    else if (meta.includes(term)) score += 1;
    else if (description.includes(term)) score += 0.5;
  }

  if (title.includes(phrase)) score += 5;
  if (tags.includes(phrase)) score += 3;
  if (description.includes(phrase)) score += 1;
  if (compactQuery && haystackCompact.includes(compactQuery)) score += 4;

  return score;
}

function matchesQuery(job, query) {
  const terms = queryTerms(query);
  if (!terms.length) return true;

  return relevanceScore(job, query) >= Math.max(3, terms.length * 2);
}

function softMatchesQuery(job, query) {
  const terms = queryTerms(query).filter((term) => term.length > 2);
  if (!terms.length) return true;

  const haystack = cleanText(`${job.title || ""} ${job.company_name || ""} ${job.description || ""}`).toLowerCase();
  const compactHaystack = compactText(haystack);
  const compactQuery = compactText(query);
  return terms.some((term) => haystack.includes(term)) || Boolean(compactQuery && compactHaystack.includes(compactQuery));
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
    description: summarizeText(row.description),
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
  const city = url.searchParams.get("city");
  const remote = url.searchParams.get("remote");
  const salaryMin = url.searchParams.get("salary_min");
  const sources = url.searchParams.getAll("source");

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
  const q = url.searchParams.get("q");
  const hasQuery = queryTerms(q).length > 0;
  const { where, params } = searchWhere(url);
  const joinWhere = [where.replace(/^WHERE\s*/, ""), extraWhere].filter(Boolean).join(" AND ");
  const whereSql = joinWhere ? `WHERE ${joinWhere}` : "";
  const queryLimit = hasQuery ? 500 : limit;
  const queryOffset = hasQuery ? 0 : offset;

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
    .bind(...params, ...extraParams, queryLimit, queryOffset)
    .all();

  const jobs = result.results.map(rowToJob);
  if (!hasQuery) return jobs;

  return jobs
    .filter((job) => matchesQuery(job, q))
    .sort((a, b) => relevanceScore(b, q) - relevanceScore(a, q))
    .slice(offset, offset + limit);
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
        summarizeText(item.description) || null,
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
      summarizeText(item.description) || null,
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
    description: summarizeText(job.description),
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
    description: summarizeText(job.description),
    posted_at: job.created_at ? new Date(job.created_at * 1000).toISOString() : null,
  };
}

function normalizeRemoteOk(job) {
  const salaryMin = Number(job.salary_min || 0) || null;
  const salaryMax = Number(job.salary_max || 0) || null;

  return {
    source: "remoteok",
    source_url: job.url || `https://remoteok.com/remote-jobs/${job.id}`,
    external_id: String(job.id || job.slug || job.url),
    title: job.position || job.title || "Untitled role",
    company_name: job.company || null,
    city: job.location || "Remote",
    remote: true,
    salary_raw: salaryMin || salaryMax ? `${salaryMin || ""} - ${salaryMax || ""}`.trim() : null,
    salary_min: salaryMin,
    salary_max: salaryMax,
    description: summarizeText(job.description),
    posted_at: job.date || null,
    tags: job.tags || [],
  };
}

function normalizeHimalayas(job) {
  const salaryMin = Number(job.minSalary || 0) || null;
  const salaryMax = Number(job.maxSalary || 0) || null;
  const currency = job.currency || "USD";
  const locations = Array.isArray(job.locationRestrictions)
    ? job.locationRestrictions.map((location) => location?.name).filter(Boolean)
    : [];

  return {
    source: "himalayas",
    source_url: job.applicationLink || job.url || `https://himalayas.app/jobs/${job.guid}`,
    external_id: String(job.guid || job.id || job.applicationLink),
    title: job.title || "Untitled role",
    company_name: job.companyName || job.company?.name || null,
    city: locations.length ? locations.join(", ") : "Worldwide",
    remote: true,
    salary_raw: salaryMin || salaryMax ? `${currency} ${salaryMin || 0} - ${salaryMax || salaryMin}` : null,
    salary_min: salaryMin,
    salary_max: salaryMax,
    description: summarizeText(job.description || job.excerpt),
    posted_at: parseDate(job.pubDate),
    tags: job.tags || [],
  };
}

function normalizeRemoteJobs(job) {
  const company = job.company || {};
  const salaryMin = Number(job.salary_min || 0) || null;
  const salaryMax = Number(job.salary_max || 0) || null;

  return {
    source: "remotejobs",
    source_url: job.apply_url || job.url,
    external_id: String(job.id || job.slug || job.url),
    title: job.title || "Untitled role",
    company_name: company.name || job.company_name || null,
    city: job.location || "Remote",
    remote: true,
    salary_raw: job.salary_text || null,
    salary_min: salaryMin,
    salary_max: salaryMax,
    description: summarizeText(job.description),
    posted_at: parseDate(job.posted_at),
    tags: job.tags || [],
  };
}

function parseDate(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value > 100000000000 ? value : value * 1000).toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "GetJobHub Cloudflare Worker" },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,uk;q=0.8",
      "user-agent": "Mozilla/5.0 GetJobHub Cloudflare Worker",
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractSalary(text) {
  return cleanText(text).match(/(\$?\d[\d\s]*(?:-|–|—)?\s*\$?\d*[\d\s]*\s*(?:грн|₴|USD|EUR|\$|€)?)/i)?.[1] || null;
}

function parseSalaryRange(salaryRaw) {
  const numbers = cleanText(salaryRaw)
    .replace(/[^\d\s.-]/g, " ")
    .split(/\s+/)
    .map(Number)
    .filter(Boolean);

  if (!numbers.length) return [null, null];
  return [Math.min(...numbers), Math.max(...numbers)];
}

function extractCity(text) {
  const lowered = cleanText(text).toLowerCase();
  return [
    "Kyiv",
    "Київ",
    "Lviv",
    "Львів",
    "Dnipro",
    "Дніпро",
    "Одеса",
    "Харків",
    "Remote",
    "Europe",
    "Worldwide",
  ].find((city) => lowered.includes(city.toLowerCase())) || null;
}

function isRemote(text) {
  const lowered = cleanText(text).toLowerCase();
  return ["remote", "remotely", "віддалено", "дистанційно"].some((token) => lowered.includes(token));
}

function normalizeWorkUaFromAnchor(match) {
  const href = match[1];
  const rawTitle = match[2];
  const sourceUrl = absoluteUrl("https://www.work.ua", href);
  const title = cleanText(rawTitle);
  if (!sourceUrl || !title || !/\/jobs\/\d+/i.test(sourceUrl)) return null;

  const salaryRaw = extractSalary(title);
  const [salaryMin, salaryMax] = parseSalaryRange(salaryRaw);
  return {
    source: "workua",
    source_url: sourceUrl,
    external_id: sourceUrl.match(/\/jobs\/(\d+)/)?.[1] || sourceUrl,
    title,
    company_name: null,
    city: extractCity(title),
    remote: isRemote(title),
    salary_raw: salaryRaw,
    salary_min: salaryMin,
    salary_max: salaryMax,
    description: null,
    posted_at: now(),
  };
}

function normalizeDouRssItem(item) {
  const title = cleanText(item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i)?.[1] || item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  const link = cleanText(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]);
  const description = summarizeText(item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i)?.[1] || "");
  if (!title || !link) return null;

  const cleanTitle = title.split(" в ")[0].split(" at ")[0];
  const company = title.includes(" в ") ? title.split(" в ").pop() : null;
  const text = `${title} ${description}`;
  return {
    source: "dou",
    source_url: link,
    external_id: link.replace(/\/$/, "").split("/").pop(),
    title: cleanTitle,
    company_name: company,
    city: extractCity(text),
    remote: isRemote(text),
    salary_raw: null,
    description,
    posted_at: parseDate(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]) || now(),
  };
}

function htmlContext(html, index) {
  const listStart = Math.max(
    html.lastIndexOf("<li", index),
    html.lastIndexOf("<article", index),
    html.lastIndexOf('<div class="job-list-item', index),
    html.lastIndexOf("<div", index),
  );
  const start = listStart >= 0 ? listStart : Math.max(0, index - 1200);
  const liEnd = html.indexOf("</li>", index);
  const articleEnd = html.indexOf("</article>", index);
  const divEnd = html.indexOf("</div>", index);
  const ends = [liEnd, articleEnd, divEnd].filter((value) => value > index);
  const end = ends.length ? Math.min(...ends) + 10 : Math.min(html.length, index + 2200);
  return html.slice(start, end);
}

function normalizeDjinniFromAnchor(match, html = "") {
  const href = match[1];
  const rawTitle = match[2];
  const context = html && Number.isInteger(match.index) ? htmlContext(html, match.index) : rawTitle;
  const sourceUrl = absoluteUrl("https://djinni.co", href);
  const title = cleanText(rawTitle).replace(/\s*\$\$\$\$?$/, "").trim();
  if (!sourceUrl || !title || title.toLowerCase() === "jobs" || !/\/jobs\/\d+/i.test(sourceUrl)) return null;

  const text = cleanText(context);
  const description = summarizeText(text.replace(title, "").trim());
  const salaryRaw = extractSalary(text);
  const [salaryMin, salaryMax] = parseSalaryRange(salaryRaw);
  return {
    source: "djinni",
    source_url: sourceUrl,
    external_id: sourceUrl.replace(/\/$/, "").split("/").pop(),
    title,
    company_name: text.match(/Company:\s*([^,]+)/i)?.[1]?.trim() || null,
    city: extractCity(text),
    remote: isRemote(text),
    salary_raw: salaryRaw,
    salary_min: salaryMin,
    salary_max: salaryMax,
    description,
    posted_at: now(),
  };
}

function uniqueByUrl(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    if (!job?.source_url || seen.has(job.source_url)) return false;
    seen.add(job.source_url);
    return true;
  });
}

async function scrapeWorkUa(query, pageLimit) {
  const jobs = [];
  for (const variant of queryVariants(query)) {
    for (let page = 1; page <= pageLimit; page += 1) {
      const slug = encodeURIComponent(variant.trim().replace(/\s+/g, "+"));
      const suffix = page > 1 ? `?page=${page}` : "";
      const html = await fetchText(`https://www.work.ua/jobs-${slug}/${suffix}`).catch(() => "");
      const matches = [...html.matchAll(/<a[^>]+href=["']([^"']*\/jobs\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      jobs.push(...matches.map(normalizeWorkUaFromAnchor).filter(Boolean));
    }
  }
  return uniqueByUrl(jobs).filter((job) => matchesQuery(job, query)).slice(0, 80);
}

async function scrapeDou(query) {
  const jobs = [];
  for (const variant of queryVariants(query)) {
    const rss = await fetchText(`https://jobs.dou.ua/vacancies/feeds/?search=${encodeURIComponent(variant)}`).catch(() => "");
    const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
    jobs.push(...items.map(normalizeDouRssItem).filter(Boolean));
  }
  return uniqueByUrl(jobs).filter((job) => softMatchesQuery(job, query)).slice(0, 80);
}

async function scrapeDjinni(query, pageLimit) {
  const jobs = [];
  for (const variant of queryVariants(query)) {
    for (let page = 1; page <= pageLimit; page += 1) {
      const slug = encodeURIComponent(variant.toLowerCase().trim().replace(/\s+/g, "-"));
      const html = await fetchText(`https://djinni.co/jobs/keyword-${slug}/?page=${page}`).catch(() => "");
      const matches = [...html.matchAll(/<a[^>]+href=["']([^"']*\/jobs\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      jobs.push(...matches.map((match) => normalizeDjinniFromAnchor(match, html)).filter(Boolean));
    }
  }
  return uniqueByUrl(jobs).filter((job) => softMatchesQuery(job, query)).slice(0, 80);
}

async function scrapeSources(db, url) {
  const query = url.searchParams.get("q") || "full stack";
  const pageLimit = Math.min(Number(url.searchParams.get("page_limit") || 1), 5);
  const requestedSources = new Set(url.searchParams.getAll("source"));
  const shouldScrape = (source) => requestedSources.size === 0 || requestedSources.has(source);
  const jobs = [];

  const remotiveUrl = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
  const arbeitnowUrl = `https://www.arbeitnow.com/api/job-board-api?page=${pageLimit}`;
  const remoteOkUrl = "https://remoteok.com/api";
  const himalayasUrl = `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(query)}&page=1`;
  const remoteJobsUrl = `https://remotejobs.org/api/v1/jobs?q=${encodeURIComponent(query)}&limit=50&offset=0`;

  const [workua, dou, djinni, remotive, arbeitnow, remoteok, himalayas, remotejobs] =
    await Promise.allSettled([
      shouldScrape("workua") ? scrapeWorkUa(query, pageLimit) : [],
      shouldScrape("dou") ? scrapeDou(query) : [],
      shouldScrape("djinni") ? scrapeDjinni(query, pageLimit) : [],
      shouldScrape("remotive") ? fetchJson(remotiveUrl) : null,
      shouldScrape("arbeitnow") ? fetchJson(arbeitnowUrl) : null,
      shouldScrape("remoteok") ? fetchJson(remoteOkUrl) : null,
      shouldScrape("himalayas") ? fetchJson(himalayasUrl) : null,
      shouldScrape("remotejobs") ? fetchJson(remoteJobsUrl) : null,
    ]);

  if (workua.status === "fulfilled") jobs.push(...workua.value);
  if (dou.status === "fulfilled") jobs.push(...dou.value);
  if (djinni.status === "fulfilled") jobs.push(...djinni.value);

  if (remotive.status === "fulfilled" && remotive.value) {
    jobs.push(
      ...(remotive.value.jobs || [])
        .map(normalizeRemotive)
        .filter((job) => matchesQuery(job, query))
        .slice(0, 80),
    );
  }

  if (arbeitnow.status === "fulfilled" && arbeitnow.value) {
    jobs.push(
      ...(arbeitnow.value.data || []).map(normalizeArbeitnow).filter((job) => matchesQuery(job, query)).slice(0, 80),
    );
  }

  if (remoteok.status === "fulfilled" && remoteok.value) {
    jobs.push(
      ...(remoteok.value || [])
        .filter((job) => job && !job.legal)
        .map(normalizeRemoteOk)
        .filter((job) => matchesQuery(job, query))
        .sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query))
        .slice(0, 80),
    );
  }

  if (himalayas.status === "fulfilled" && himalayas.value) {
    jobs.push(
      ...(himalayas.value.jobs || [])
        .map(normalizeHimalayas)
        .filter((job) => job.source_url && matchesQuery(job, query))
        .sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query))
        .slice(0, 80),
    );
  }

  if (remotejobs.status === "fulfilled" && remotejobs.value) {
    jobs.push(
      ...(remotejobs.value.data || [])
        .map(normalizeRemoteJobs)
        .filter((job) => job.source_url && matchesQuery(job, query))
        .sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query))
        .slice(0, 80),
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
    source: [...(requestedSources.size ? requestedSources : new Set(["workua", "dou", "djinni", "remotive", "arbeitnow", "remoteok", "himalayas", "remotejobs"]))].join(","),
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
    name: row.display_name || row.name,
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

async function listCategories(db, userId) {
  const result = await db
    .prepare("SELECT * FROM search_categories WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all();
  return json(await Promise.all(result.results.map((row) => categoryWithCounts(db, row))));
}

async function createCategory(db, request, userId) {
  const payload = await readJson(request);
  if (!payload.name || !payload.query) {
    return json({ detail: "name and query are required" }, { status: 422 });
  }

  const id = uuid();
  const timestamp = now();
  const displayName = String(payload.name).slice(0, 120);
  await db
    .prepare(
      `
      INSERT INTO search_categories (id, user_id, display_name, name, query, city, remote, salary_min, sources, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      id,
      userId,
      displayName,
      `${userId}:${displayName}:${id}`,
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

async function syncCategory(db, id, userId) {
  const category = await db
    .prepare("SELECT * FROM search_categories WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();
  if (!category) return notFound();

  const scrapeUrl = new URL("https://worker.local/api/v1/scrape/all");
  scrapeUrl.searchParams.set("q", category.query);
  if (category.sources) {
    category.sources.split(",").filter(Boolean).forEach((source) => scrapeUrl.searchParams.append("source", source));
  }
  const scrapeResponse = await scrapeSources(db, scrapeUrl);
  const scrapeResult = await scrapeResponse.json();

  const searchUrl = new URL("https://worker.local/api/v1/vacancies/search");
  searchUrl.searchParams.set("q", category.query);
  if (category.city) searchUrl.searchParams.set("city", category.city);
  if (category.remote !== null) searchUrl.searchParams.set("remote", category.remote ? "true" : "false");
  if (category.salary_min) searchUrl.searchParams.set("salary_min", category.salary_min);
  if (category.sources) {
    category.sources.split(",").filter(Boolean).forEach((source) => searchUrl.searchParams.append("source", source));
  }
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

async function stats(db, userId) {
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
      SELECT c.id, COALESCE(c.display_name, c.name) AS name, COUNT(cj.job_id) AS total,
        SUM(CASE WHEN date(cj.first_seen_at) = date('now') THEN 1 ELSE 0 END) AS new_today
      FROM search_categories c
      LEFT JOIN category_jobs cj ON cj.category_id = c.id
      WHERE c.user_id = ?
      GROUP BY c.id, c.name, c.display_name
      ORDER BY c.created_at DESC
      `,
    )
    .bind(userId)
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
  const userId = requestUserId(request);

  await ensureSchema(db);

  if (path === `${API_PREFIX}/ping`) {
    return json({ status: "ok", message: "GetJobHub Worker API is alive", storage: "d1" });
  }

  if (path === `${API_PREFIX}/stats` && request.method === "GET") return stats(db, userId);
  if (path === `${API_PREFIX}/scrape/all` && request.method === "POST") return scrapeSources(db, url);
  if (path === `${API_PREFIX}/vacancies/search` && request.method === "GET") {
    return json(await listJobs(db, url));
  }

  if (path === `${API_PREFIX}/categories` && request.method === "GET") return listCategories(db, userId);
  if (path === `${API_PREFIX}/categories` && request.method === "POST") {
    return createCategory(db, request, userId);
  }

  const categoryMatch = path.match(/^\/api\/v1\/categories\/([^/]+)(?:\/(sync|vacancies))?$/);
  if (categoryMatch) {
    const [, id, action] = categoryMatch;
    if (!action && request.method === "DELETE") {
      await db.prepare("DELETE FROM search_categories WHERE id = ? AND user_id = ?").bind(id, userId).run();
      return noContent();
    }
    if (action === "sync" && request.method === "POST") return syncCategory(db, id, userId);
    if (action === "vacancies" && request.method === "GET") {
      const category = await db
        .prepare("SELECT id FROM search_categories WHERE id = ? AND user_id = ?")
        .bind(id, userId)
        .first();
      if (!category) return notFound();
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
