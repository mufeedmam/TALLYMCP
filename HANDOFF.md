# Session Handoff — Tally Cloud Analytics

> **⚠️ MAINTENANCE — READ AND FOLLOW EVERY SESSION**
> **This file is the single source of truth for project state across chats.**
> **After every change or conversation, UPDATE THIS FILE** before you finish:
> - Add a dated line to the **Changelog** (bottom) describing what changed and why.
> - If you added/renamed a page, metric, model, or data module, update the relevant section here.
> - If you discovered a gotcha, sign convention, or reconciliation subtlety, record it under **Gotchas**.
> - If a caveat was resolved or a new one introduced, update **Known caveats**.
> Keep it accurate and terse. A future session (human or AI) should be able to continue from this file
> plus `db/DICTIONARY.md` alone. Do **not** let this file drift from reality.

_Last updated: 2026-10-28 · Status: B0–B6 complete + Cashflow rebuilt + MCP server (verified live) · Loaded company: **Den Healthcare and Allied Enterprises Pvt Ltd** (all-years)._

---

## 1. What this project is
Extracts **Tally Prime** data into **Supabase Postgres**, transforms it into a reconciled analytics
model, and serves an interactive **Next.js** dashboard. Every dashboard number ties back to Tally
(a reconciliation gate blocks bad data). The metrics are also exposed as a machine-readable API so an
**MCP / AI layer** can be added with no rework. Two very different companies have been run through it:
NAQD Consulting (services, no inventory/bills) and Den Healthcare (trading, heavy inventory + bills).

## 2. Repo layout
```
tally-cloud-analytics/
├── db/            SQL models + Node pipeline (transform, FIFO, reconcile, exports)
│   ├── models/            00_schemas → 50_mart_inventory  (run by `npm run transform`)
│   ├── models_post_fifo/  31_aging, 32_views, 33_bills     (run by `npm run transform:post`, AFTER fifo)
│   ├── fifo-core.mjs      THE FIFO algorithm — imported by BOTH pipeline and web app
│   ├── compute_fifo.mjs   builds fact.fact_receivables_fifo (truncate+insert)
│   ├── reconcile.mjs      14-check reconciliation gate (`npm run check`)
│   ├── export_receivables_fifo.mjs   FY-end CSV export
│   ├── meta.sql           meta schema: sync_runs, app_config (thresholds)
│   └── DICTIONARY.md      ← deep data reference (sign conventions, per-company findings). READ IT.
├── loader/        sync.mjs — wraps the reference Tally Database Loader (in ../tally-database-loader-utility-1.0.43)
├── mcp/           MCP stdio server (server.mjs) — thin wrapper over the web app's /api/metrics
├── web/           Next.js 16 app (App Router, RSC, shadcn/ui)
├── exports/       generated CSVs
├── .env           pipeline + web config (gitignored)   ·   .env.example — template
└── README.md      runbook + deployment + API docs
```

## 3. Data pipeline
**Layers:** `public.*` (raw loader tables) → `dim.*` → `fact.*` → `mart.*` (+ `mart.v_*` views).

**Commands** (run from `tally-cloud-analytics/`):
```bash
cd loader && npm run full          # first load of a company (or after switching companies)
cd loader && npm run incremental   # AlterID-based incremental
npm run pipeline                   # transform → fifo → transform:post → check  (rebuild derived layer)
npm run check                      # reconciliation gate only (14 checks — must all pass)
node db/export_receivables_fifo.mjs 2026-03-31   # FY-end receivables CSV
```
**Reconciliation:** 14 checks in `reconcile.mjs`, all must pass. Includes GL balance, Dr=Cr, receivables
FIFO ties per-ledger to closing, bill-wise mart ties, as-of recompute ties to GL at 3 historical dates,
inventory mart == Tally valuation.

## 4. Web app
Next.js **16** (App Router, Turbopack), **React 19**, **TypeScript**, **Tailwind v4**, **shadcn/ui**
(preset `b1i8sS`, **Base UI** `render`-prop pattern — NOT Radix `asChild`; **Tabler** icons), dark mode
via `next-themes`. Data read directly from Postgres in **server components** (`web/src/lib/db.ts`) — no
API tier. Filters/tabs are plain **GET forms + links** (zero client JS, shareable URLs); drill-downs use
native `<details>`.

**Run:** `cd web && npm run dev` → http://localhost:3000 (needs `DATABASE_URL` in `web/.env.local`).

**Sections (routes under `web/src/app/(dash)/`):**
| Route | What |
|---|---|
| `/overview` | Live KPIs + working capital + section nav |
| `/receivables` | Tabs: snapshot, aging, groupwise, **profitability (customer)**, risk, noactivity, unusual. **FIFO⇄Bill-wise toggle** (`?method=`), filters, thresholds drawer, CSV export, party drill-down `/receivables/party/[name]` |
| `/payables` | Tabs: snapshot, aging, groupwise, **profitability (supplier)**. Supplier drill-down `/payables/party/[name]` |
| `/inventory` | Tabs: snapshot, movement, profitability, slow — all **group→item expandable**. Filters + thresholds drawer. Item drill-down `/inventory/item/[name]` |
| `/expenses` | Accounts, categories, monthly trend |
| `/cashflow` | KPIs (position, net, in/out, avg monthly net, best/worst month, cash-positive months) + **cash-flow statement** (Operating/Investing/Financing activities, expandable counter-party group detail, opening→closing reconciliation), **cash position by account**, **monthly running balance** table |
| `/settings` | Company, sync history, **live data-integrity tie-outs**, thresholds, API pointer |

**Analytics registry / API (AI-MCP-ready):**
- `web/src/lib/analytics/index.ts` — registry of **20 `MetricDefinition`s** (`listMetrics`/`getMetric`/`runMetric`).
- `GET /api/metrics` — machine-readable catalog (params, outputs, reconcile source, MCP tool name).
- `GET|POST /api/metrics/{id}` — runs a metric with type-coerced params.
- The same metric code powers the UI, so the dashboard and any AI layer can't disagree.

**MCP server (`mcp/`):** a stdio MCP server (`mcp/server.mjs`, plain `.mjs`, own `package.json`, dep
`@modelcontextprotocol/sdk`) — the thin wrapper the next-steps called for. It reads `GET /api/metrics`
at runtime and exposes **one typed `get_*` tool per metric** (named from each metric's `mcp.toolName`),
plus `list_metrics` (discovery) and `run_metric` (generic fallback) — 22 tools total. Each call forwards
to `POST /api/metrics/{id}`, so it runs the exact dashboard code path and needs **no DB credentials**.
Config via `ANALYTICS_BASE_URL` (default `http://localhost:3000`); requires the web app running. Install
with `npm --prefix mcp install`. See `mcp/README.md` for client config. Degrades to just the two generic
tools if the catalog is unreachable at startup.

**Remote MCP endpoint (for claude.ai / mobile):** `web/src/app/api/mcp/route.ts` — a stateless
Streamable-HTTP JSON-RPC endpoint exposing the SAME 22 tools, but **in-process** (calls the registry
directly, no HTTP hop). Add it in claude.ai as a custom connector at `https://<app>/api/mcp`.
**⚠️ UNAUTHENTICATED (testing posture, "Option A").** claude.ai connectors expect OAuth or a fully-open
server — a secret token in the URL path tripped claude.ai's OAuth dynamic-client-registration ("Couldn't
register with …'s sign-in service"), so the token gate was removed. This matches the already-public
`/api/metrics`. **Before production, put OAuth in front of BOTH this route and `/api/metrics`** (a full
rebuild with login/OAuth is planned). The stdio server (`mcp/`) remains the private option (Claude
Desktop/Code, local); this route is for web/mobile clients that can only reach a remote URL.

**Key web modules** (`web/src/lib/analytics/`): `receivablesData.ts`, `payablesData.ts`, `inventoryData.ts`,
`cashflow.ts`, `profitability.ts`, `overview.ts`, `fifo.ts` (wraps `db/fifo-core.mjs` — `turbopack.root`
in `next.config.ts` is set to repo root so this cross-import resolves), `receivablesConfig.ts`,
`inventoryConfig.ts`, `metrics/*`. Shared UI primitives: `web/src/components/kit.tsx` (token-based);
shadcn components in `web/src/components/ui/*`; shell in `AppSidebar.tsx` + `(dash)/layout.tsx`.

## 5. Gotchas (do not rediscover these)
- **Sign convention:** raw Tally amount is credit-positive (neg = Dr). `fact_gl.signed_amount` is
  **debit-positive** (`-raw`). Receivable = `-closing_balance` (positive). Payable = `+closing_balance`.
  Inventory `closing_value` is stored **negative** for stock-in-hand → true value = `-closing_value`.
- **fact_gl excludes order vouchers** (`is_accounting_voucher = 1`) — Sales/Purchase Orders post
  memorandum lines that would double-count movement. And it **injects opening balances** (tagged
  `voucher_type='Opening Balance'`, dated at period start) so balances tie to closing for companies
  that carry openings. Openings are excluded from the expense marts.
- **FIFO lives in `db/fifo-core.mjs`** (one implementation, imported by pipeline AND web). Feed it
  debit-positive for receivables, credit-positive (`-signed_amount`) for payables.
- **Loader column widths too tight** — real Tally data overflows the reference loader's `varchar(16/32)`.
  All public varchars ≤64 were widened to 256 (metadata-only). Re-apply if the public schema is rebuilt
  (see DICTIONARY.md for the DDL).
- **Incremental sync needs helper tables** `_diff`, `_delete`, `_vchnumber` that the loader's *full*
  path never creates — create them or incremental fails with `relation "_diff" does not exist`.
- **Switching companies:** set `TALLY_COMPANY` in `.env` to the exact Tally name (blank = whichever is
  open). A full sync **replaces** the DB. App reads the live company name from `config` (nothing hardcodes it).
- **shadcn is Base UI here:** use `render={<Link/>}` not `asChild`; icons are `@tabler/icons-react`.
- **`db.ts` swallows query errors → silent zeros.** `web/src/lib/db.ts` `query()` returns `[]` on any
  error (so the shell renders pre-connection). Consequence: when the Supabase DB is **paused/unreachable**,
  every metric/page shows **0 / empty**, NOT an error — in the dashboard AND the MCP. Tells: sidebar shows
  `Last synced: never`, company reads "Not connected", all KPIs ₹0. Fix the DB (Supabase free projects
  pause after ~1 week idle — unpause in the Supabase dashboard); don't debug the app/MCP.
- **Serverless + Supabase pooling.** On Vercel each warm function instance holds its own `pg` pool, so
  (a) `db.ts` MUST keep a `pool.on('error')` handler or a dropped idle connection crashes the function,
  (b) use the Supabase **transaction** pooler (`:6543`) not session (`:5432`), and (c) keep `max` small with
  an `idleTimeoutMillis`. See the 2026-10-28 changelog entry. Symptom when wrong: data loads briefly then
  flips to permanent "not connected" with nothing in the browser console (the error is in Vercel logs).
- **Two different DB URLs:** root `.env` `DATABASE_URL` and `web/.env.local` `DATABASE_URL` can point at
  different Supabase projects. The web app + MCP use **`web/.env.local`**; the pipeline/loader use root
  `.env`. Keep them in sync, or point pipeline scripts at the same project you serve.

## 6. Known caveats (state honestly in UI where relevant)
- **Profitability reports are attributions**, not the P&L to the rupee: item gross-margin × the party's
  revenue on that item (Tally stores no cost on the transaction line). Named parties only (cash/unnamed
  sales excluded). Footnoted in each report.
- **Supplier profitability** is limited: Den buys raw materials, sells finished goods, so margin accrues
  to the finished item — raw-material suppliers show low realized margin (documented on-screen).
- **Bill-wise aging is snapshot-only** (no arbitrary as-of recompute — that's a FIFO-only feature).
- **Openings / on-account remainders age into the oldest bucket** (dated at period start).
- **No auth.** Dashboard + `/api/metrics` are read-only but unauthenticated — add auth before public hosting.

## 7. Suggested next steps
- ✅ **MCP server** — done (`mcp/`, see §4). Possible follow-ups: an in-process variant that imports the
  metric registry directly (no running web app needed, but must resolve the `@/` alias outside Next);
  resources/prompts in addition to tools; packaging/`npx` entry.
- **Auth** before any public exposure (dashboard, `/api/metrics`, and the MCP all inherit the same
  no-auth posture).
- **Scheduled incremental sync** (Windows Task Scheduler / loader continuous mode) + kick `npm run pipeline` after.
- Optional polish: richer charts, converting the remaining hand-styled inputs to shadcn `<Input>`/`<Select>`.

---

## Changelog
_Newest first. Add a dated entry every session._
- **2026-10-28** — **Remote MCP endpoint → no-auth (Option A, testing).** claude.ai's custom-connector
  flow tried OAuth dynamic client registration against the token-gated endpoint and failed ("Couldn't
  register with …'s sign-in service"). Since claude.ai expects OAuth or a fully-open server — and the app
  is already public via `/api/metrics` — moved the route to a fixed unauthenticated path
  `web/src/app/api/mcp/route.ts` and deleted `…/mcp/[token]/route.ts` (and its `MCP_TOKEN` gate). Connector
  URL is now just `https://<app>/api/mcp`. Verified on :3000: initialize, tools/list (22),
  tools/call `get_inventory_snapshot` (live), old `/api/mcp/<token>` → 404. **Planned:** full rebuild with
  login + OAuth securing both `/api/mcp` and `/api/metrics`; this open posture is temporary for testing.
- **2026-10-28** — Added a **remote MCP endpoint** for claude.ai / mobile custom connectors (initially
  `web/src/app/api/mcp/[token]/route.ts`, later moved to no-auth — see entry above). Stateless Streamable-HTTP JSON-RPC (POST), reusing the
  **in-process** metric registry (same 22 tools as the stdio server — no HTTP hop). Auth = secret token
  in the URL path (`/api/mcp/<MCP_TOKEN>`), because claude.ai connectors can't send custom auth headers;
  set `MCP_TOKEN` in env (added to `web/.env.local` for local dev). Verified on :3000 — initialize (echoes
  protocolVersion), tools/list (22), tools/call `get_receivables_snapshot` (live ₹1.41Cr), notification→202,
  wrong token→401, missing `MCP_TOKEN`→503. **Connect:** set `MCP_TOKEN` in Vercel, redeploy, then in
  claude.ai → Settings → Connectors → Add custom connector → `https://<app>/api/mcp/<MCP_TOKEN>`.
  ⚠️ `/api/metrics` is still public/unauthenticated — only `/api/mcp` is token-gated.
- **2026-10-28** — **Vercel deploy hardening** (`web/src/lib/db.ts` `getPool()`). Three fixes so the
  dashboard survives serverless: (1) a `pool.on('error')` handler — without it a pooler-dropped idle
  connection makes node-pg emit an *unhandled* error that crashes the function (the "data loads for a
  minute then goes to 'not connected', nothing in the browser console" symptom); (2) `idleTimeoutMillis`
  + `connectionTimeoutMillis` and a smaller `max` (env `PG_POOL_MAX`, default 3) so connections release
  and a Supabase pooler isn't exhausted; (3) pool init wrapped in try/catch so a bad/missing
  `DATABASE_URL` degrades to "not connected" instead of a 500 (`FUNCTION_INVOCATION_FAILED`).
  **Deploy model:** import ONLY `web/` to Vercel (Root Directory `web`) — the `mcp/` server is stdio/local
  and must NOT be a Vercel service (Vercel's multi-service `vercel.json` suggestion does not apply). Set
  Vercel `DATABASE_URL` to the Supabase **transaction** pooler (`:6543`) for serverless, not session (`:5432`).
  The MCP server stays local, pointed at the deployed URL via `ANALYTICS_BASE_URL`.
- **2026-10-28** — Pushed to GitHub (public): https://github.com/mufeedmam/TALLYMCP (`main`). Verified the
  pushed tree excludes `.env`, `web/.env.local`, `node_modules`, and `exports/*.csv` (added `exports/*.csv`
  to `.gitignore`). `gh` CLI installed; GCM handled auth.
- **2026-10-28** — Built the **MCP server** (`mcp/`): a thin stdio wrapper over `/api/metrics`
  (`server.mjs` + `package.json` + `README.md`, dep `@modelcontextprotocol/sdk` ^1.30). Reads the metric
  catalog at runtime and exposes one typed `get_*` tool per metric (from each metric's `mcp.toolName`)
  plus `list_metrics` and `run_metric` — 22 tools. Forwards to `POST /api/metrics/{id}` (same code path
  as the UI; no DB creds in the MCP process); `ANALYTICS_BASE_URL` env, default `http://localhost:3000`.
  Smoke-tested end-to-end over stdio (initialize → tools/list → calls): handshake, 22 tools, faithful
  forwarding (MCP output == direct API output), reconcile annotations, typed params all verified.
  Verified against **live data** once the DB was unpaused: receivables ₹1.41Cr/97 debtors, inventory
  ₹49.7L stock + 38.1% margin, expenses ₹21.4Cr — plus typed-param passthrough and the unknown-tool
  error path. (The Supabase project `htandgvozjczvozfctoj` used by `web/.env.local` had briefly paused
  mid-session — "tenant not found" — surfacing as all-zeros via the error-swallowing `db.ts`; recorded
  as two new gotchas in §5: silent-zeros-on-DB-down, and the root `.env` vs `web/.env.local` split.)
- **2026-08-12** — Rebuilt the **Cashflow** page as a proper cash-flow analysis. Removed the monthly
  bar chart. Added: a **cash-flow statement** (counter-legs of each cash voucher classified into
  Operating / Investing / Financing via a `primary_group → activity` map, with expandable per-group
  detail and an opening + net = closing reconciliation strip that ties to the live Tally cash position);
  a **cash position by account** table (all 9 bank/cash ledgers, which OD is drawn); a **monthly
  running-balance** table (replaces the chart); and richer **KPIs** (avg monthly net, best/worst month,
  cash-positive months). New fns in `web/src/lib/analytics/cashflow.ts`: `loadCashStatement`,
  `loadCashFlowStatement`, `loadCashAccounts`, `deriveCashKpis`, `classifyActivity`/`ACTIVITY_ORDER`.
  `getCashSummary` + `parseCashFilter` kept (Overview still imports `getCashSummary`); removed the now-unused
  `loadMonthlyCashflow` / `loadSourcesUses`. Statement uses a div-grid `<details>` layout (not `GroupReport`,
  which forces a per-item link the cash groups don't have). Added root `.claude/launch.json` (`web-dev` →
  `npm --prefix web run dev`, port 3000) for `/run`. **Gotcha:** the statement's activity net is built from
  the non-cash counter-legs (directional `abs()` split), so it can differ from the true cash-leg net by a
  few rupees on vouchers that mix Dr and Cr non-cash legs (~₹19 / 0.006% here) — immaterial at compact
  precision. The reconciliation strip is computed from the **cash** legs, so it ties to Tally exactly.
- **2026-08-06** — B6 complete: real Overview dashboard, Settings page (sync history + live data-integrity
  tie-outs + thresholds), `/api/metrics` catalog + `/api/metrics/[id]` run endpoint (20 metrics, AI/MCP-ready),
  README deployment section + `.env.example`. Created this HANDOFF.md.
- **2026-08-06** — Built Payables section (B4: snapshot/aging/groupwise/profitability + supplier drill-down,
  ties to ₹1.34Cr), Cashflow page (position/monthly/sources&uses), and customer + supplier **profitability**
  reports (shared `profitability.ts`). Removed the monthly chart from the inventory Movement tab.
- **2026-08-06** — Full **shadcn/ui redesign** (`b1i8sS` preset, Base UI, Tabler icons, dark mode via
  next-themes). Rebuilt shared primitives as `components/kit.tsx` on theme tokens; new `AppSidebar`;
  swept hardcoded white/indigo → tokens. Data layer untouched.
- **2026-08-06** — Inventory reports made **group→item expandable** with filters + a config drawer
  (`inventoryConfig.ts`, `meta.app_config` category `inventory`).
- **2026-08-06** — Loaded **Den Healthcare** (all-years). Fixed 3 real bugs: loader varchar widths, Sales
  Orders polluting `fact_gl` (now `is_accounting_voucher=1`), and opening-balance injection. Built the
  **Inventory** section (tabs + item drill-down + profitability). Reconciliation extended to 14 checks.
- **earlier** — B0 (sync), B1 (analytics/receivables model + FIFO + reconciliation), B2 (Receivables
  section, FIFO⇄bill-wise toggle, filters, config, drill-down, CSV), B3 (Inventory), B5 (Expenses).
  See `db/DICTIONARY.md` for the deep data history.
