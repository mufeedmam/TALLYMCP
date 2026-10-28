-- Canonical SQL views over the reconciled receivables tables.
--
-- WHY THESE EXIST (see also the answer written for the "SQL vs JS" question):
--   * FIFO matching is sequential and stays in JS (db/fifo-core.mjs); its OUTPUT
--     is already the reconciled table fact.fact_receivables_fifo. We do NOT
--     reimplement FIFO in SQL — that would duplicate the algorithm and risk drift.
--   * Everything DOWNSTREAM of the layers is set-based, and SQL does it faster and
--     more reliably than shipping every row to Node to aggregate. These views are
--     the clean, always-fresh contract for the app AND the future AI/MCP layer
--     (an LLM writes standard SQL against a named view far more reliably than it
--     calls a JS function).
--   * They are plain VIEWS, not materialized: they read fact.fact_receivables_fifo,
--     which the pipeline already rebuilds each sync, so they need no separate
--     REFRESH and can never be staler than the layers themselves.
--
-- These are safe to run directly in the Supabase SQL editor (idempotent).

-- One row per open FIFO layer ("open item"), enriched with party attributes.
-- Edge-INDEPENDENT: it exposes age_days and lets the consumer bucket however it
-- likes, so configurable aging thresholds never bake into the view.
create or replace view mart.v_receivables_open_items as
select
  f.layer_id,
  f.ledger_name,
  dl.display_name                      as party,
  dl.group_name,
  dl.state,
  dl.gstin,
  f.opened_date,
  f.as_of_date,
  (f.as_of_date - f.opened_date)       as age_days,
  f.remaining_amount,
  case when f.remaining_amount < 0 then 'advance' else 'receivable' end as item_type
from fact.fact_receivables_fifo f
join dim.dim_ledger dl on dl.ledger_name = f.ledger_name;

-- Per-customer rollup. Edge-independent aggregates from the layers, plus the
-- activity fields already carried on mart_party_receivables.
create or replace view mart.v_receivables_by_party as
select
  dl.ledger_name,
  dl.display_name                                                      as party,
  dl.group_name,
  dl.state,
  dl.gstin,
  coalesce(sum(f.remaining_amount) filter (where f.remaining_amount > 0), 0)::numeric(17,2) as open_receivable,
  coalesce(sum(f.remaining_amount) filter (where f.remaining_amount < 0), 0)::numeric(17,2) as open_advance,
  coalesce(sum(f.remaining_amount), 0)::numeric(17,2)                  as net_outstanding,
  count(*) filter (where f.remaining_amount > 0)                       as open_items,
  min(f.opened_date) filter (where f.remaining_amount > 0)             as oldest_opened_date,
  coalesce(max(f.as_of_date - f.opened_date) filter (where f.remaining_amount > 0), 0) as max_age_days,
  mp.balance_type,
  mp.last_activity_date,
  mp.days_since_activity
from dim.dim_ledger dl
join fact.fact_receivables_fifo f on f.ledger_name = dl.ledger_name
left join mart.mart_party_receivables mp on mp.ledger_name = dl.ledger_name
where dl.is_receivable
group by dl.ledger_name, dl.display_name, dl.group_name, dl.state, dl.gstin,
         mp.balance_type, mp.last_activity_date, mp.days_since_activity;

-- Per-group rollup (edge-independent).
create or replace view mart.v_receivables_by_group as
select
  group_name,
  count(*)                                                          as debtor_count,
  sum(open_receivable)::numeric(17,2)                               as open_receivable,
  sum(open_advance)::numeric(17,2)                                  as open_advance,
  sum(net_outstanding)::numeric(17,2)                               as net_outstanding,
  max(max_age_days)                                                 as max_age_days
from mart.v_receivables_by_party
where open_receivable > 0
group by group_name;

-- Configurable aging in pure SQL, for callers that want to bucket in the database
-- (the AI/MCP layer, ad-hoc Supabase queries) instead of the app. Pass the same
-- edges stored in meta.app_config → receivables.aging_edges to match the dashboard.
-- Bucketing is a trivial, stable comparison (unlike FIFO), so a SQL copy here is
-- low-risk; the app still buckets in one place (lib/analytics) for its live config.
create or replace function mart.fn_receivables_aging(edges int[] default array[30,60,90,180])
returns table (bucket_seq int, bucket text, amount numeric, layer_count bigint)
language sql stable as $$
  -- Build the bucket boundaries as (seq, lo, hi, label) rows, then LEFT JOIN the
  -- open layers by age between lo and hi. The left join keeps empty buckets, and
  -- the boundary rows make the logic obviously correct for any edge list.
  with bounds as (
    select 0 as seq, 0 as lo, edges[1] as hi, '0-' || edges[1] as label
    union all
    select g, edges[g] + 1, edges[g + 1], (edges[g] + 1) || '-' || edges[g + 1]
      from generate_subscripts(edges, 1) g
      where g < array_length(edges, 1)
    union all
    select array_length(edges, 1),
           edges[array_length(edges, 1)] + 1, 2147483647,
           (edges[array_length(edges, 1)] + 1) || '+'
  )
  select
    b.seq as bucket_seq,
    b.label as bucket,
    coalesce(sum(i.remaining_amount), 0)::numeric(17,2) as amount,
    count(i.layer_id) as layer_count
  from bounds b
  left join mart.v_receivables_open_items i
    on i.remaining_amount > 0 and i.age_days between b.lo and b.hi
  group by b.seq, b.label
  order by b.seq;
$$;
