-- Meta schema: sync tracking + app configuration (analysis thresholds).
-- Idempotent — safe to run on every sync. Owned by THIS project (not the loader).
-- The loader creates its own raw tables (mst_*/trn_*) in the public schema.

create schema if not exists meta;

-- One row per extraction run (raw / snapshot / delete_sweep).
create table if not exists meta.sync_runs (
  id             bigint generated always as identity primary key,
  job            text        not null default 'raw',          -- raw | snapshot | delete_sweep
  sync_type      text        not null default 'incremental',  -- full | incremental
  status         text        not null default 'running',      -- running | success | failed
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_processed bigint,
  master_alterid bigint,
  txn_alterid    bigint,
  message        text,
  source         text        not null default 'loader'
);

create index if not exists idx_sync_runs_job_started
  on meta.sync_runs (job, started_at desc);

-- "Last synced" indicator for the app.
create or replace view meta.last_sync as
select
  max(finished_at) filter (where status = 'success') as last_success_at,
  max(started_at)                                     as last_attempt_at,
  (select status from meta.sync_runs order by started_at desc limit 1) as last_status
from meta.sync_runs;

-- App configuration / analysis thresholds (tunable in-app later; see PLAN.md §12).
create table if not exists meta.app_config (
  key         text primary key,
  value       jsonb       not null,
  category    text,
  description text,
  updated_at  timestamptz not null default now()
);

insert into meta.app_config (key, value, category, description) values
  ('receivables.aging_edges',  '[30,60,90,180]', 'receivables', 'Aging bucket upper edges (days)'),
  ('receivables.aging_mode',   '"overdue"',      'receivables', 'overdue = age by due date; billdate = age by bill date'),
  ('receivables.dormant_days', '90',             'receivables', 'No-activity threshold (days)'),
  ('receivables.risk_weights', '{"overdue":0.35,"age":0.25,"concentration":0.20,"breach":0.20}', 'receivables', 'Risk score component weights'),
  ('receivables.risk_bands',   '[30,60]',        'receivables', 'Low/Med/High score cutoffs'),
  ('receivables.spike_x',      '3',              'receivables', 'Unusual: balance > x * trailing-3mo avg'),
  ('receivables.breach_x',     '2',              'receivables', 'Unusual: overdue beyond x * credit period'),
  ('receivables.tiny_count',   '10',             'receivables', 'Unusual: >= N tiny long-open bills'),
  ('receivables.tiny_days',    '180',            'receivables', 'Unusual: bill open longer than N days = long-open'),
  ('inventory.slow_days',      '180',            'inventory',   'No-movement threshold (days) = slow/dead stock'),
  ('inventory.margin_band',    '[-20,95]',       'inventory',   'Plausible gross-margin %% band; outside = profit_unreliable flag')
on conflict (key) do nothing;
