# Data Dictionary & Metric Semantics

Machine- and human-readable reference for the analytics model. The dashboard and a
future MCP server both read from these layers. Regenerate/extend as models grow.

## Sign convention (authoritative)
Raw Tally amounts are **credit-positive** (`negative = Debit`, `positive = Credit`).
Everything downstream is normalized once, in `fact.fact_gl`:
- `debit_amount`  = `-raw_amount` when raw < 0, else 0   (≥ 0)
- `credit_amount` = `raw_amount`  when raw > 0, else 0   (≥ 0)
- `signed_amount` = `-raw_amount`  → **debit-positive** (assets/expenses +, income/liabilities −)
- Ledger closing (`dim_ledger.closing_balance`) stays in Tally's convention (neg = Dr);
  a receivable Dr is therefore `-closing_balance`.

## Layers
- `public.*` — raw loader output (L0). Do not query from the app directly.
- `dim.*`    — conformed dimensions.
- `fact.*`   — facts (standardized signs).
- `mart.*`   — serving tables the app/metrics read.
- `snap.*`   — Tally computed-report snapshots for reconciliation (to be populated).

## Tables

### dim.dim_date
Calendar 2015-04-01 → 2030-03-31. Key cols: `date`, `date_key`, `fin_year` (Apr–Mar, e.g. `2025-26`), `quarter`, `month_name`.

### dim.dim_group + dim.dim_group_closure
Group hierarchy. `dim_group_closure(ancestor_name, descendant_name, depth)` flattens the tree —
"under Sundry Debtors" = `exists (… ancestor_name='Sundry Debtors' and descendant_name=<group>)`.

### dim.dim_ledger
One row per ledger, pre-classified. Key cols: `ledger_name` (RAW join key — may have leading
spaces), `display_name` (trimmed), `group_name`, `primary_group`, `closing_balance` (Tally sign),
`credit_period_days`, `state`, `gstin`, and booleans `is_receivable / is_payable / is_bank / is_cash`
(via closure, so sub-grouped debtors are included).

### fact.fact_gl
One row per accounting posting. `date, ledger_name, voucher_type, voucher_number, party_name,
debit_amount, credit_amount, signed_amount, narration`. Openings are ₹0 for this company so not injected.

### mart.mart_party_receivables
Party-level receivables, **covers all debtors** (not just bill-tracked). One row per receivable ledger.
- `receivable_dr` — +ve = owed to us (`-closing_balance`); `balance_type` ∈ {receivable, advance_cr, settled}
- `is_bill_tracked` — has a referenced (non-blank) bill in `trn_bill`
- `last_activity_date`, `last_debit_date`, `days_since_activity` — for dormant analysis
- Ties to Balance Sheet: `Σ receivable_dr = -Σ closing_balance` over receivable ledgers.

## Multi-company: the model is now company-agnostic (NAQD + Den Healthcare)
Two very different companies have been loaded. The model handles both because of two
fixes made when Den was loaded (2026-08-06):
- **Order vouchers excluded from `fact_gl`** (`is_accounting_voucher = 1`). Sales/Purchase
  Orders post memorandum lines into `trn_accounting` but aren't real entries. Den uses Sales
  Orders heavily (~11.9k lines); including them inflated debtor movement ~9× (a hospital showed
  ₹65L "movement" against a ₹3.4L balance). They self-balance, so dropping is clean. NAQD had none.
- **Opening balances injected** into `fact_gl` as `voucher_type='Opening Balance'` rows dated at
  the sync period-start, so aging and every balance tie to Tally closing for companies that carry
  openings (Den: ₹57.8L opening AR; NAQD: 0). A small "difference in opening balances" (Den:
  ₹15,317.53) is normal Tally and is surfaced by its own reconcile check, not hidden. Openings are
  excluded from the expense marts.

### Den Healthcare characteristics (the OPPOSITE of NAQD)
- Heavy **bill-wise tracking** (New Ref / Agst Ref) AND heavy **On Account** (unreferenced) — only
  ~₹26L of the ₹83L AR sits on referenced bills; the rest is opening + on-account.
- Real **inventory**: 158 stock items, 65 with stock. Closing stock value comes through **negative**
  (−₹71.7L) — sign convention still to verify before building the inventory marts.
- Net receivable **₹83.08L** (ties to closing, both aging bases).

### FIFO ⇄ Bill-wise toggle (`?method=fifo|billwise`)
Two reconciled aging bases, both tie per-ledger to Tally closing:
- **FIFO** — `fact.fact_receivables_fifo` (ledger-level, opening injected). Supports arbitrary as-of.
- **Bill-wise** — `mart.mart_receivables_bills`: referenced bills netted New-Ref/Agst-Ref by name
  (accounting vouchers only), aged from the bill's voucher date, plus a per-ledger "On account /
  Opening" remainder so it still ties to closing. Snapshot-date only (no as-of recompute).
- The headline **Total receivable is the NET** in both modes (ties to closing); bill-wise also
  reveals the unallocated on-account/opening credits (Den: ₹56.9L) that FIFO hides.
- Known simplification: opening & on-account remainders are dated at the period-start, so they age
  into the oldest bucket.

## Company-specific findings (NAQD CONSULTING) — historical; drove the ORIGINAL receivables design
- Services firm: negligible inventory (2 stock items), so **B3 will be minimal/skippable**.
- **149 active debtors**, net receivable **₹14.97L** (gross Dr ₹17.27L, ₹2.30L in advance/Cr).
- **Referenced bill-wise tracking is barely used** (~7 debtors / ₹28k). Receivables are
  overwhelmingly **ledger-level** → aging must be **FIFO by transaction age**, not overdue-vs-due-date.
- **No credit periods maintained** (`credit_period_days` ~ null) and **no credit limits** →
  risk scoring uses exposure + concentration + age, not credit-term breach.

## Reconciliation gate (`npm run check`)
1. `fact_gl` Σ raw_amount = 0 (voucher balance invariant)
2. `fact_gl` debits = credits
3. receivable `fact_gl` movement = receivable ledger closing
4. classification populated
5. `fact_gl` row count = `trn_accounting`
6. `mart_party_receivables` net = receivable ledger closing

### fact.fact_receivables_fifo (computed by `db/compute_fifo.mjs`, not SQL)
One row per open "layer" per receivable ledger, as of `as_of_date`. Computed procedurally
(FIFO lot-matching, oldest debit consumed first by later credits) because it's inherently
sequential and not expressible as a single set-based SQL query. **Verified ledger-by-ledger**:
summing layers per ledger reproduces that ledger's Tally closing balance exactly, for all 796
receivable ledgers (0 mismatches). Re-run via `npm run fifo` after each sync.

### mart.mart_receivables_aging / mart.mart_receivables_aging_party
Built from the FIFO layers (`db/models_post_fifo/31_mart_receivables_aging.sql`, run via
`npm run transform:post` — must run AFTER `npm run fifo`). `aging_bucket` ∈
{0-30, 31-60, 61-90, 91-180, 180+, advance}. `_party` rollup has `open_receivable`,
`open_advance`, `oldest_open_date`, `max_age_days`, and per-bucket amount columns.

## Incremental sync — loader helper tables (gotcha)
The reference loader's **incremental** path needs three helper tables that its *full* path
never creates: `_diff`, `_delete`, `_vchnumber` (see the loader's
`database-structure-incremental.sql`). Without them incremental fails with
`relation "_diff" does not exist` — after connecting to Tally and the DB, so it looks like a
data problem rather than a missing-table one. Created once on 2026-07-31; if the public schema
is ever rebuilt from the loader's `database-structure.sql`, recreate them:

```sql
create table if not exists _diff (guid varchar(64) not null, alterid int);
create table if not exists _delete (guid varchar(64) not null);
create table if not exists _vchnumber (guid varchar(64) not null, voucher_number varchar(256));
```

## Loader column widths too tight (gotcha)
The reference loader's `database-structure.sql` defines many columns as `varchar(16/32/64)`
(e.g. `mst_ledger.mobile varchar(32)`). Real Tally data across companies overflows these —
Den Healthcare failed a full load with `value too long for type character varying(32)` on
`mst_ledger` (a customer with multiple phone numbers). Fixed on 2026-08-06 by widening **every**
public varchar ≤ 64 to `varchar(256)` — metadata-only in Postgres (no table rewrite), instant
even on the big txn tables. If the public schema is rebuilt from the loader's SQL, re-widen:
```sql
-- run after the loader recreates public.* tables
do $$ declare r record; begin
  for r in select table_name, column_name from information_schema.columns
           where table_schema='public' and data_type='character varying'
             and character_maximum_length <= 64
  loop execute format('alter table public.%I alter column %I type varchar(256)', r.table_name, r.column_name); end loop;
end $$;
```
Note: the loader couples fetch+load, and does essential post-load processing (parent-GUID
resolution, voucher numbering, cascades) — so you cannot skip its load by hand-loading the
`csv/*.data` files; a failed load must be fixed and the loader re-run.

## Company switch
`.env` `TALLY_COMPANY` pins which company the loader pulls (blank = whichever is open). To load a
different company, set it to the **exact** Tally company name (query Tally's `List of Companies`
collection — names can carry a year suffix and stray double spaces, e.g.
`Den Healthcare and Allied Enterprises  Pvt Ltd - 2025-26`). A full sync replaces the DB; the app
reads the loaded company name from `config` (`web/src/lib/company.ts`), so nothing hardcodes it.

Incremental is AlterID-based (`config` rows `Last AlterID Master` / `Last AlterID Transaction`).
"No change found" means Tally's AlterIDs match the DB — a legitimate no-op, not a failure.
**Still re-run `npm run fifo` afterwards even when nothing changed**: aging is measured against
the run date, so ages go stale by a day each day regardless of new vouchers.

## Pipeline order
`npm run transform` (dims/facts/base marts) → `npm run fifo` (FIFO layers) →
`npm run transform:post` (aging marts) → `npm run check` (reconciliation gate, 8 checks).
Convenience: `npm run pipeline` runs all four in order.

## Wired into the app (B1/B2, live)
`web/src/lib/analytics/metrics/receivables.ts` — `receivables.snapshot`,
`receivables.agingBuckets`, `receivables.topExposures`. Rendered at `/receivables`
(Snapshot: KPI tiles, aging chart, top exposures table). All dash pages are
`force-dynamic` (App Router) — live data must never be frozen at build time.

## B2 detailed tabs (complete)
All read live from `fact.fact_receivables_fifo` + `dim.dim_ledger` + `mart.mart_party_receivables`,
bucketed/scored at REQUEST TIME using `meta.app_config` — not baked in at sync time — so editing a
threshold in the Settings drawer takes effect on the next page load, no re-transform needed.

- **Aging** — buckets regenerated from `receivables.aging_edges` (labels always match current edges).
- **Groupwise** — rollup by `dim_ledger.group_name` (client sub-groups under Sundry Debtors), with
  overdue = portion older than the first aging edge.
- **Risk** (0-100, bands from `receivables.risk_bands`) — `overdue% × w.overdue + age_norm × w.age +
  concentration × w.concentration + dormancy_norm × w.dormancy`. **Deliberate substitution**: the
  seeded weight key is named `breach` (from the original credit-period-breach design) but NCPL
  maintains no credit periods, so it's repurposed as **dormancy** (`days_since_activity/365`) —
  same DB key, different meaning, documented here and in `receivablesConfig.ts`.
- **No activity** — `balance_type='receivable' and days_since_activity >= dormant_days`.
- **Unusual** — three independent rule-based detectors, each using only fields that actually exist:
  1. *Spikes*: current balance ≥ `spike_x` × trailing-90-day average monthly debit (skips parties
     with no recent debits, to avoid divide-by-zero noise).
  2. *Stale advances*: `balance_type='advance_cr'` (money received, never adjusted against an
     invoice) with no activity in `dormant_days`.
  3. *Long-open tiny balances*: open FIFO layers ≤ `tiny_amount` and older than `tiny_days`.
- **Drill-down**: every party name links to `/receivables/party/[ledger_name]` — open FIFO layers
  + full `fact_gl` transaction history for that ledger.
- **Export**: `/receivables/export?tab=<groupwise|risk|noactivity|topExposures>` — CSV route handler.
- **Settings**: `SettingsDrawer` (plain `<form action={serverAction}>`, no client JS) writes to
  `meta.app_config` via `saveReceivablesSettings` and calls `revalidatePath('/receivables')`.

## Filters, drill-down & the shared FIFO core

**One FIFO implementation.** `db/fifo-core.mjs` is the single source of truth, imported by
BOTH `db/compute_fifo.mjs` (pipeline) and `web/src/lib/analytics/fifo.ts` (request time).
`next.config.ts` sets `turbopack.root` to the repo root so the web app can resolve it —
Turbopack refuses to resolve outside its root, and a duplicated copy would be free to drift.

**Filters** (`web/src/lib/analytics/receivablesData.ts`, applied on every tab and the CSV export):
| Param | Meaning |
|---|---|
| `asOf` | Aging reference date. Matches the precomputed snapshot → reads the reconciled `fact_receivables_fifo`. **Any other date → replays FIFO over `fact_gl` in-process**, so historical aging is truthful rather than today's layers re-labelled. |
| `from` / `to` | Bound `opened_date` of layers |
| `q` | Party name contains |
| `group` | Exact ledger group |
| `minAmt` | Minimum open amount per layer |
| `bucket` | Aging bucket (applied after bucketing, since edges are configurable) |

Verified by reconcile checks 9–11: the in-process replay reproduces the GL position exactly at
2026-03-31, 2025-12-31 and 2024-06-30. **The metrics in `metrics/receivables.ts` delegate to this
same loader**, so the dashboard and future MCP tools cannot disagree.

**Drill-down** — Groupwise expands Group → Party → open FIFO layers inline (`<details>`, no JS).
The transaction-history leaf stays a *link* to `/receivables/party/[ledger]`: some ledgers carry
1,000+ postings, and inlining them for every collapsed row would bloat every page load. The party
page adds `txFrom`/`txTo` date filtering and a running balance.

## Remaining for later buckets
- `snap.snap_outstanding` — production pull of Tally's bills-outstanding report (nice-to-have
  cross-check for the bill-tracked minority; not required — the ledger-level FIFO numbers already
  reconcile to the Balance Sheet).
- B3 (Inventory), B4 (Payables), B5 (Expenses), B6 (polish/hosting).
