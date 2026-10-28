import Link from 'next/link';
import { isDbConfigured } from '@/lib/db';
import { getReceivablesConfig } from '@/lib/analytics/receivablesConfig';
import { bucketFor, bucketOrder, buildQuery } from '@/lib/analytics/receivablesData';
import { loadPayableLayers, getPayableGroups, parsePayableFilters, type PayableLayer } from '@/lib/analytics/payablesData';
import { loadSupplierProfitability } from '@/lib/analytics/profitability';
import {
  PageHeader, Card, StatTile, Table, Th, Td, Tr, EmptyState, Note, Money, MiniBar, formatCompact,
} from '@/components/kit';
import AgingBarChart from '@/components/AgingBarChart';
import GroupReport, { type GroupReportGroup } from '@/components/inventory/GroupReport';
import PayablesTabs from '@/components/payables/Tabs';
import PayablesFilterBar from '@/components/payables/FilterBar';
import SectionPlaceholder from '@/components/SectionPlaceholder';

type SP = Record<string, string | string[] | undefined>;

function partyHref(ledger: string, qs: string) {
  return `/payables/party/${encodeURIComponent(ledger)}${qs}`;
}

function rollupSuppliers(layers: PayableLayer[]) {
  const m = new Map<string, { ledger_name: string; party: string; group_name: string; owed: number; oldest: number; count: number }>();
  for (const l of layers) {
    const e = m.get(l.ledger_name) ?? { ledger_name: l.ledger_name, party: l.party, group_name: l.group_name, owed: 0, oldest: 0, count: 0 };
    e.owed += l.owed_amount;
    e.oldest = Math.max(e.oldest, l.age_days);
    e.count += 1;
    m.set(l.ledger_name, e);
  }
  return [...m.values()];
}

export default async function PayablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isDbConfigured()) {
    return <SectionPlaceholder title="Payables" bucket="B4 — not connected" items={['Configure DATABASE_URL to see live data.']} />;
  }

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) || 'snapshot';
  const filters = parsePayableFilters(sp);
  const qs = buildQuery(sp, {});

  const [cfg, groups, allLayers] = await Promise.all([
    getReceivablesConfig(),
    getPayableGroups(),
    loadPayableLayers(filters),
  ]);

  const layers = filters.bucket
    ? allLayers.filter((l) => l.owed_amount > 0 && bucketFor(l.age_days, cfg.agingEdges) === filters.bucket)
    : allLayers;
  const owedLayers = layers.filter((l) => l.owed_amount > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={tab === 'snapshot' ? 'Snapshot' : 'Detailed'}
        title="Payables"
        description="What we owe suppliers, FIFO-aged from the ledger. Ties to each supplier's Tally closing balance."
      />
      <PayablesTabs active={tab} sp={sp} />
      <PayablesFilterBar tab={tab} filters={filters} groups={groups} sp={sp} resultCount={owedLayers.length} />

      <div className="mt-1">
        {tab === 'snapshot' && <SnapshotTab layers={owedLayers} allLayers={layers} cfg={cfg} sp={sp} qs={qs} />}
        {tab === 'aging' && <AgingTab layers={owedLayers} cfg={cfg} sp={sp} filters={filters} />}
        {tab === 'groupwise' && <GroupwiseTab layers={owedLayers} cfg={cfg} qs={qs} />}
        {tab === 'profitability' && <ProfitabilityTab filters={filters} qs={qs} />}
      </div>
    </div>
  );
}

type Cfg = Awaited<ReturnType<typeof getReceivablesConfig>>;

function bucketRows(layers: PayableLayer[], edges: number[]) {
  const order = bucketOrder(edges);
  const totals = new Map(order.map((b) => [b, { amount: 0, count: 0 }]));
  for (const l of layers) {
    const t = totals.get(bucketFor(l.age_days, edges));
    if (!t) continue;
    t.amount += l.owed_amount;
    t.count += 1;
  }
  return order.map((b) => ({ bucket: b, amount: Math.round((totals.get(b)?.amount ?? 0) * 100) / 100, layer_count: totals.get(b)?.count ?? 0 }));
}

function SnapshotTab({ layers, allLayers, cfg, sp, qs }: { layers: PayableLayer[]; allLayers: PayableLayer[]; cfg: Cfg; sp: SP; qs: string }) {
  const buckets = bucketRows(layers, cfg.agingEdges);
  const total = allLayers.reduce((s, l) => s + l.owed_amount, 0);
  const advances = allLayers.filter((l) => l.owed_amount < 0).reduce((s, l) => s + l.owed_amount, 0);
  const firstEdge = Math.min(...cfg.agingEdges);
  const overdue = layers.filter((l) => l.age_days > firstEdge).reduce((s, l) => s + l.owed_amount, 0);
  const overduePct = total > 0 ? Math.round((overdue / total) * 100) : 0;
  const oldest = layers.reduce((m, l) => Math.max(m, l.age_days), 0);
  const top = rollupSuppliers(layers).sort((a, b) => b.owed - a.owed).slice(0, 10);
  const maxTop = top[0]?.owed ?? 1;
  const suppliers = new Set(layers.map((l) => l.ledger_name)).size;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total payable" value={formatCompact(total)} sub={`${suppliers} suppliers`} />
        <StatTile label={`Overdue (${firstEdge}+ days)`} value={`${overduePct}%`} sub={formatCompact(overdue)} tone={overduePct >= 50 ? 'danger' : overduePct >= 25 ? 'warn' : 'default'} />
        <StatTile label="Oldest unpaid" value={oldest ? `${oldest} days` : '—'} tone={oldest > 180 ? 'warn' : 'default'} />
        <StatTile label="Advances paid" value={formatCompact(Math.abs(advances))} sub="Debit balances" />
      </div>

      <Card title="Aging profile" actions={<span className="text-xs text-muted-foreground">Click a bar to filter</span>}>
        <AgingBarChart data={buckets} hrefFor={(b) => `/payables${buildQuery(sp, { tab: 'groupwise', bucket: b })}`} />
      </Card>

      <Card title="Top suppliers owed" padded={false}>
        <div className="px-5 pb-5 pt-1">
          {top.length === 0 ? <EmptyState message="Nothing owed under these filters." /> : (
            <Table>
              <thead><tr><Th>Supplier</Th><Th>Group</Th><Th align="right">Owed</Th><Th align="right">Oldest</Th><Th className="w-32">Share</Th></tr></thead>
              <tbody>
                {top.map((r) => (
                  <Tr key={r.ledger_name}>
                    <Td><Link href={partyHref(r.ledger_name, qs)} className="text-foreground transition-colors hover:text-primary hover:underline">{r.party}</Link></Td>
                    <Td muted className="text-xs">{r.group_name}</Td>
                    <Td align="right"><Money value={r.owed} /></Td>
                    <Td align="right" muted className="tnum text-xs">{r.oldest}d</Td>
                    <Td><MiniBar value={r.owed} max={maxTop} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>
      <Note>Aging is FIFO-matched per supplier ledger (bills consumed oldest-first by payments). Every ledger&apos;s layers sum to its Tally closing balance.</Note>
    </div>
  );
}

function AgingTab({ layers, cfg, sp, filters }: { layers: PayableLayer[]; cfg: Cfg; sp: SP; filters: ReturnType<typeof parsePayableFilters> }) {
  const buckets = bucketRows(layers, cfg.agingEdges);
  return (
    <Card title="Aging profile (FIFO)" actions={<span className="text-xs text-muted-foreground">Click a bar to filter</span>}>
      <AgingBarChart data={buckets} activeBucket={filters.bucket} hrefFor={(b) => `/payables${buildQuery(sp, { tab: 'aging', bucket: b })}`} />
    </Card>
  );
}

function GroupwiseTab({ layers, cfg, qs }: { layers: PayableLayer[]; cfg: Cfg; qs: string }) {
  const firstEdge = Math.min(...cfg.agingEdges);
  const byGroup = new Map<string, ReturnType<typeof rollupSuppliers>>();
  const suppliers = rollupSuppliers(layers);
  const overdueByLedger = new Map<string, number>();
  for (const l of layers) if (l.age_days > firstEdge) overdueByLedger.set(l.ledger_name, (overdueByLedger.get(l.ledger_name) ?? 0) + l.owed_amount);

  for (const s of suppliers) {
    if (!byGroup.has(s.group_name)) byGroup.set(s.group_name, []);
    byGroup.get(s.group_name)!.push(s);
  }
  const groups: GroupReportGroup[] = [...byGroup.entries()]
    .map(([group, sups]) => ({ group, sups, total: sups.reduce((s, x) => s + x.owed, 0) }))
    .sort((a, b) => b.total - a.total)
    .map(({ group, sups, total }) => ({
      group,
      itemCount: sups.length,
      bar: { value: total, max: 1 },
      summary: <Money value={total} className="font-semibold text-foreground" />,
      items: sups.sort((a, b) => b.owed - a.owed).map((s) => ({
        item: s.party,
        cells: [
          <Money key="o" value={s.owed} />,
          <span key="ov" className="tnum text-muted-foreground"><Money value={overdueByLedger.get(s.ledger_name) ?? 0} /></span>,
          <span key="ag" className="tnum text-muted-foreground text-xs">{s.oldest}d</span>,
        ],
      })),
    }));

  return (
    <Card title={`Payables by group (${groups.length})`} padded={false}>
      <div className="px-5 pb-2">
        <GroupReport
          firstColLabel="Supplier"
          itemHref={(name) => {
            const s = suppliers.find((x) => x.party === name);
            return partyHref(s?.ledger_name ?? name, qs);
          }}
          headers={[{ label: 'Owed', align: 'right' }, { label: 'Overdue', align: 'right' }, { label: 'Oldest', align: 'right' }]}
          groups={groups}
        />
      </div>
    </Card>
  );
}

async function ProfitabilityTab({ filters, qs }: { filters: ReturnType<typeof parsePayableFilters>; qs: string }) {
  const rows = await loadSupplierProfitability({ q: filters.q, group: filters.group, from: filters.from, to: filters.to });
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
  const totalGp = rows.reduce((s, r) => s + r.gross_profit, 0);
  const blended = totalRev !== 0 ? Math.round((totalGp / totalRev) * 1000) / 10 : null;

  const byGroup = new Map<string, typeof rows>();
  for (const r of rows) { if (!byGroup.has(r.group_name)) byGroup.set(r.group_name, []); byGroup.get(r.group_name)!.push(r); }
  const groups: GroupReportGroup[] = [...byGroup.entries()]
    .map(([group, items]) => ({ group, items, gGp: items.reduce((s, r) => s + r.gross_profit, 0), gRev: items.reduce((s, r) => s + r.revenue, 0) }))
    .sort((a, b) => b.gGp - a.gGp)
    .map(({ group, items, gGp, gRev }) => {
      const gM = gRev !== 0 ? Math.round((gGp / gRev) * 1000) / 10 : null;
      return {
        group,
        itemCount: items.length,
        bar: { value: gGp, max: 1 },
        summary: (
          <span className="text-xs"><Money value={gGp} className="font-semibold text-foreground" />
            {gM != null && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{gM}%</span>}</span>
        ),
        items: items.sort((a, b) => b.gross_profit - a.gross_profit).map((r) => ({
          item: r.party,
          cells: [
            <span key="r" className="tnum text-muted-foreground"><Money value={r.revenue} /></span>,
            <Money key="g" value={r.gross_profit} />,
            <span key="m" className="tnum font-medium text-emerald-600 dark:text-emerald-400">{r.margin_pct != null ? `${r.margin_pct}%` : '—'}</span>,
          ],
        })),
      };
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Goods sourced (cost)" value={formatCompact(totalRev)} sub={`${rows.length} suppliers`} />
        <StatTile label="Margin contribution" value={formatCompact(totalGp)} tone="good" />
        <StatTile label="Blended margin" value={blended != null ? `${blended}%` : '—'} tone="good" />
      </div>
      <Card title="Supplier margin contribution by group" padded={false}>
        <div className="px-5 pb-2">
          <GroupReport
            firstColLabel="Supplier"
            itemHref={(name) => {
              const r = rows.find((x) => x.party === name);
              return partyHref(r?.ledger_name ?? name, qs);
            }}
            headers={[{ label: 'Purchases', align: 'right' }, { label: 'Margin earned', align: 'right' }, { label: 'Margin %', align: 'right' }]}
            groups={groups}
          />
        </div>
      </Card>
      <Note>
        &quot;Margin earned&quot; is each item&apos;s realized gross margin applied to the value purchased from the
        supplier. Note the caveat for this business: it buys <em>raw materials</em> (e.g. latex in
        sacks) and sells <em>finished goods</em> (gloves), so the margin accrues to the finished item —
        raw-material suppliers therefore show a low realized margin here even though their goods are
        highly profitable once converted. Read this as spend + realized-margin mix, not a supplier P&amp;L.
      </Note>
    </div>
  );
}
