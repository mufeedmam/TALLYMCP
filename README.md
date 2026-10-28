# Tally Cloud Analytics

Interactive analytics dashboard on Tally Prime data, synced into Supabase (Postgres).
Data + analytics layer are built AI/MCP-ready so an AI chatbot / MCP server can be added later
with near-zero rework. Full design in [`../PLAN.md`](../PLAN.md).

```
Tally Prime ──(reference loader, AlterID-incremental)──▶ Supabase Postgres ──▶ Next.js dashboard
                    loader/sync.mjs                         public.* (raw)        web/
                                                            meta.*  (sync + config)
```

## Layout
| Path | What |
|---|---|
| `loader/` | `sync.mjs` — records each run in `meta.sync_runs`, then drives the reused Tally Database Loader into Supabase |
| `db/meta.sql` | Meta schema — `meta.sync_runs`, `meta.last_sync`, `meta.app_config` (thresholds) |
| `web/` | Next.js dashboard (App Router, TS, Tailwind) |
| `dbt/` | Transform project (dims/facts/marts) — built in B1 |

## B0 setup (one time)

1. **Create a Supabase project** → Project Settings → Database → copy the **Session pooler**
   connection details (host, port 5432, user, password, database `postgres`).
2. `cp .env.example .env` and fill `PG*` + `DATABASE_URL`. Confirm `LOADER_DIR` points at the
   reference loader folder. Set `TALLY_COMPANY` (default: NAQD CONSULTING PRIVATE LIMITED).
3. Install deps:
   ```bash
   (cd loader && npm install)
   (cd web && npm install)
   ```
4. Create the meta schema:
   ```bash
   cd loader && npm run initdb
   ```

## Run a sync (on the Tally PC, Tally Prime open with XML port 9000 enabled)

```bash
cd loader && npm run full          # first time: full history load (2020-04-01 → 2027-03-31)
```
```bash
cd loader && npm run incremental   # subsequent runs (AlterID-based)
```
Each run inserts a row into `meta.sync_runs`; the dashboard reads `meta.last_sync` for "Last synced".

### Schedule incremental sync (Windows Task Scheduler)
Run `npm run incremental` every 15–30 min. (Alternatively, the loader's own continuous mode:
set `frequency` > 0 and a company name — it self-detects changes via AlterID.)

## Run the dashboard
```bash
cd web && npm run dev      # http://localhost:3000
```
The app reads `DATABASE_URL`; copy it into `web/.env.local`. Without it, the shell still renders
and shows "not connected" for the sync status.

## Verify B0 (definition of done)
- `npm run full` completes; `public.mst_*` / `trn_*` tables populated in Supabase.
- A row appears in `meta.sync_runs` with `status = success`.
- Dashboard shows the sidebar and a real **"Last synced"** time.
- Make an edit in Tally → `npm run incremental` → last-synced updates. (Confirms AlterID works.)

## Deployment (public hosting)
The app is a standard Next.js 16 server app — deploy the `web/` directory anywhere that runs Node
(Vercel, a container, or a VM).

1. **Environment** — set `DATABASE_URL` (Supabase Postgres, `sslmode=require`) in the host's env.
   That's the only variable the app needs at runtime; it reads Postgres directly in server
   components (no separate API tier).
2. **Build & start**
   ```bash
   cd web && npm ci && npm run build && npm start
   ```
3. **Data pipeline** stays wherever Tally runs (the loader needs LAN access to Tally on port 9000).
   Point it at the same Supabase; the hosted app reads the results.

> **Auth before you go public.** The dashboard and the `/api/metrics` endpoints are **read-only but
> unauthenticated** — they expose the same figures to anyone with the URL. Put the app behind auth
> (host-level access control, a `proxy.ts`, or an auth middleware) before exposing it on the
> internet. Never place `DATABASE_URL` in any `NEXT_PUBLIC_*` variable.

## Analytics API (AI / MCP-ready)
Every dashboard number is a registered `MetricDefinition` (`web/src/lib/analytics`). They're exposed
as a machine-readable contract so an MCP server or any AI client can introspect and call them with
no rework:

- `GET /api/metrics` — the catalog: each metric's id, description, typed params, output columns,
  reconciliation source, and suggested MCP tool name.
- `GET /api/metrics/{id}?param=value` (or `POST` with a JSON body) — runs a metric; params are
  coerced to their declared types and only declared params are accepted.

An MCP server wraps this: read the catalog once, expose one tool per metric, forward calls to the
run endpoint. Because the metrics are the *same* code the dashboard renders, the UI and the AI layer
can never disagree about a number.
