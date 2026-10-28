import Link from 'next/link';
import { notFound } from 'next/navigation';
import { runMetric } from '@/lib/analytics';
import type { ItemDetail } from '@/lib/analytics/metrics/inventory';
import {
  PageHeader, Card, StatTile, Table, Th, Td, Tr, Badge, EmptyState, Note, Money, formatCompact,
} from '@/components/kit';

function fmtQty(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export default async function ItemDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const item = decodeURIComponent(name);
  const d = await runMetric<ItemDetail | null>('inventory.itemDetail', { item });
  if (!d) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/inventory" className="text-xs text-neutral-400 transition-colors hover:text-primary dark:hover:text-primary">
        ← Back to Inventory
      </Link>

      <div className="mt-2">
        <PageHeader
          eyebrow={[d.stock_group, d.category].filter(Boolean).join(' · ') || undefined}
          title={d.item}
          actions={d.profit_unreliable ? <Badge tone="warn">profit unreliable</Badge> : undefined}
        />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="In stock" value={`${fmtQty(d.qty)} ${d.uom ?? ''}`} sub={`Value ${formatCompact(d.stock_value)}`} tone={d.qty < 0 ? 'danger' : 'default'} />
        <StatTile label="Sales" value={formatCompact(d.sales_value)} sub={`${fmtQty(d.outward_qty)} out`} />
        <StatTile label="Gross profit" value={formatCompact(d.gross_profit)} sub={`COGS ${formatCompact(d.cogs)}`} tone={d.gross_profit < 0 ? 'danger' : 'good'} />
        <StatTile label="Margin" value={d.gross_margin_pct != null ? `${d.gross_margin_pct}%` : '—'} tone={d.gross_margin_pct != null && d.gross_margin_pct < 0 ? 'danger' : 'good'} />
      </div>

      <Card
        title={`Movement history (${d.total_movements.toLocaleString('en-IN')})`}
        actions={d.total_movements > d.transactions.length
          ? <span className="text-xs text-neutral-400">most recent {d.transactions.length} shown</span>
          : undefined}
        padded={false}
      >
        <div className="px-5 pb-5 pt-1">
          {d.transactions.length === 0 ? (
            <EmptyState message="No stock movement recorded for this item." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th><Th>Voucher</Th><Th>Party</Th>
                  <Th align="right">Qty</Th><Th align="right">Rate</Th><Th align="right">Value</Th><Th align="right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {d.transactions.map((t, i) => {
                  const inward = t.quantity > 0;
                  return (
                    <Tr key={i}>
                      <Td className="whitespace-nowrap">{t.date}</Td>
                      <Td muted className="whitespace-nowrap text-xs">{t.voucher_type} {t.voucher_number}</Td>
                      <Td muted className="max-w-[12rem] truncate text-xs">{t.party ?? ''}</Td>
                      <Td align="right" className="tnum">
                        <span className={inward ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-600 dark:text-neutral-300'}>
                          {inward ? '+' : ''}{fmtQty(t.quantity)}
                        </span>
                      </Td>
                      <Td align="right" muted className="tnum">{t.rate.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</Td>
                      <Td align="right"><Money value={Math.abs(t.amount)} /></Td>
                      <Td align="right" className="tnum font-medium">{fmtQty(t.running_qty)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      <Note>
        Newest first. Quantity is physical (+inward / −outward); the running balance is cumulative
        stock on hand, computed across the item&apos;s full history even when only the most recent
        movements are listed. Value shown is the voucher line amount (purchase cost on inward, sale
        value on outward).
      </Note>
    </div>
  );
}
