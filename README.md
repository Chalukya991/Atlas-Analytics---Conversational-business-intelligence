# Atlas Analytics

Conversational business intelligence over spreadsheets. Upload CSV or Excel files, ask questions in plain English, and get answers that are **computed deterministically** by a Python engine and **explained** by an LLM whose narrative is verified against the numbers before it reaches the user.

```
 React (Vite)  ──►  Express API  ──►  BullMQ / Redis  ──►  Worker
                         │                                  │
                    PostgreSQL                 ┌────────────┴────────────┐
                                               │  LLM planner (Qwen /    │
                                               │  any Ollama or OpenAI-  │
                                               │  compatible model)      │
                                               │      ▼                  │
                                               │  Python engine          │
                                               │  (validate plan →       │
                                               │   compute → warnings)   │
                                               │      ▼                  │
                                               │  LLM explainer          │
                                               │  → numeric grounding    │
                                               └─────────────────────────┘
```

## How an answer is produced

1. **Inspect** – on upload the engine profiles every sheet: column types, fill rates, currencies, percent columns, ambiguous date formats, data-quality issues, preview rows. Multi-sheet workbooks become one dataset per sheet.
2. **Plan** – the LLM turns the question (plus the last few questions for follow-ups) into a JSON plan constrained by a schema: `describe | aggregate | top | time_series | compare | distribution`.
3. **Validate** – Node normalizes aliases; the Python engine resolves every column name against the real header and rejects anything unknown with a message that is fed back to the model for a re-plan (up to `PLAN_ATTEMPTS`).
4. **Compute** – pure Python, no code execution. Every result carries `warnings` (dropped non-numeric values, blank groups, ambiguous dates, empty filters, truncation) and `provenance`.
5. **Explain** – the LLM writes summary, highlights, KPIs and follow-ups from the results only. Every number in the narrative is checked against the results; ungrounded highlights are removed and the card says so. If the LLM is unavailable a deterministic summary is produced instead.
6. **Report** – PDF, Excel or Word documents render every result kind with charts, paginated tables and the verified narrative.

## Requirements

- Node.js 20+
- Python 3.11+ (`python-calamine` for Excel)
- PostgreSQL 14+
- Redis 6+
- An LLM endpoint: Ollama (default, `qwen3:8b` recommended minimum) or any OpenAI-compatible chat API

## Quick start (local)

```bash
# 1. Infrastructure (or use your own Postgres / Redis)
docker compose up -d postgres redis

# 2. Configuration
cp .env.example server/.env          # then set SECRET_KEY, DATABASE_URL, OLLAMA_URL, QWEN_MODEL
cp client/.env.example client/.env   # VITE_API_URL

# 3. Dependencies
npm run install:all

# 4. Database
npm run migrate

# 5. Run (three terminals)
npm run dev:server     # API on :4000 (also runs workers in-process while RUN_WORKERS=true)
npm run dev:client     # UI on :5173
```

Open http://localhost:5173, create an account, create a project, drop in a spreadsheet and ask.

## Production

```bash
docker compose up -d --build
```

This starts Postgres, Redis, the API (with migrations), a separate worker process and the static web app behind nginx. Set `SECRET_KEY` (≥ 32 random chars), `CORS_ORIGIN`, `OLLAMA_URL`/`LLM_*` and, if you terminate TLS at a proxy, `TRUST_PROXY=true` in `server/.env`. Scale workers with `docker compose up -d --scale worker=3`.

Operational notes:

- `/health` reports database and Redis status (503 when degraded).
- Logs are JSON in production (`LOG_LEVEL` to tune).
- Uploaded files live under `STORAGE_PATH/uploads`; parsed tables are cached in `STORAGE_PATH/cache` keyed by file mtime.
- Analysis and file jobs carry `stage` / `status` / `error` so the UI never spins forever.
- Sign-out revokes the JWT server-side (Redis denylist) and tokens expire after `TOKEN_TTL`.

## Tests

```bash
npm test                  # Python engine (pytest) + server unit tests (jest)
npm run smoke             # end-to-end against a running stack (needs DB, Redis, LLM)
```

| Suite | What it covers |
| --- | --- |
| `python_engine/tests` | number/date parsing edge cases, plan normalization and column resolution, every operation, warnings, CLI protocol, cache invalidation |
| `server/tests/unit` | plan schema aliases and rejections, numeric grounding of narratives, report renderers for every result kind, deterministic fallback explanations, CSV export |
| `server/tests/smoke` | register → project → upload → ask → poll → report download |

## Repository layout

```
client/          React 19 + Vite, design tokens with light/dark theme, custom SVG charts
server/          Express API, BullMQ workers, LLM providers, plan schema, report renderers, migrations
python_engine/   Deterministic analysis engine (CLI: inspect | preview | analyze)
```

## API

All routes are under `/api/v1` and require `Authorization: Bearer <jwt>` except register/login.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/password` | accounts and sessions |
| GET | `/auth/me` | current user |
| GET/POST | `/projects` · PATCH/DELETE `/projects/:id` | projects |
| GET/POST | `/projects/:id/files` · DELETE `/files/:fileId` | uploads |
| GET | `/projects/:id/datasets` · `/datasets/:dsId/preview?offset&limit` | profiled datasets |
| POST | `/projects/:id/chat` `{question, datasetId?}` | queue an analysis (202) |
| GET | `/projects/:id/analyses` · `/analyses/:aId` · `/analyses/:aId/export.csv` · DELETE | results |
| GET/POST | `/projects/:id/reports` `{name, format, analysisIds}` · GET `/reports/:rId` · `/reports/:rId/download` · DELETE | reports |
