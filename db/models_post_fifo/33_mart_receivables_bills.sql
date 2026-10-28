-- Bill-wise receivables outstanding — the alternate aging basis to ledger-FIFO,
-- for the dashboard's FIFO⇄Bill-wise toggle.
--
-- Den Healthcare uses bill references, but only PART of AR is bill-tracked:
-- ~₹26L of the ₹83L sits on referenced bills; the rest is opening + on-account
-- money with no bill reference. So this mart has two kinds of open item:
--   * 'bill'         — a referenced bill, netted New-Ref vs Agst-Ref by name,
--                      aged from the bill's originating voucher date.
--   * 'unreferenced' — the per-ledger remainder (opening-not-allocated + on-account)
--                      needed so each ledger still ties to its Tally closing balance.
-- Bill entries from ORDER vouchers are excluded (they aren't real accounting), the
-- same fix applied in fact_gl.
--
-- Output shape mirrors fact.fact_receivables_fifo (ledger_name, opened_date,
-- remaining_amount, as_of_date) so the app's aging/rollup code is source-agnostic.

drop table if exists mart.mart_receivables_bills cascade;
create table mart.mart_receivables_bills as
with acct_bill as (
  select b.ledger as ledger_name, b.name as bill_ref,
         sum(b.amount) as net_cr,            -- credit-positive
         min(v.date)::date as bill_date
  from trn_bill b
  join trn_voucher v on v.guid = b.guid and v.is_accounting_voucher = 1
  where coalesce(b.name, '') <> ''            -- named references only; blank = on-account
  group by b.ledger, b.name
),
opening_bill as (
  select ledger as ledger_name, name as bill_ref,
         sum(opening_balance) as net_cr, min(bill_date)::date as bill_date
  from mst_opening_bill_allocation
  where coalesce(name, '') <> ''
  group by ledger, name
),
bills as (
  select ledger_name, bill_ref, sum(net_cr) as net_cr, min(bill_date) as bill_date
  from (select * from acct_bill union all select * from opening_bill) u
  group by ledger_name, bill_ref
),
open_bills as (
  select b.ledger_name, b.bill_ref,
         coalesce(b.bill_date, date '2020-04-01') as opened_date,
         round(-b.net_cr, 2) as remaining_amount     -- debit-positive
  from bills b
  join dim.dim_ledger dl on dl.ledger_name = b.ledger_name and dl.is_receivable
  where abs(b.net_cr) > 0.005
),
ref_by_ledger as (
  select ledger_name, sum(remaining_amount) as ref_dr from open_bills group by ledger_name
),
remainder as (
  -- closing_dr − referenced outstanding = opening-not-allocated + on-account
  select dl.ledger_name,
         round(-dl.closing_balance - coalesce(r.ref_dr, 0), 2) as remaining_amount
  from dim.dim_ledger dl
  left join ref_by_ledger r on r.ledger_name = dl.ledger_name
  where dl.is_receivable
    and abs(-dl.closing_balance - coalesce(r.ref_dr, 0)) > 0.005
)
select ledger_name, bill_ref, opened_date, remaining_amount,
       current_date as as_of_date, 'bill'::text as item_kind
from open_bills
union all
select ledger_name, 'On account / Opening'::text as bill_ref, date '2020-04-01' as opened_date,
       remaining_amount, current_date as as_of_date, 'unreferenced'::text as item_kind
from remainder;

create index mart_recv_bills_ledger on mart.mart_receivables_bills(ledger_name);
create index mart_recv_bills_opened on mart.mart_receivables_bills(opened_date);
