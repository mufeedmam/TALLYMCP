import Link from 'next/link';
import { isDbConfigured } from '@/lib/db';
import {
  getCashSummary, loadCashStatement, loadCashFlowStatement, loadCashAccounts,
  deriveCashKpis, parseCashFilter, type CashActivity,
} from '@/lib/analytics/cashflow';
import {
  PageHeader, Card, StatTile, Table, Th, Td, Tr, Badge, EmptyState, Note, Money,
  MiniBar, Chevron, formatCompact,
} from '@/components/kit';
import SectionPlaceholder from '@/components/SectionPlaceholder';

type SP = Record<string, string | string[] | undefined>;

const inputCls =
  'rounded-md border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none';

// Shared column template so the statement header, activity subtotals and the
// expandable group detail all line up on the same grid.
const STMT_COLS = 'grid grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_8rem] items-center gap-x-3';

/** Signed money, coloured by direction (green in, red out). */
function Signed({ value }: { value: number }) {
  const tone = value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <span className={`tnum font-medium ${tone}`}>
      {value >= 0 ? '+' : '−'}{formatCompact(Math.abs(value)).replace('-', '')}
    </span>
  );
}

export default async function CashflowPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isDbConfigured()) {
    return <SectionPlaceholder title="Cashflow" bucket="Cashflow — not connected" items={['Configure DATABASE_URL to see live data.']} />;
  }

  const sp = await searchParams;
  const filter = parseCashFilter(sp);
  const [summary, statement, cashStmt, accounts] = await Promise.all([
    getCashSummary(filter),
    loadCashFlowStatement(filter),
    loadCashStatement(filter),
    loadCashAccounts(),
  ]);
  const kpis = deriveCashKpis(cashStmt.months);
  const filtered = Boolean(filter.from || filter.to);
  const maxActivityNet = Math.max(...statement.activities.map((x) => Math.abs(x.net)), 1);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Analytics"
        title="Cashflow"
        description="Money in and out through the bank & cash ledgers, arranged as a cash-flow statement. Net movement ties to the cash position; internal bank-to-bank transfers net out."
        actions={
          <form method="GET" className="flex items-end gap-2">
            <input className={inputCls} type="date" name="from" defaultValue={filter.from ?? ''} aria-label="From" />
            <span className="pb-1.5 text-xs text-muted-foreground">→</span>
            <input className={inputCls} type="date" name="to" defaultValue={filter.to ?? ''} aria-label="To" />
            <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Apply</button>
            {filtered && <Link href="/cashflow" className="pb-1.5 text-xs text-muted-foreground hover:text-foreground">Clear</Link>}
          </form>
        }
      />

      {/* Headline position */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Cash position" value={formatCompact(summary.position)} sub={summary.position < 0 ? 'Overdrawn / net credit' : 'Bank + cash on hand'} tone={summary.position < 0 ? 'danger' : 'good'} />
        <StatTile label={filtered ? 'Net flow (period)' : 'Net flow (all time)'} value={formatCompact(summary.net)} sub="Cash in − cash out" tone={summary.net < 0 ? 'danger' : 'good'} />
        <StatTile label="Cash in" value={formatCompact(summary.inflow)} sub="Receipts" tone="good" />
        <StatTile label="Cash out" value={formatCompact(summary.outflow)} sub="Payments" tone="warn" />
      </div>

      {/* Flow dynamics */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Avg monthly net" value={formatCompact(kpis.avgMonthlyNet)} sub={`Over ${kpis.monthsActive} active month${kpis.monthsActive === 1 ? '' : 's'}`} tone={kpis.avgMonthlyNet < 0 ? 'danger' : 'good'} />
        <StatTile label="Best month" value={kpis.bestMonth ? formatCompact(kpis.bestMonth.net) : '—'} sub={kpis.bestMonth?.year_month} tone="good" />
        <StatTile label="Worst month" value={kpis.worstMonth ? formatCompact(kpis.worstMonth.net) : '—'} sub={kpis.worstMonth?.year_month} tone="danger" />
        <StatTile label="Cash-positive months" value={kpis.monthsActive ? `${kpis.positiveMonths}/${kpis.monthsActive}` : '—'} sub="Months net cash generated" tone={kpis.positiveMonths * 2 >= kpis.monthsActive ? 'good' : 'warn'} />
      </div>

      {/* Cash-flow statement */}
      <Card
        title="Cash-flow statement"
        actions={<span className="hidden text-xs text-muted-foreground sm:inline">Classified by counter-party · click an activity for detail</span>}
        padded={false}
        className="mb-6"
      >
        <div className="px-5 pb-5 pt-2">
          {statement.activities.length === 0 ? (
            <EmptyState message="No cash movement in this range." />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[34rem]">
                {/* header */}
                <div className={`${STMT_COLS} border-b pb-2 text-xs font-medium text-muted-foreground`}>
                  <span>Activity</span>
                  <span className="text-right">Cash in</span>
                  <span className="text-right">Cash out</span>
                  <span className="text-right">Net</span>
                  <span className="pl-2">Net share</span>
                </div>

                {statement.activities.map((a) => (
                  <ActivitySection key={a.activity} a={a} maxNet={maxActivityNet} />
                ))}

                {/* net change */}
                <div className={`${STMT_COLS} border-t-2 border-border py-2.5 text-sm font-semibold`}>
                  <span>Net change in cash</span>
                  <span className="text-right tnum text-emerald-600 dark:text-emerald-400">{formatCompact(statement.inflow)}</span>
                  <span className="text-right tnum text-destructive">{formatCompact(statement.outflow)}</span>
                  <span className="text-right"><Signed value={statement.net} /></span>
                  <span />
                </div>
              </div>
            </div>
          )}

          {/* Reconciliation: opening + net = closing */}
          {statement.activities.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Opening cash <span className="tnum font-medium text-foreground">{formatCompact(cashStmt.opening)}</span></span>
              <span className="text-muted-foreground">+ Net movement <span className="tnum font-medium text-foreground">{formatCompact(cashStmt.net)}</span></span>
              <span className="text-muted-foreground">= Closing cash <span className="tnum font-semibold text-foreground">{formatCompact(cashStmt.closing)}</span></span>
              {!filtered && (
                <Badge tone={Math.abs(cashStmt.closing - summary.position) < 1 ? 'good' : 'warn'}>Ties to Tally position</Badge>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Where the cash sits */}
        <Card title="Cash position by account" padded={false} className="lg:col-span-2">
          <div className="px-5 pb-5 pt-1">
            {accounts.length === 0 ? <EmptyState message="No bank or cash ledgers." /> : (
              <Table>
                <thead><tr><Th>Account</Th><Th align="right">Balance</Th></tr></thead>
                <tbody>
                  {accounts.map((acc) => (
                    <Tr key={acc.ledger_name}>
                      <Td>
                        <span className="text-foreground">{acc.ledger_name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{acc.is_cash ? 'Cash' : acc.primary_group}</span>
                      </Td>
                      <Td align="right" className={acc.balance < 0 ? 'tnum text-destructive' : 'tnum text-foreground'}>
                        <Money value={acc.balance} />
                      </Td>
                    </Tr>
                  ))}
                  <tr className="border-t-2 border-border">
                    <Td className="font-semibold">Net cash position</Td>
                    <Td align="right" className={summary.position < 0 ? 'tnum font-semibold text-destructive' : 'tnum font-semibold text-foreground'}>
                      <Money value={summary.position} />
                    </Td>
                  </tr>
                </tbody>
              </Table>
            )}
          </div>
        </Card>

        {/* Monthly running cashflow */}
        <Card title="Monthly cashflow" padded={false} className="lg:col-span-3">
          <div className="px-5 pb-5 pt-1">
            {cashStmt.months.length === 0 ? <EmptyState message="No cash movement in this range." /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>Month</Th>
                    <Th align="right">Cash in</Th>
                    <Th align="right">Cash out</Th>
                    <Th align="right">Net</Th>
                    <Th align="right">Closing cash</Th>
                  </tr>
                </thead>
                <tbody>
                  {cashStmt.months.map((m) => (
                    <Tr key={m.year_month}>
                      <Td className="tnum text-muted-foreground">{m.year_month}</Td>
                      <Td align="right" className="tnum text-emerald-600 dark:text-emerald-400">{formatCompact(m.cash_in)}</Td>
                      <Td align="right" className="tnum text-destructive">{formatCompact(m.cash_out)}</Td>
                      <Td align="right"><Signed value={m.net} /></Td>
                      <Td align="right" className={m.close < 0 ? 'tnum text-destructive' : 'tnum text-foreground'}>{formatCompact(m.close)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <Note>
        Cash in = receipts (cash/bank debited); cash out = payments (credited). Each cash voucher&apos;s
        other leg is classified by its account group and rolled up into <strong>Operating</strong> (trade,
        expenses, taxes), <strong>Investing</strong> (fixed assets, investments) and <strong>Financing</strong>
        {' '}(loans, capital, inter-branch) activities. Bank-to-bank transfers net to zero and are excluded.
        Opening + net movement = closing cash, which ties to the live Tally cash position.
      </Note>
    </div>
  );
}

/* ---------------- statement section: activity subtotal + expandable groups ---------------- */

function ActivitySection({ a, maxNet }: { a: CashActivity; maxNet: number }) {
  const tone: Record<string, 'info' | 'warn' | 'neutral'> = { Operating: 'info', Investing: 'neutral', Financing: 'warn' };
  return (
    <details className="group/act border-b border-border/60">
      <summary className={`${STMT_COLS} cursor-pointer list-none py-2.5 text-sm transition-colors hover:bg-muted/40`}>
        <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
          <span className="shrink-0 transition-transform group-open/act:rotate-90"><Chevron /></span>
          <span className="truncate">{a.activity} activities</span>
          <Badge tone={tone[a.activity] ?? 'neutral'}>{a.groups.length}</Badge>
        </span>
        <span className="text-right tnum text-emerald-600 dark:text-emerald-400">{formatCompact(a.inflow)}</span>
        <span className="text-right tnum text-destructive">{formatCompact(a.outflow)}</span>
        <span className="text-right"><Signed value={a.net} /></span>
        <span className="pl-2"><MiniBar value={Math.abs(a.net)} max={maxNet} tone={a.net < 0 ? 'red' : 'primary'} /></span>
      </summary>

      <div className="pb-1">
        {a.groups.map((g) => (
          <div key={g.category} className={`${STMT_COLS} py-1.5 text-sm text-muted-foreground`}>
            <span className="truncate pl-7">{g.category}</span>
            <span className="text-right tnum text-emerald-600/90 dark:text-emerald-400/90">{g.inflow ? formatCompact(g.inflow) : '—'}</span>
            <span className="text-right tnum text-destructive/90">{g.outflow ? formatCompact(g.outflow) : '—'}</span>
            <span className="text-right"><Signed value={g.net} /></span>
            <span />
          </div>
        ))}
      </div>
    </details>
  );
}
