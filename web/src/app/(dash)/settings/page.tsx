import Link from 'next/link';
import { isDbConfigured, query } from '@/lib/db';
import { getCompanyName } from '@/lib/company';
import { listMetrics } from '@/lib/analytics';
import { PageHeader, Card, Table, Th, Td, Tr, Badge, Money, formatCompact } from '@/components/kit';
import SectionPlaceholder from '@/components/SectionPlaceholder';

export const dynamic = 'force-dynamic';

const TOL = 1;

export default async function SettingsPage() {
  if (!isDbConfigured()) {
    return <SectionPlaceholder title="Settings" bucket="Not connected" items={['Configure DATABASE_URL to see live data.']} />;
  }

  const [company, runs, cfgRows, integ] = await Promise.all([
    getCompanyName(),
    query<{ id: string; sync_type: string; status: string; finished: string | null; rows: string | null }>(
      `select id, sync_type, status, to_char(finished_at,'YYYY-MM-DD HH24:MI') finished, rows_processed rows
       from meta.sync_runs order by id desc limit 8`,
    ),
    query<{ key: string; value: unknown; category: string }>(
      `select key, value, category from meta.app_config order by category, key`,
    ),
    // Lightweight live tie-outs (the DB reconcile gate has the full set).
    query<{ label: string; a: string; b: string }>(
      `select 'Receivables mart == ledger closing' label,
              (select round(sum(receivable_dr),2) from mart.mart_party_receivables)::text a,
              (select round(-sum(closing_balance),2) from dim.dim_ledger where is_receivable)::text b
       union all
       select 'Inventory mart == Tally valuation',
              (select round(sum(stock_value),2) from mart.mart_inventory_items)::text,
              (select round(-sum(closing_value),2) from mst_stock_item)::text
       union all
       select 'GL vouchers balance (Dr=Cr)',
              (select round(sum(debit_amount),2) from fact.fact_gl where voucher_type<>'Opening Balance')::text,
              (select round(sum(credit_amount),2) from fact.fact_gl where voucher_type<>'Opening Balance')::text`,
    ),
  ]);

  const metrics = listMetrics();
  const checks = integ.map((r) => ({ label: r.label, a: Number(r.a), b: Number(r.b), ok: Math.abs(Number(r.a) - Number(r.b)) <= TOL }));
  const allOk = checks.every((c) => c.ok);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Settings" title="Settings & health" description="Company, sync status, data integrity, and the analytics API." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Company & sync">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Company</dt><dd className="truncate font-medium">{company ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Metrics registered</dt><dd className="font-medium">{metrics.length}</dd></div>
          </dl>
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Recent syncs</div>
            <Table>
              <thead><tr><Th>#</Th><Th>Type</Th><Th>Status</Th><Th>Finished</Th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <Tr key={r.id}>
                    <Td className="tnum">{r.id}</Td>
                    <Td muted className="text-xs">{r.sync_type}</Td>
                    <Td><Badge tone={r.status === 'success' ? 'good' : r.status === 'failed' ? 'danger' : 'warn'}>{r.status}</Badge></Td>
                    <Td muted className="text-xs">{r.finished ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <Card title="Data integrity" actions={<Badge tone={allOk ? 'good' : 'danger'}>{allOk ? 'All tie out' : 'Mismatch'}</Badge>}>
          <Table>
            <thead><tr><Th>Check</Th><Th align="right">Derived</Th><Th align="right">Source</Th><Th align="right"> </Th></tr></thead>
            <tbody>
              {checks.map((c) => (
                <Tr key={c.label}>
                  <Td className="text-xs">{c.label}</Td>
                  <Td align="right"><Money value={c.a} /></Td>
                  <Td align="right" muted><Money value={c.b} /></Td>
                  <Td align="right"><Badge tone={c.ok ? 'good' : 'danger'}>{c.ok ? '✓' : '✗'}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">Live tie-outs. The full 14-check reconciliation gate runs in the data pipeline (<code>npm run check</code>).</p>
        </Card>

        <Card title="Analytics API (AI / MCP ready)">
          <p className="text-sm text-muted-foreground">
            Every dashboard number is a registered metric, exposed as a machine-readable catalog an MCP
            server can introspect and call — no rework needed to add an AI layer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href="/api/metrics" className="rounded-md border bg-background px-2.5 py-1.5 font-mono text-primary transition-colors hover:bg-muted">GET /api/metrics</Link>
            <span className="rounded-md border bg-background px-2.5 py-1.5 font-mono text-muted-foreground">GET /api/metrics/{'{id}'}</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Read-only. Add authentication before exposing publicly.</p>
        </Card>

        <Card title="Thresholds">
          <p className="mb-3 text-sm text-muted-foreground">Tunable per section (in each section&apos;s “Thresholds” drawer). Current values:</p>
          <Table>
            <thead><tr><Th>Key</Th><Th align="right">Value</Th></tr></thead>
            <tbody>
              {cfgRows.map((r) => (
                <Tr key={r.key}>
                  <Td className="font-mono text-xs">{r.key}</Td>
                  <Td align="right" muted className="tnum text-xs">{JSON.stringify(r.value)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
