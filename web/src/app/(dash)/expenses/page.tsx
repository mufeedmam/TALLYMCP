import { runMetric } from '@/lib/analytics';
import { isDbConfigured } from '@/lib/db';
import { StatTile, formatCompact } from '@/components/StatTile';
import SectionPlaceholder from '@/components/SectionPlaceholder';
import type {
  ExpensesSnapshot,
  ExpenseAccountRow,
  ExpenseCategoryRow,
  MonthlyExpenseRow,
} from '@/lib/analytics/metrics/expenses';

export default async function ExpensesPage() {
  if (!isDbConfigured()) {
    return (
      <SectionPlaceholder
        title="Expenses"
        bucket="B5 — not connected"
        items={['Configure DATABASE_URL to see live data.']}
      />
    );
  }

  const [snapshot, accounts, categories, trend] = await Promise.all([
    runMetric<ExpensesSnapshot>('expenses.snapshot'),
    runMetric<ExpenseAccountRow[]>('expenses.accounts', { limit: 20 }),
    runMetric<ExpenseCategoryRow[]>('expenses.category'),
    runMetric<MonthlyExpenseRow[]>('expenses.trend'),
  ]);

  const ytdGrowth = snapshot.last_fiscal_year_total > 0
    ? Math.round(((snapshot.ytd_total - snapshot.last_fiscal_year_total) / snapshot.last_fiscal_year_total) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Analytics
      </div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Expenses</h1>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatTile label="Total expenses" value={formatCompact(snapshot.total_expenses)} sub={`${snapshot.account_count} accounts`} />
        <StatTile label="Last FY total" value={formatCompact(snapshot.last_fiscal_year_total)} sub="Prior fiscal year" />
        <StatTile label="YTD expenses" value={formatCompact(snapshot.ytd_total)} sub={ytdGrowth > 0 ? `+${ytdGrowth}%` : `${ytdGrowth}%`} />
        <StatTile label="Largest account" value={formatCompact(snapshot.top_account_amount)} sub={snapshot.top_account_name} />
      </div>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-card p-5">
        <div className="mb-3 text-sm font-medium text-neutral-700">Top expense accounts</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="py-2 font-normal">Account</th>
              <th className="py-2 font-normal">Category</th>
              <th className="py-2 font-normal text-right">Total amount</th>
              <th className="py-2 font-normal text-right">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((r) => (
              <tr key={r.ledger_name} className="border-b border-neutral-100 last:border-0">
                <td className="py-2">{r.display_name}</td>
                <td className="py-2 text-neutral-500 text-xs">{r.primary_group ?? '—'}</td>
                <td className="py-2 text-right tabular-nums">₹{r.total_amount.toLocaleString('en-IN')}</td>
                <td className="py-2 text-right tabular-nums text-neutral-500">{r.transaction_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-card p-5">
          <div className="mb-3 text-sm font-medium text-neutral-700">Expenses by category</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="py-2 font-normal">Category</th>
                <th className="py-2 font-normal text-right">Accounts</th>
                <th className="py-2 font-normal text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((r) => (
                <tr key={r.primary_group ?? 'other'} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2">{r.primary_group ?? '(Unclassified)'}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-500">{r.account_count}</td>
                  <td className="py-2 text-right tabular-nums">₹{r.total_amount.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-card p-5">
          <div className="mb-3 text-sm font-medium text-neutral-700">Monthly trend (24mo)</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="py-2 font-normal">Month</th>
                <th className="py-2 font-normal text-right">Amount</th>
                <th className="py-2 font-normal text-right">Txns</th>
              </tr>
            </thead>
            <tbody>
              {trend.slice(0, 12).map((r) => (
                <tr key={r.year_month} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2 text-neutral-500">{r.year_month}</td>
                  <td className="py-2 text-right tabular-nums">₹{r.amount.toLocaleString('en-IN')}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-500">{r.transaction_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-neutral-400">
        Expenses cover all GL accounts that are not receivable, payable, bank, or cash accounts. Primarily audit and compliance fees for this services firm.
      </p>
    </div>
  );
}
