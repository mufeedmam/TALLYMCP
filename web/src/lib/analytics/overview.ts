// Headline figures for the Overview dashboard — one lightweight aggregate query
// per domain, run in parallel. Everything reads the reconciled marts/dims.
import { query } from '@/lib/db';
import { getCashSummary } from './cashflow';

export interface Overview {
  receivable: number;
  debtors: number;
  receivableOverduePct: number;
  payable: number;
  suppliers: number;
  stockValue: number;
  grossMarginPct: number | null;
  slowMovers: number;
  cashPosition: number;
  expensesFY: number;
  lastSync: string | null;
  oldestReceivableDays: number | null;
}

export async function getOverview(): Promise<Overview> {
  const [recv, pay, inv, cash, exp, sync, aging] = await Promise.all([
    query<{ net: string; debtors: string }>(
      `select round(coalesce(sum(receivable_dr),0),2) net,
              count(*) filter (where balance_type='receivable') debtors
       from mart.mart_party_receivables`,
    ),
    query<{ net: string; suppliers: string }>(
      `select round(coalesce(-sum(closing_balance),0),2) net,
              count(*) filter (where closing_balance>0) suppliers
       from dim.dim_ledger where is_payable`,
    ),
    query<{ value: string; margin: string | null; slow: string }>(
      `select round(coalesce(sum(stock_value),0),2) value,
              round(100*coalesce(sum(gross_profit),0)/nullif(sum(sales_value),0),1) margin,
              count(*) filter (where qty<>0 and days_since_movement>180) slow
       from mart.mart_inventory_items`,
    ),
    getCashSummary(),
    query<{ fy: string }>(
      `select round(coalesce(sum(amount),0),2) fy from mart.mart_expenses_monthly
       where fiscal_year = date_part('year', now())::int + case when date_part('month', now())::int < 4 then -1 else 0 end`,
    ),
    query<{ last_success_at: string | null }>(`select last_success_at from meta.last_sync`),
    query<{ overdue_pct: string | null; oldest: number | null }>(
      `select round(100 * sum(remaining_amount) filter (where (as_of_date - opened_date) > 30) / nullif(sum(remaining_amount) filter (where remaining_amount>0),0), 0) overdue_pct,
              max(as_of_date - opened_date) filter (where remaining_amount>0) oldest
       from fact.fact_receivables_fifo where remaining_amount>0`,
    ),
  ]);

  return {
    receivable: Number(recv[0]?.net ?? 0),
    debtors: Number(recv[0]?.debtors ?? 0),
    receivableOverduePct: Number(aging[0]?.overdue_pct ?? 0),
    oldestReceivableDays: aging[0]?.oldest ?? null,
    payable: Number(pay[0]?.net ?? 0),
    suppliers: Number(pay[0]?.suppliers ?? 0),
    stockValue: Number(inv[0]?.value ?? 0),
    grossMarginPct: inv[0]?.margin != null ? Number(inv[0].margin) : null,
    slowMovers: Number(inv[0]?.slow ?? 0),
    cashPosition: cash.position,
    expensesFY: Number(exp[0]?.fy ?? 0),
    lastSync: sync[0]?.last_success_at ?? null,
  };
}
