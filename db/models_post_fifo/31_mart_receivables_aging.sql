-- Aging mart built on the FIFO layers (db/compute_fifo.mjs must run first).
-- Covers ALL receivable ledgers via transaction-age FIFO, not just bill-referenced ones.

drop table if exists mart.mart_receivables_aging cascade;
create table mart.mart_receivables_aging as
select
  f.layer_id,
  f.ledger_name,
  dl.display_name                                   as party,
  dl.group_name,
  dl.state,
  f.opened_date,
  f.remaining_amount,                                -- +Dr open / -Cr (unadjusted advance)
  f.as_of_date,
  (f.as_of_date - f.opened_date)                    as age_days,
  case
    when f.remaining_amount < 0 then 'advance'
    when (f.as_of_date - f.opened_date) <= 30  then '0-30'
    when (f.as_of_date - f.opened_date) <= 60  then '31-60'
    when (f.as_of_date - f.opened_date) <= 90  then '61-90'
    when (f.as_of_date - f.opened_date) <= 180 then '91-180'
    else '180+'
  end                                                as aging_bucket
from fact.fact_receivables_fifo f
join dim.dim_ledger dl on dl.ledger_name = f.ledger_name;

create index mart_recv_aging_ledger on mart.mart_receivables_aging(ledger_name);
create index mart_recv_aging_bucket on mart.mart_receivables_aging(aging_bucket);

-- Per-party rollup: total open, oldest layer, bucket breakdown.
drop table if exists mart.mart_receivables_aging_party cascade;
create table mart.mart_receivables_aging_party as
select
  ledger_name,
  party,
  group_name,
  state,
  round(sum(remaining_amount) filter (where remaining_amount > 0), 2)   as open_receivable,
  round(sum(remaining_amount) filter (where remaining_amount < 0), 2)   as open_advance,
  min(opened_date)      filter (where remaining_amount > 0)             as oldest_open_date,
  max(age_days)          filter (where remaining_amount > 0)            as max_age_days,
  round(sum(remaining_amount) filter (where aging_bucket = '0-30'), 2)  as bucket_0_30,
  round(sum(remaining_amount) filter (where aging_bucket = '31-60'), 2) as bucket_31_60,
  round(sum(remaining_amount) filter (where aging_bucket = '61-90'), 2) as bucket_61_90,
  round(sum(remaining_amount) filter (where aging_bucket = '91-180'),2) as bucket_91_180,
  round(sum(remaining_amount) filter (where aging_bucket = '180+'), 2)  as bucket_180_plus
from mart.mart_receivables_aging
group by ledger_name, party, group_name, state;

create unique index mart_recv_aging_party_pk on mart.mart_receivables_aging_party(ledger_name);
