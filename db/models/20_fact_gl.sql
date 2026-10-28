-- General-ledger fact: one row per accounting posting, with a single documented
-- sign convention. Raw Tally amount is credit-positive (negative = Debit,
-- positive = Credit); we expose explicit debit/credit plus a debit-positive
-- signed_amount.
--
-- TWO things this must get right for a general (multi-company) load:
--   1. EXCLUDE non-accounting vouchers. Order vouchers (Sales/Purchase Orders)
--      post memorandum lines into trn_accounting but are NOT real ledger entries.
--      Den Healthcare uses Sales Orders heavily (~11.9k lines); including them
--      double-counts debtor movement massively (a debtor showed ₹65L of "movement"
--      against a ₹3.4L balance). They self-balance (Σ=0), so dropping them is clean.
--      NAQD had none, which is why this never surfaced before.
--   2. INJECT opening balances as synthetic postings. Companies that carry forward
--      balances (Den: ₹57.8L opening AR) need these so every ledger's postings tie
--      to Tally's closing (closing = opening + movement). NAQD's openings were 0.
--      Opening rows are tagged voucher_type='Opening Balance' and dated at the sync
--      period-start so downstream (aging, marts) can find or exclude them.

drop table if exists fact.fact_gl cascade;
create table fact.fact_gl as
with postings as (
  select
    v.date::date                          as date,
    a.ledger                              as ledger_name,
    v.voucher_type,
    v.voucher_number,
    nullif(v.party_name, '')              as party_name,
    a.amount                              as raw_amount,     -- Tally: neg = Dr
    a.guid                                as voucher_guid,
    nullif(v.narration, '')               as narration
  from trn_accounting a
  join trn_voucher v on v.guid = a.guid
  where v.is_accounting_voucher = 1                          -- (1) real entries only
  union all
  select
    date '2020-04-01'                     as date,           -- sync period-start (TALLY_FROMDATE)
    l.name                                as ledger_name,
    'Opening Balance'                     as voucher_type,
    null                                  as voucher_number,
    null                                  as party_name,
    l.opening_balance                     as raw_amount,     -- (2) carried-forward balances
    null                                  as voucher_guid,
    null                                  as narration
  from mst_ledger l
  where coalesce(l.opening_balance, 0) <> 0
)
select
  row_number() over ()                                as gl_id,
  voucher_guid,
  date,
  ledger_name,
  voucher_type,
  voucher_number,
  party_name,
  raw_amount,
  case when raw_amount < 0 then -raw_amount else 0 end as debit_amount,
  case when raw_amount > 0 then  raw_amount else 0 end as credit_amount,
  (-raw_amount)                                       as signed_amount,   -- debit-positive
  narration
from postings;

create index fact_gl_ledger on fact.fact_gl(ledger_name);
create index fact_gl_date   on fact.fact_gl(date);
create index fact_gl_party  on fact.fact_gl(party_name);
create index fact_gl_vtype  on fact.fact_gl(voucher_type);
