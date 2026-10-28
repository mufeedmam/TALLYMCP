import type { MetricDefinition } from '../types';
import { query } from '@/lib/db';

export interface ExpensesSnapshot {
  total_expenses: number;
  account_count: number;
  last_fiscal_year_total: number;
  ytd_total: number;
  top_account_amount: number;
  top_account_name: string;
}

export const expensesSnapshotMetric: MetricDefinition<Record<string, never>, ExpensesSnapshot> = {
  id: 'expenses.snapshot',
  title: 'Expenses snapshot',
  description: 'Total expenses, account count, YTD and LFY comparison, largest single expense.',
  params: [],
  output: [
    { column: 'total_expenses', type: 'numeric', semantic: 'all-time cumulative expenses' },
    { column: 'account_count', type: 'int', semantic: 'number of distinct expense accounts' },
    { column: 'last_fiscal_year_total', type: 'numeric', semantic: 'prior fiscal year (Apr-Mar) total' },
    { column: 'ytd_total', type: 'numeric', semantic: 'current fiscal year YTD' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_expenses_snapshot' },
  run: async () => {
    const rows = await query<{
      total: string;
      accounts: string;
      lfy: string | null;
      ytd: string | null;
      top_amt: string | null;
      top_name: string | null;
    }>(`
      with totals as (
        select
          round(sum(total_amount), 2) as total,
          count(*) as accounts
        from mart.mart_expenses_by_account
      ),
      current_fy as (
        select date_part('year', now())::int + case when date_part('month', now())::int < 4 then -1 else 0 end as fy
      ),
      prior_fy as (
        select date_part('year', now())::int + case when date_part('month', now())::int < 4 then -2 else -1 end as fy
      ),
      fyear_totals as (
        select
          fiscal_year,
          round(sum(amount), 2) as fy_total
        from mart.mart_expenses_monthly
        group by fiscal_year
      ),
      lfy_total as (
        select fy_total from fyear_totals, prior_fy where fiscal_year = prior_fy.fy
      ),
      ytd_total as (
        select round(sum(amount), 2) as ytd from mart.mart_expenses_monthly, current_fy where fiscal_year = current_fy.fy
      ),
      top_acct as (
        select display_name, total_amount from mart.mart_expenses_by_account order by total_amount desc limit 1
      )
      select
        (select total from totals)::text as total,
        (select accounts from totals)::text as accounts,
        (select fy_total from lfy_total)::text as lfy,
        (select ytd from ytd_total)::text as ytd,
        (select total_amount from top_acct)::text as top_amt,
        (select display_name from top_acct)::text as top_name
    `);
    const r = rows[0];
    return {
      total_expenses: Number(r?.total ?? 0),
      account_count: Number(r?.accounts ?? 0),
      last_fiscal_year_total: Number(r?.lfy ?? 0),
      ytd_total: Number(r?.ytd ?? 0),
      top_account_amount: Number(r?.top_amt ?? 0),
      top_account_name: r?.top_name ?? '',
    };
  },
};

export interface ExpenseAccountRow {
  ledger_name: string;
  display_name: string;
  primary_group: string | null;
  total_amount: number;
  transaction_count: number;
  last_date: string | null;
}

export const expensesAccountsMetric: MetricDefinition<{ limit?: number }, ExpenseAccountRow[]> = {
  id: 'expenses.accounts',
  title: 'All expense accounts',
  description: 'Ranked by cumulative amount, with activity counts and dates.',
  params: [{ name: 'limit', type: 'number', default: 50 }],
  output: [
    { column: 'ledger_name', type: 'text' },
    { column: 'display_name', type: 'text' },
    { column: 'primary_group', type: 'text' },
    { column: 'total_amount', type: 'numeric' },
    { column: 'transaction_count', type: 'int' },
    { column: 'last_date', type: 'date' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_expenses_accounts' },
  run: async ({ limit = 50 } = {}) => {
    const rows = await query<ExpenseAccountRow>(
      `select ledger_name, display_name, primary_group, total_amount, transaction_count, last_date
       from mart.mart_expenses_by_account
       order by total_amount desc
       limit $1`,
      [limit],
    );
    return rows.map((r) => ({ ...r, total_amount: Number(r.total_amount) }));
  },
};

export interface ExpenseCategoryRow {
  primary_group: string | null;
  account_count: number;
  total_amount: number;
}

export const expensesCategoryMetric: MetricDefinition<Record<string, never>, ExpenseCategoryRow[]> = {
  id: 'expenses.category',
  title: 'Expenses by category',
  description: 'Rollup by primary group showing account count and total amount.',
  params: [],
  output: [
    { column: 'primary_group', type: 'text' },
    { column: 'account_count', type: 'int' },
    { column: 'total_amount', type: 'numeric' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_expenses_category' },
  run: async () => {
    const rows = await query<ExpenseCategoryRow>(
      `select primary_group, account_count, total_amount
       from mart.mart_expenses_by_category
       order by total_amount desc`
    );
    return rows.map((r) => ({ ...r, total_amount: Number(r.total_amount) }));
  },
};

export interface MonthlyExpenseRow {
  year_month: string;
  amount: number;
  transaction_count: number;
}

export const expensesTrendMetric: MetricDefinition<Record<string, never>, MonthlyExpenseRow[]> = {
  id: 'expenses.trend',
  title: 'Monthly expense trend',
  description: 'Month-by-month progression showing total amount and activity volume.',
  params: [],
  output: [
    { column: 'year_month', type: 'text', semantic: 'YYYY-MM' },
    { column: 'amount', type: 'numeric' },
    { column: 'transaction_count', type: 'int' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_expenses_trend' },
  run: async () => {
    const rows = await query<MonthlyExpenseRow>(
      `select year_month, amount, transaction_count
       from mart.mart_expenses_monthly
       order by year_month desc
       limit 24`
    );
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  },
};
