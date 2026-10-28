-- Expense marts (simple GL rollups; no complex bucketing needed for B5).

drop table if exists mart.mart_expenses_by_account cascade;
create table mart.mart_expenses_by_account as
select
  dl.ledger_name,
  dl.display_name,
  dl.primary_group,
  dl.state,
  round(sum(g.debit_amount), 2) as total_amount,
  count(*) as transaction_count,
  min(g.date)::text as first_date,
  max(g.date)::text as last_date,
  max(g.date) - min(g.date) as days_active,
  current_date as as_of_date
from fact.fact_gl g
join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
where dl.is_receivable = false
  and dl.is_payable = false
  and dl.is_bank = false
  and dl.is_cash = false
  and g.voucher_type <> 'Opening Balance'   -- opening balances are not expenses
group by dl.ledger_name, dl.display_name, dl.primary_group, dl.state;

create index mart_exp_account_ledger on mart.mart_expenses_by_account(ledger_name);
create index mart_exp_account_group on mart.mart_expenses_by_account(primary_group);

-- Rollup by category (primary_group).
drop table if exists mart.mart_expenses_by_category cascade;
create table mart.mart_expenses_by_category as
select
  primary_group,
  count(distinct ledger_name) as account_count,
  round(sum(total_amount), 2) as total_amount
from mart.mart_expenses_by_account
group by primary_group
order by total_amount desc;

create index mart_exp_category_group on mart.mart_expenses_by_category(primary_group);

-- Monthly rollup for trend analysis.
drop table if exists mart.mart_expenses_monthly cascade;
create table mart.mart_expenses_monthly as
select
  extract(year from g.date)::int as fiscal_year,
  extract(month from g.date)::int as month,
  to_char(g.date, 'YYYY-MM') as year_month,
  round(sum(g.debit_amount), 2) as amount,
  count(*) as transaction_count
from fact.fact_gl g
join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
where dl.is_receivable = false
  and dl.is_payable = false
  and dl.is_bank = false
  and dl.is_cash = false
  and g.voucher_type <> 'Opening Balance'   -- opening balances are not expenses
group by extract(year from g.date), extract(month from g.date), to_char(g.date, 'YYYY-MM')
order by fiscal_year desc, month desc;

create index mart_exp_monthly_year on mart.mart_expenses_monthly(fiscal_year);
