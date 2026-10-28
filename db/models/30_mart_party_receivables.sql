-- Party-level receivables (authoritative, covers ALL debtors regardless of bill
-- tracking). Sourced from ledger closing (ties to Balance Sheet) + activity from
-- fact_gl. Bill-level FIFO aging is layered on top in a later model.

drop table if exists mart.mart_party_receivables cascade;
create table mart.mart_party_receivables as
with activity as (
  select ledger_name,
         max(date)                          as last_activity_date,
         count(*)                           as txn_count,
         max(date) filter (where signed_amount > 0) as last_debit_date
  from fact.fact_gl
  group by ledger_name
),
bill_tracked as (
  select distinct ledger as ledger_name
  from trn_bill where coalesce(name,'') <> ''
)
select
  dl.ledger_name,
  dl.display_name                                   as party,
  dl.group_name,
  dl.state,
  dl.credit_period_days,
  round(-dl.closing_balance, 2)                     as receivable_dr,  -- +ve = owed to us
  case
    when dl.closing_balance < 0 then 'receivable'
    when dl.closing_balance > 0 then 'advance_cr'
    else 'settled'
  end                                               as balance_type,
  (bt.ledger_name is not null)                      as is_bill_tracked,
  a.last_activity_date,
  a.last_debit_date,
  a.txn_count,
  (current_date - a.last_activity_date)             as days_since_activity
from dim.dim_ledger dl
left join activity    a  on a.ledger_name  = dl.ledger_name
left join bill_tracked bt on bt.ledger_name = dl.ledger_name
where dl.is_receivable;

create unique index mart_party_recv_pk on mart.mart_party_receivables(ledger_name);
create index mart_party_recv_open on mart.mart_party_receivables(balance_type);
