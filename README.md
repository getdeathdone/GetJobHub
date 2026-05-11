# GetJobHub

GetJobHub is a job-market dashboard that searches multiple job sources, normalizes vacancies into one format, stores matched jobs in Cloudflare D1, and shows the indexed market through dashboards, saved jobs, pinned searches, and a market map.

The production app runs without a separate Python backend: Cloudflare Workers serve both the frontend and the API.

## Developer

- Name: Nikita Shamrai
- GitHub: [getdeathdone](https://github.com/getdeathdone)
- LinkedIn: [jolynike](https://www.linkedin.com/in/jolynike/)
- Email: [jolynike@gmail.com](mailto:jolynike@gmail.com)

## What Is Inside

- `static/index.html` - application layout and views.
- `static/styles.css` - responsive UI styling.
- `static/app.js` - browser-side app logic, search flow, charts, source filters, market map rendering.
- `src/worker.js` - Cloudflare Worker API for `/api/v1/*`.
- `migrations/0001_init.sql` - Cloudflare D1 database schema.
- `wrangler.jsonc` - Cloudflare Worker, static assets, and D1 binding config.
- `app/` - legacy/local FastAPI implementation with Python scrapers, SQLAlchemy models, services, and Celery tasks.

## Production Stack

- Frontend: vanilla HTML, CSS, JavaScript.
- Runtime: Cloudflare Workers.
- Database: Cloudflare D1.
- Static hosting: Cloudflare Workers Static Assets from `static/`.
- Job sources:
  - Work.ua - Worker HTML adapter.
  - DOU - Worker RSS adapter.
  - Djinni - Worker HTML adapter.
  - Remotive - public API.
  - Arbeitnow - public API.
  - RemoteOK - public API.
  - Himalayas - public search API.
  - RemoteJobs - public keyword API.

## Main Features

- Search vacancies across selected sources.
- Choose exactly which providers to query.
- Save vacancies to Favorites.
- Save searches as pinned categories.
- Sync saved categories.
- Overview with indexed vacancy counts, salary buckets, and provider mix.
- Market Map view that groups indexed vacancies into broad job families.
- Expand Index action that runs several popular searches to populate D1 faster.

## How Search Works

GetJobHub does not claim to know every vacancy on every provider at all times. It builds its own index as searches run.

1. The user selects sources and enters a query.
2. The Worker fetches fresh results from the selected job sources.
3. Results are cleaned and normalized into one vacancy shape.
4. Vacancies are scored against the query.
5. Matched vacancies are stored in D1 and deduplicated by `source_url`.
6. The UI reads from the D1 index for charts, saved jobs, categories, and the market map.

This means Overview numbers show indexed vacancies, not the entire live internet.

## API Endpoints

The Worker handles these routes:

```txt
GET    /api/v1/ping
GET    /api/v1/stats
POST   /api/v1/scrape/all
GET    /api/v1/vacancies/search
GET    /api/v1/categories
POST   /api/v1/categories
DELETE /api/v1/categories/:categoryId
POST   /api/v1/categories/:categoryId/sync
GET    /api/v1/categories/:categoryId/vacancies
GET    /api/v1/saved
POST   /api/v1/saved/:jobId
DELETE /api/v1/saved/:jobId
```

Example:

```bash
curl "https://getjobhub.jolynike.workers.dev/api/v1/vacancies/search?q=python&source=djinni"
```

## Cloudflare Setup

Create the D1 database:

```bash
npx wrangler d1 create getjobhub-db
```

Put the returned `database_id` into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "getjobhub-db",
    "database_id": "YOUR_DATABASE_ID"
  }
]
```

Apply the schema:

```bash
npx wrangler d1 migrations apply getjobhub-db --remote
```

Deploy:

```bash
npx wrangler deploy
```

## Local Worker Development

Install Node.js first. On macOS:

```bash
brew install node
```

Run local D1 migrations:

```bash
npx wrangler d1 migrations apply getjobhub-db --local
```

Start the Worker locally:

```bash
npx wrangler dev
```

Open:

```txt
http://localhost:8787
```

Check the API:

```txt
http://localhost:8787/api/v1/ping
```

## Legacy Python Backend

The `app/` folder contains the original FastAPI backend. It is useful for local experiments or as a reference implementation, but it is not required for the Cloudflare production deployment.

Run it locally:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install .
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open:

```txt
http://127.0.0.1:8000
```

## Notes

- HTML-based providers can be brittle because their page markup may change.
- If a provider fails, the Worker keeps the other providers running.
- The D1 index grows when users search or click Expand Index.
- Existing D1 rows are updated by `source_url`, so repeated searches deduplicate results.
