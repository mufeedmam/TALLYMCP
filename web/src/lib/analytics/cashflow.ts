// Cashflow analysis: money in/out through the bank + cash ledgers, presented as a
// proper cash-flow statement (Operating / Investing / Financing) plus a running
// monthly position.
//
// Sign: signed_amount is debit-positive, so a RECEIPT debits cash → positive (in);
// a PAYMENT credits cash → negative (out). Net movement ties to the bank/cash
// closing balance. The "statement" classifies the NON-cash counter-legs of each
// cash voucher by their account group — where the money came from / went to —
// then rolls those groups up into Operating / Investing / Financing activities.
// Internal contra (bank↔bank) nets to zero cash flow and never leaves the cluster.
import { query } from '@/lib/db';

export interface CashDateFilter {
  from?: string;
  to?: string;
}

const dateClause = 'and ($1::date is null or g.date >= $1::date) and ($2::date is null or g.date <= $2::date)';

/* ---------------- headline summary (also consumed by Overview) ---------------- */

export interface CashSummary {
  position: number;    // current net cash/bank balance (debit-positive; negative = overdrawn)
  inflow: number;
  outflow: number;
  net: number;
}

export async function getCashSummary(f: CashDateFilter = {}): Promise<CashSummary> {
  const rows = await query<{ inflow: string; outflow: string; net: string }>(
    `select round(coalesce(sum(g.signed_amount) filter (where g.signed_amount > 0),0),2) inflow,
            round(coalesce(-sum(g.signed_amount) filter (where g.signed_amount < 0),0),2) outflow,
            round(coalesce(sum(g.signed_amount),0),2) net
     from fact.fact_gl g join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
     where (dl.is_bank or dl.is_cash) and g.voucher_type <> 'Opening Balance' ${dateClause}`,
    [f.from ?? null, f.to ?? null],
  );
  const posRows = await query<{ position: string }>(
    `select round(coalesce(-sum(closing_balance),0),2) position from dim.dim_ledger where is_bank or is_cash`,
  );
  const r = rows[0];
  return {
    position: Number(posRows[0]?.position ?? 0),
    inflow: Number(r?.inflow ?? 0),
    outflow: Number(r?.outflow ?? 0),
    net: Number(r?.net ?? 0),
  };
}

/* ---------------- monthly statement with running balance ---------------- */

export interface MonthlyCash {
  year_month: string;
  cash_in: number;
  cash_out: number;
  net: number;
  close: number;   // running cash position at month end
}

export interface CashStatement {
  opening: number;        // cash position just before the period start
  closing: number;        // cash position at period end
  net: number;            // closing − opening (= Σ monthly net)
  months: MonthlyCash[];  // newest first
}

/** Cash position accumulated strictly before `from` (0 when unfiltered — this
 *  company carries no cash openings, and all movement is captured in fact_gl). */
async function openingCashBefore(from?: string): Promise<number> {
  if (!from) return 0;
  const rows = await query<{ opening: string }>(
    `select round(coalesce(sum(g.signed_amount),0),2) opening
     from fact.fact_gl g join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
     where (dl.is_bank or dl.is_cash) and g.voucher_type <> 'Opening Balance' and g.date < $1::date`,
    [from],
  );
  return Number(rows[0]?.opening ?? 0);
}

/** Monthly in/out/net plus a running closing position seeded from the opening. */
export async function loadCashStatement(f: CashDateFilter = {}): Promise<CashStatement> {
  const [opening, rows] = await Promise.all([
    openingCashBefore(f.from),
    query<{ year_month: string; cash_in: string; cash_out: string; net: string }>(
      `select to_char(g.date,'YYYY-MM') as year_month,
              round(coalesce(sum(g.signed_amount) filter (where g.signed_amount > 0),0),2) cash_in,
              round(coalesce(-sum(g.signed_amount) filter (where g.signed_amount < 0),0),2) cash_out,
              round(coalesce(sum(g.signed_amount),0),2) net
       from fact.fact_gl g join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
       where (dl.is_bank or dl.is_cash) and g.voucher_type <> 'Opening Balance' ${dateClause}
       group by 1 order by 1 asc`,
      [f.from ?? null, f.to ?? null],
    ),
  ]);

  // Accumulate oldest→newest so each month's `close` is the true running balance,
  // then hand the page newest-first for display.
  let run = opening;
  const asc: MonthlyCash[] = rows.map((r) => {
    run += Number(r.net);
    return {
      year_month: r.year_month,
      cash_in: Number(r.cash_in),
      cash_out: Number(r.cash_out),
      net: Number(r.net),
      close: Math.round(run * 100) / 100,
    };
  });

  return {
    opening,
    closing: Math.round(run * 100) / 100,
    net: Math.round((run - opening) * 100) / 100,
    months: asc.reverse(),
  };
}

/* ---------------- KPIs derived from the monthly series ---------------- */

export interface CashKpis {
  monthsActive: number;
  avgMonthlyNet: number;
  avgMonthlyIn: number;
  avgMonthlyOut: number;
  positiveMonths: number;
  bestMonth: { year_month: string; net: number } | null;
  worstMonth: { year_month: string; net: number } | null;
}

export function deriveCashKpis(months: MonthlyCash[]): CashKpis {
  const n = months.length;
  if (n === 0) {
    return { monthsActive: 0, avgMonthlyNet: 0, avgMonthlyIn: 0, avgMonthlyOut: 0, positiveMonths: 0, bestMonth: null, worstMonth: null };
  }
  const sum = (sel: (m: MonthlyCash) => number) => months.reduce((s, m) => s + sel(m), 0);
  const round = (x: number) => Math.round(x * 100) / 100;
  const best = months.reduce((a, b) => (b.net > a.net ? b : a));
  const worst = months.reduce((a, b) => (b.net < a.net ? b : a));
  return {
    monthsActive: n,
    avgMonthlyNet: round(sum((m) => m.net) / n),
    avgMonthlyIn: round(sum((m) => m.cash_in) / n),
    avgMonthlyOut: round(sum((m) => m.cash_out) / n),
    positiveMonths: months.filter((m) => m.net > 0).length,
    bestMonth: { year_month: best.year_month, net: best.net },
    worstMonth: { year_month: worst.year_month, net: worst.net },
  };
}

/* ---------------- cash-flow statement: Operating / Investing / Financing ---------------- */

export type Activity = 'Operating' | 'Investing' | 'Financing';
export const ACTIVITY_ORDER: Activity[] = ['Operating', 'Investing', 'Financing'];

// Map each counter-leg account's primary group to a cash-flow activity. Anything
// unmapped falls back to Operating (the common case for trading counter-legs).
const ACTIVITY_MAP: Record<string, Activity> = {
  'Sundry Debtors': 'Operating',
  'Sundry Creditors': 'Operating',
  'Current Assets': 'Operating',
  'Current Liabilities': 'Operating',
  'Direct Expenses': 'Operating',
  'Indirect Expenses': 'Operating',
  'Direct Incomes': 'Operating',
  'Indirect Incomes': 'Operating',
  'Duties & Taxes': 'Operating',
  'Provisions': 'Operating',
  'Stock-in-Hand': 'Operating',
  'Loans & Advances (Asset)': 'Operating',
  'Suspense A/c': 'Operating',
  'Misc. Expenses (ASSET)': 'Operating',
  'Fixed Assets': 'Investing',
  'Investments': 'Investing',
  'Capital Account': 'Financing',
  'Loans (Liability)': 'Financing',
  'Secured Loans': 'Financing',
  'Unsecured Loans': 'Financing',
  'Bank OD A/c': 'Financing',
  'Branch / Divisions': 'Financing',
};

export function classifyActivity(primaryGroup: string): Activity {
  return ACTIVITY_MAP[primaryGroup] ?? 'Operating';
}

export interface CashGroup {
  category: string;   // counter-leg primary group
  inflow: number;
  outflow: number;
  net: number;
}

export interface CashActivity {
  activity: Activity;
  inflow: number;
  outflow: number;
  net: number;
  groups: CashGroup[];  // sorted by gross magnitude, largest first
}

export interface CashFlowStatement {
  activities: CashActivity[];  // Operating, Investing, Financing (present ones only)
  inflow: number;
  outflow: number;
  net: number;
}

/** Non-cash counter-legs of cash vouchers, grouped by account group and rolled
 *  up into Operating / Investing / Financing activities. */
export async function loadCashFlowStatement(f: CashDateFilter = {}): Promise<CashFlowStatement> {
  const rows = await query<{ category: string; inflow: string; outflow: string }>(
    `with cv as (
       select g.voucher_guid, sum(g.signed_amount) cash_flow
       from fact.fact_gl g join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
       where (dl.is_bank or dl.is_cash) and g.voucher_type <> 'Opening Balance' ${dateClause}
       group by g.voucher_guid
     )
     select coalesce(dl.primary_group, '(unclassified)') as category,
            round(sum(case when cv.cash_flow > 0 then abs(g.signed_amount) else 0 end),2) inflow,
            round(sum(case when cv.cash_flow < 0 then abs(g.signed_amount) else 0 end),2) outflow
     from fact.fact_gl g
     join cv on cv.voucher_guid = g.voucher_guid
     join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
     where not (dl.is_bank or dl.is_cash)
     group by coalesce(dl.primary_group, '(unclassified)')
     having sum(abs(g.signed_amount)) > 0
     order by sum(abs(g.signed_amount)) desc`,
    [f.from ?? null, f.to ?? null],
  );

  const groups: CashGroup[] = rows.map((r) => {
    const inflow = Number(r.inflow);
    const outflow = Number(r.outflow);
    return { category: r.category, inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100 };
  });

  const byActivity = new Map<Activity, CashGroup[]>();
  for (const g of groups) {
    const a = classifyActivity(g.category);
    if (!byActivity.has(a)) byActivity.set(a, []);
    byActivity.get(a)!.push(g);
  }

  const activities: CashActivity[] = ACTIVITY_ORDER.filter((a) => byActivity.has(a)).map((a) => {
    const gs = byActivity.get(a)!.sort((x, y) => y.inflow + y.outflow - (x.inflow + x.outflow));
    const inflow = Math.round(gs.reduce((s, g) => s + g.inflow, 0) * 100) / 100;
    const outflow = Math.round(gs.reduce((s, g) => s + g.outflow, 0) * 100) / 100;
    return { activity: a, inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100, groups: gs };
  });

  const inflow = Math.round(activities.reduce((s, a) => s + a.inflow, 0) * 100) / 100;
  const outflow = Math.round(activities.reduce((s, a) => s + a.outflow, 0) * 100) / 100;
  return { activities, inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100 };
}

/* ---------------- where the cash sits (per-account snapshot) ---------------- */

export interface CashAccount {
  ledger_name: string;
  primary_group: string;
  is_cash: boolean;
  balance: number;   // debit-positive: +ve = funds on hand, −ve = overdrawn
}

/** Current balance of each bank/cash ledger. Point-in-time (not date-filtered) —
 *  it answers "where does our cash sit right now / which OD is drawn". */
export async function loadCashAccounts(): Promise<CashAccount[]> {
  const rows = await query<{ ledger_name: string; primary_group: string; is_cash: boolean; balance: string }>(
    `select ledger_name, coalesce(primary_group,'(none)') primary_group, is_cash,
            round(-closing_balance,2) balance
     from dim.dim_ledger
     where is_bank or is_cash
     order by round(-closing_balance,2) desc`,
  );
  return rows.map((r) => ({
    ledger_name: r.ledger_name,
    primary_group: r.primary_group,
    is_cash: r.is_cash,
    balance: Number(r.balance),
  }));
}

export function parseCashFilter(sp: Record<string, string | string[] | undefined>): CashDateFilter {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  return { from: one('from'), to: one('to') };
}
