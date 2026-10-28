-- Ledger dimension, pre-classified so downstream marts never re-derive hierarchy.
-- NOTE: ledger_name is kept RAW (Tally names can have leading spaces and must
-- match trn_* references exactly on joins); display_name is the trimmed label.

drop table if exists dim.dim_ledger cascade;
create table dim.dim_ledger as
select
  l.guid                                as ledger_guid,
  l.name                                as ledger_name,       -- raw (join key)
  btrim(l.name)                         as display_name,
  l.parent                              as group_name,
  g.primary_group,
  l.opening_balance,
  l.closing_balance,                                          -- Tally sign: negative = Dr
  nullif(l.bill_credit_period, 0)       as credit_period_days,
  l.mailing_state                       as state,
  nullif(l.gstn, '')                    as gstin,
  l.is_revenue,
  l.is_deemedpositive,
  exists (select 1 from dim.dim_group_closure c
          where c.ancestor_name = 'Sundry Debtors'   and c.descendant_name = l.parent) as is_receivable,
  exists (select 1 from dim.dim_group_closure c
          where c.ancestor_name = 'Sundry Creditors' and c.descendant_name = l.parent) as is_payable,
  exists (select 1 from dim.dim_group_closure c
          where c.ancestor_name in ('Bank Accounts','Bank OD A/c','Bank OCC A/c')
            and c.descendant_name = l.parent) as is_bank,
  exists (select 1 from dim.dim_group_closure c
          where c.ancestor_name = 'Cash-in-Hand' and c.descendant_name = l.parent) as is_cash
from mst_ledger l
left join dim.dim_group g on g.group_name = l.parent;

create unique index dim_ledger_pk on dim.dim_ledger(ledger_name);
create index dim_ledger_recv on dim.dim_ledger(is_receivable) where is_receivable;
