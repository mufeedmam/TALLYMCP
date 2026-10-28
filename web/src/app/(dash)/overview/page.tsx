import Link from 'next/link';
import { isDbConfigured } from '@/lib/db';
import { getOverview } from '@/lib/analytics/overview';
import { PageHeader, Card, StatTile, Badge, formatCompact } from '@/components/kit';
import SectionPlaceholder from '@/components/SectionPlaceholder';

export const dynamic = 'force-dynamic';

function KpiLink({ href, label, value, sub, tone }: { href: string; label: string; value: string; sub?: React.ReactNode; tone?: 'default' | 'warn' | 'danger' | 'good' }) {
  return (
    <Link href={href} className="block rounded-xl transition-transform hover:-translate-y-0.5">
      <StatTile label={label} value={value} sub={sub} tone={tone} />
    </Link>
  );
}

export default async function OverviewPage() {
  if (!isDbConfigured()) {
    return <SectionPlaceholder title="Overview" bucket="Not connected" items={['Configure DATABASE_URL to see live data.']} />;
  }

  const o = await getOverview();
  const workingCapital = o.receivable + o.stockValue + o.cashPosition - o.payable;

  const sections = [
    { href: '/receivables', title: 'Receivables', desc: 'Aging, profitability, risk, dormant, unusual — FIFO & bill-wise' },
    { href: '/payables', title: 'Payables', desc: 'Supplier aging, groupwise, margin contribution' },
    { href: '/inventory', title: 'Inventory', desc: 'Stock, movement, profitability, slow/dead' },
    { href: '/cashflow', title: 'Cashflow', desc: 'In vs out, sources & uses of cash' },
    { href: '/expenses', title: 'Expenses', desc: 'Accounts, categories, monthly trend' },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        description="Live position across the business, reconciled to Tally."
        actions={<Badge tone="good">Working capital {formatCompact(workingCapital)}</Badge>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiLink href="/receivables" label="Receivable" value={formatCompact(o.receivable)} sub={`${o.debtors} debtors · ${o.receivableOverduePct}% overdue`} tone={o.receivableOverduePct >= 50 ? 'warn' : 'default'} />
        <KpiLink href="/payables" label="Payable" value={formatCompact(o.payable)} sub={`${o.suppliers} suppliers owed`} />
        <KpiLink href="/cashflow" label="Cash position" value={formatCompact(o.cashPosition)} sub={o.cashPosition < 0 ? 'Overdrawn' : 'Bank + cash'} tone={o.cashPosition < 0 ? 'danger' : 'good'} />
        <KpiLink href="/inventory" label="Stock value" value={formatCompact(o.stockValue)} sub={o.grossMarginPct != null ? `${o.grossMarginPct}% gross margin` : undefined} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiLink href="/expenses" label="Expenses (this FY)" value={formatCompact(o.expensesFY)} />
        <KpiLink href="/inventory?tab=slow" label="Slow / dead stock" value={String(o.slowMovers)} sub="180+ days idle" tone={o.slowMovers > 0 ? 'warn' : 'good'} />
        <KpiLink href="/receivables?tab=aging" label="Oldest receivable" value={o.oldestReceivableDays != null ? `${o.oldestReceivableDays}d` : '—'} tone={(o.oldestReceivableDays ?? 0) > 365 ? 'danger' : 'default'} />
        <StatTile label="Net working capital" value={formatCompact(workingCapital)} sub="Receivable + stock + cash − payable" tone="good" />
      </div>

      <Card title="Sections">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link key={s.href} href={s.href} className="rounded-lg border bg-background p-4 transition-colors hover:border-primary hover:bg-muted/40">
              <div className="text-sm font-medium text-foreground">{s.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.desc}</div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
