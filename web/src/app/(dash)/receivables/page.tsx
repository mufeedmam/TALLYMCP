import Link from 'next/link';
import { isDbConfigured } from '@/lib/db';
import { getReceivablesConfig } from '@/lib/analytics/receivablesConfig';
import {
  loadOpenLayers,
  loadParties,
  getGroups,
  getSnapshotDate,
  bucketFor,
  bucketOrder,
  parseFilters,
  buildQuery,
  type OpenLayer,
  type PartyRow,
} from '@/lib/analytics/receivablesData';
import {
  PageHeader, Card, StatTile, Table, Th, Td, Tr, Badge, EmptyState, Note, Money,
  MiniBar, formatCompact,
} from '@/components/kit';
import AgingBarChart from '@/components/AgingBarChart';
import Tabs from '@/components/receivables/Tabs';
import FilterBar from '@/components/receivables/FilterBar';
import SettingsDrawer from '@/components/receivables/SettingsDrawer';
import GroupTree, { type GroupNode } from '@/components/receivables/GroupTree';
import GroupReport, { type GroupReportGroup } from '@/components/inventory/GroupReport';
import { loadCustomerProfitability } from '@/lib/analytics/profitability';
import SectionPlaceholder from '@/components/SectionPlaceholder';

type SP = Record<string, string | string[] | undefined>;

function PartyLink({ ledgerName, children, query }: { ledgerName: string; children: React.ReactNode; query: string }) {
  return (
    <Link
      href={`/receivables/party/${encodeURIComponent(ledgerName)}${query}`}
      className="text-neutral-800 transition-colors hover:text-primary hover:underline dark:text-neutral-200 dark:hover:text-primary"
    >
      {children}
    </Link>
  );
}

function MethodToggle({ method, sp }: { method: 'fifo' | 'billwise'; sp: SP }) {
  const opts: { key: 'fifo' | 'billwise'; label: string }[] = [
    { key: 'fifo', label: 'FIFO' },
    { key: 'billwise', label: 'Bill-wise' },
  ];
  return (
    <div
      className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 dark:border-neutral-800 dark:bg-neutral-800/50"
      title="Aging basis"
    >
      {opts.map((o) => (
        <Link
          key={o.key}
          href={`/receivables${buildQuery(sp, { method: o.key })}`}
          aria-current={method === o.key ? 'true' : undefined}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            method === o.key
              ? 'bg-card text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50'
              : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function ExportLink({ tab, sp }: { tab: string; sp: SP }) {
  return (
    <a
      href={`/receivables/export${buildQuery(sp, { tab })}`}
      className="text-xs font-medium text-neutral-500 transition-colors hover:text-primary dark:text-neutral-400 dark:hover:text-primary"
    >
      ↓ Export CSV
    </a>
  );
}

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isDbConfigured()) {
    return (
      <SectionPlaceholder
        title="Receivables"
        bucket="B2 — not connected"
        items={['Configure DATABASE_URL to see live data.']}
      />
    );
  }

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) || 'snapshot';
  const filters = parseFilters(sp);

  const [cfg, snapshotDate, groups] = await Promise.all([
    getReceivablesConfig(),
    getSnapshotDate(),
    getGroups(),
  ]);

  const [layersRaw, partiesAll] = await Promise.all([
    loadOpenLayers(filters),
    loadParties(filters),
  ]);

  // Bucket filter is applied after bucketing, since bucket edges are configurable.
  const layers = filters.bucket
    ? layersRaw.filter((l) => bucketFor(l.age_days, cfg.agingEdges) === filters.bucket)
    : layersRaw;

  const openLayers = layers.filter((l) => l.remaining_amount > 0);
  const parties = partiesAll.filter((p) => p.balance_type === 'receivable');
  const qs = buildQuery(sp, {});

  const method = filters.method ?? 'fifo';

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={tab === 'snapshot' ? 'Snapshot' : 'Detailed'}
        title="Receivables"
        description={
          method === 'billwise' ? (
            <>Bill-wise outstanding — referenced bills netted (New Ref vs Agst Ref), plus an
              on-account/opening remainder per customer. Ties to each ledger&apos;s Tally closing.</>
          ) : (
            <>FIFO-aged from the ledger — covers every debtor, not just bill-tracked ones.
              Ties to each ledger&apos;s Tally closing balance.</>
          )
        }
        actions={<MethodToggle method={method} sp={sp} />}
      />

      <Tabs active={tab} sp={sp} />

      <FilterBar
        tab={tab}
        filters={filters}
        groups={groups}
        snapshotDate={snapshotDate}
        sp={sp}
        resultCount={openLayers.length}
      />

      <SettingsDrawer cfg={cfg} />

      <div className="mt-5">
        {tab === 'snapshot' && <SnapshotTab layers={openLayers} parties={parties} allLayers={layers} cfg={cfg} sp={sp} qs={qs} filters={filters} />}
        {tab === 'aging' && <AgingTab layers={layers} cfg={cfg} sp={sp} filters={filters} />}
        {tab === 'groupwise' && <GroupwiseTab layers={openLayers} cfg={cfg} sp={sp} qs={qs} />}
        {tab === 'profitability' && <ProfitabilityTab filters={filters} qs={qs} />}
        {tab === 'risk' && <RiskTab layers={openLayers} parties={parties} cfg={cfg} sp={sp} qs={qs} />}
        {tab === 'noactivity' && <NoActivityTab parties={parties} cfg={cfg} sp={sp} qs={qs} />}
        {tab === 'unusual' && <UnusualTab layers={openLayers} partiesAll={partiesAll} cfg={cfg} qs={qs} />}
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

type Cfg = Awaited<ReturnType<typeof getReceivablesConfig>>;

function bucketRows(layers: OpenLayer[], edges: number[]) {
  const order = bucketOrder(edges);
  const totals = new Map(order.map((b) => [b, { amount: 0, count: 0 }]));
  for (const l of layers) {
    const b = bucketFor(l.age_days, edges);
    const t = totals.get(b) ?? { amount: 0, count: 0 };
    t.amount += l.remaining_amount;
    t.count += 1;
    totals.set(b, t);
  }
  return order.map((b) => ({
    bucket: b,
    amount: Math.round((totals.get(b)?.amount ?? 0) * 100) / 100,
    layer_count: totals.get(b)?.count ?? 0,
  }));
}

function byParty(layers: OpenLayer[]) {
  const m = new Map<string, { ledger_name: string; party: string; group_name: string; total: number; oldest_age: number; layers: OpenLayer[] }>();
  for (const l of layers) {
    const e = m.get(l.ledger_name) ?? {
      ledger_name: l.ledger_name, party: l.party, group_name: l.group_name, total: 0, oldest_age: 0, layers: [],
    };
    e.total += l.remaining_amount;
    e.oldest_age = Math.max(e.oldest_age, l.age_days);
    e.layers.push(l);
    m.set(l.ledger_name, e);
  }
  return [...m.values()];
}

/* ---------------- tabs ---------------- */

function SnapshotTab({
  layers, parties, allLayers, cfg, sp, qs, filters,
}: {
  layers: OpenLayer[]; parties: PartyRow[]; allLayers: OpenLayer[]; cfg: Cfg; sp: SP; qs: string; filters: ReturnType<typeof parseFilters>;
}) {
  // Headline + aging use the NET position (all layers) so the total ties to the
  // Tally closing balance identically under both aging bases (FIFO shows ~gross
  // because opposite signs are already netted within each ledger; bill-wise nets
  // its unallocated on-account/opening credits here).
  const buckets = bucketRows(allLayers, cfg.agingEdges);
  const total = allLayers.reduce((s, l) => s + l.remaining_amount, 0);
  const advances = allLayers.filter((l) => l.remaining_amount < 0).reduce((s, l) => s + l.remaining_amount, 0);
  const firstEdge = Math.min(...cfg.agingEdges);
  const overdue = allLayers.filter((l) => l.age_days > firstEdge).reduce((s, l) => s + l.remaining_amount, 0);
  const overduePct = total > 0 ? Math.round((overdue / total) * 100) : 0;
  const oldest = layers.reduce((m, l) => Math.max(m, l.age_days), 0);
  const top = byParty(layers).sort((a, b) => b.total - a.total).slice(0, 10);
  const maxTop = top[0]?.total ?? 1;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total receivable" value={formatCompact(total)} sub={`${parties.length} active debtors`} />
        <StatTile
          label={`Overdue (${firstEdge}+ days)`}
          value={`${overduePct}%`}
          sub={formatCompact(overdue)}
          tone={overduePct >= 50 ? 'danger' : overduePct >= 25 ? 'warn' : 'default'}
        />
        <StatTile label="Oldest exposure" value={oldest ? `${oldest} days` : '—'} tone={oldest > 365 ? 'danger' : 'default'} />
        <StatTile label="Unadjusted advances" value={formatCompact(Math.abs(advances))} sub="Credit balances" />
      </div>

      <Card title="Aging profile" actions={<span className="text-xs text-neutral-400">Click a bar to filter</span>}>
        <AgingBarChart
          data={buckets}
          activeBucket={filters.bucket}
          hrefFor={(b) => `/receivables${buildQuery(sp, { tab: 'groupwise', bucket: b })}`}
        />
      </Card>

      <Card title="Top exposures" actions={<ExportLink tab="topExposures" sp={sp} />} padded={false}>
        <div className="px-5 pb-5 pt-1">
          {top.length === 0 ? (
            <EmptyState message="No receivables match these filters." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Party</Th>
                  <Th>Group</Th>
                  <Th align="right">Open</Th>
                  <Th align="right">Oldest</Th>
                  <Th className="w-32">Share</Th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <Tr key={r.ledger_name}>
                    <Td><PartyLink ledgerName={r.ledger_name} query={qs}>{r.party}</PartyLink></Td>
                    <Td muted className="text-xs">{r.group_name}</Td>
                    <Td align="right"><Money value={r.total} /></Td>
                    <Td align="right" muted className="tnum text-xs">{r.oldest_age}d</Td>
                    <Td><MiniBar value={r.total} max={maxTop} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      <Note>
        Aging is computed by FIFO-matching each ledger&apos;s postings (invoices consumed oldest-first by
        receipts), because bill-by-bill reference tracking covers only a small fraction of debtors here.
        Every ledger&apos;s layers sum exactly to its Tally closing balance.
      </Note>
    </div>
  );
}

function AgingTab({ layers, cfg, sp, filters }: { layers: OpenLayer[]; cfg: Cfg; sp: SP; filters: ReturnType<typeof parseFilters> }) {
  const buckets = bucketRows(layers, cfg.agingEdges);
  return (
    <Card title="Aging profile (FIFO)" actions={<span className="text-xs text-neutral-400">Click a bar to filter</span>}>
      <AgingBarChart
        data={buckets}
        activeBucket={filters.bucket}
        hrefFor={(b) => `/receivables${buildQuery(sp, { tab: 'aging', bucket: b })}`}
      />
    </Card>
  );
}

function GroupwiseTab({ layers, cfg, sp, qs }: { layers: OpenLayer[]; cfg: Cfg; sp: SP; qs: string }) {
  const firstEdge = Math.min(...cfg.agingEdges);
  const groupMap = new Map<string, GroupNode>();

  for (const p of byParty(layers)) {
    const g = groupMap.get(p.group_name) ?? { group_name: p.group_name, total: 0, overdue: 0, parties: [] };
    g.total += p.total;
    g.overdue += p.layers.filter((l) => l.age_days > firstEdge).reduce((s, l) => s + l.remaining_amount, 0);
    g.parties.push({
      ledger_name: p.ledger_name,
      party: p.party,
      total: Math.round(p.total * 100) / 100,
      oldest_age: p.oldest_age,
      layers: p.layers
        .slice()
        .sort((a, b) => b.age_days - a.age_days)
        .map((l) => ({ opened_date: l.opened_date, age_days: l.age_days, remaining_amount: l.remaining_amount })),
    });
    groupMap.set(p.group_name, g);
  }

  const groups = [...groupMap.values()]
    .map((g) => ({ ...g, parties: g.parties.sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);

  return (
    <Card
      title={`Receivables by group (${groups.length})`}
      actions={<ExportLink tab="groupwise" sp={sp} />}
      padded={false}
    >
      <div className="px-5 pb-2">
        <GroupTree groups={groups} query={qs} />
      </div>
    </Card>
  );
}

async function ProfitabilityTab({ filters, qs }: { filters: ReturnType<typeof parseFilters>; qs: string }) {
  const rows = await loadCustomerProfitability({ q: filters.q, group: filters.group, from: filters.from, to: filters.to });
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
  const totalGp = rows.reduce((s, r) => s + r.gross_profit, 0);
  const overallMargin = totalRev !== 0 ? Math.round((totalGp / totalRev) * 1000) / 10 : null;

  // Group → customer (expandable), consistent with the app's report pattern.
  const byGroup = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byGroup.has(r.group_name)) byGroup.set(r.group_name, []);
    byGroup.get(r.group_name)!.push(r);
  }
  const groups: GroupReportGroup[] = [...byGroup.entries()]
    .map(([group, items]) => ({
      group,
      items: items.slice().sort((a, b) => b.gross_profit - a.gross_profit),
      gGp: items.reduce((s, r) => s + r.gross_profit, 0),
      gRev: items.reduce((s, r) => s + r.revenue, 0),
    }))
    .sort((a, b) => b.gGp - a.gGp)
    .map(({ group, items, gGp, gRev }) => {
      const gM = gRev !== 0 ? Math.round((gGp / gRev) * 1000) / 10 : null;
      return {
        group,
        itemCount: items.length,
        bar: { value: gGp, max: 1 },
        summary: (
          <span className="text-xs">
            <Money value={gGp} className="font-semibold text-foreground" />
            {gM != null && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{gM}%</span>}
          </span>
        ),
        items: items.map((r) => ({
          item: r.party,
          cells: [
            <span key="r" className="tnum text-muted-foreground"><Money value={r.revenue} /></span>,
            <Money key="g" value={r.gross_profit} />,
            <span key="m" className="tnum font-medium text-emerald-600 dark:text-emerald-400">
              {r.margin_pct != null ? `${r.margin_pct}%` : '—'}
            </span>,
          ],
        })),
      };
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Attributed revenue" value={formatCompact(totalRev)} sub={`${rows.length} customers`} />
        <StatTile label="Gross profit" value={formatCompact(totalGp)} tone="good" />
        <StatTile label="Blended margin" value={overallMargin != null ? `${overallMargin}%` : '—'} tone="good" />
      </div>
      <Card title="Customer profitability by group" padded={false}>
        <div className="px-5 pb-2">
          <GroupReport
            firstColLabel="Customer"
            itemHref={(name) => {
              const r = rows.find((x) => x.party === name);
              return `/receivables/party/${encodeURIComponent(r?.ledger_name ?? name)}${qs}`;
            }}
            headers={[{ label: 'Revenue', align: 'right' }, { label: 'Gross profit', align: 'right' }, { label: 'Margin', align: 'right' }]}
            groups={groups}
          />
        </div>
      </Card>
      <Note>
        Profit is attributed from each item&apos;s gross margin applied to the customer&apos;s revenue on
        that item (Tally stores no cost on the sales line). It covers named-customer sales only —
        cash/unnamed sales aren&apos;t attributed — so totals are a customer-mix view, not the full P&amp;L.
      </Note>
    </div>
  );
}

function RiskTab({ layers, parties, cfg, sp, qs }: { layers: OpenLayer[]; parties: PartyRow[]; cfg: Cfg; sp: SP; qs: string }) {
  const firstEdge = Math.min(...cfg.agingEdges);
  const agg = new Map<string, { total: number; overdue: number; maxAge: number }>();
  for (const l of layers) {
    const a = agg.get(l.ledger_name) ?? { total: 0, overdue: 0, maxAge: 0 };
    a.total += l.remaining_amount;
    if (l.age_days > firstEdge) a.overdue += l.remaining_amount;
    a.maxAge = Math.max(a.maxAge, l.age_days);
    agg.set(l.ledger_name, a);
  }
  const totalAR = parties.reduce((s, p) => s + p.receivable_dr, 0) || 1;
  const w = cfg.riskWeights;
  const [lowMax, medMax] = cfg.riskBands;

  const rows = parties
    .filter((p) => agg.has(p.ledger_name))
    .map((p) => {
      const a = agg.get(p.ledger_name)!;
      const overduePct = a.total > 0 ? a.overdue / a.total : 0;
      const score = Math.round(
        100 *
          (overduePct * w.overdue +
            Math.min(a.maxAge / 365, 1) * w.age +
            (p.receivable_dr / totalAR) * w.concentration +
            Math.min((p.days_since_activity ?? 0) / 365, 1) * w.dormancy),
      );
      return {
        ...p,
        score,
        band: score <= lowMax ? 'Low' : score <= medMax ? 'Med' : 'High',
        overdue_pct: Math.round(overduePct * 1000) / 10,
        max_age: a.maxAge,
      };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <Card
      title="Risk score"
      actions={
        <>
          <span className="text-xs text-neutral-400">overdue · age · concentration · dormancy</span>
          <ExportLink tab="risk" sp={sp} />
        </>
      }
      padded={false}
    >
      <div className="px-5 pb-5 pt-1">
        {rows.length === 0 ? (
          <EmptyState message="No debtors match these filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Party</Th>
                <Th align="right">Balance</Th>
                <Th align="right">Overdue</Th>
                <Th align="right">Oldest</Th>
                <Th align="right">Score</Th>
                <Th align="right">Band</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r) => (
                <Tr key={r.ledger_name}>
                  <Td><PartyLink ledgerName={r.ledger_name} query={qs}>{r.party}</PartyLink></Td>
                  <Td align="right"><Money value={r.receivable_dr} /></Td>
                  <Td align="right" muted className="tnum text-xs">{r.overdue_pct}%</Td>
                  <Td align="right" muted className="tnum text-xs">{r.max_age}d</Td>
                  <Td align="right" className="tnum font-semibold">{r.score}</Td>
                  <Td align="right">
                    <Badge tone={r.band === 'High' ? 'danger' : r.band === 'Med' ? 'warn' : 'good'}>{r.band}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}

function NoActivityTab({ parties, cfg, sp, qs }: { parties: PartyRow[]; cfg: Cfg; sp: SP; qs: string }) {
  const rows = parties
    .filter((p) => (p.days_since_activity ?? 999999) >= cfg.dormantDays)
    .sort((a, b) => (b.days_since_activity ?? 0) - (a.days_since_activity ?? 0));
  const stuck = rows.reduce((s, r) => s + r.receivable_dr, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Dormant debtors" value={String(rows.length)} sub={`No activity in ${cfg.dormantDays}+ days`} />
        <StatTile label="Value tied up" value={formatCompact(stuck)} tone={stuck > 0 ? 'warn' : 'default'} />
        <StatTile label="Longest dormant" value={rows[0]?.days_since_activity ? `${rows[0].days_since_activity} days` : '—'} sub={rows[0]?.party} />
      </div>
      <Card title={`Dormant debtors (${rows.length})`} actions={<ExportLink tab="noactivity" sp={sp} />} padded={false}>
        <div className="px-5 pb-5 pt-1">
          {rows.length === 0 ? (
            <EmptyState message="No dormant debtors at the current threshold." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Party</Th>
                  <Th>Group</Th>
                  <Th align="right">Balance</Th>
                  <Th>Last activity</Th>
                  <Th align="right">Days since</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.ledger_name}>
                    <Td><PartyLink ledgerName={r.ledger_name} query={qs}>{r.party}</PartyLink></Td>
                    <Td muted className="text-xs">{r.group_name}</Td>
                    <Td align="right"><Money value={r.receivable_dr} /></Td>
                    <Td muted className="text-xs">{r.last_activity_date ?? '—'}</Td>
                    <Td align="right" className="tnum">{r.days_since_activity ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}

async function UnusualTab({
  layers, partiesAll, cfg, qs,
}: {
  layers: OpenLayer[]; partiesAll: PartyRow[]; cfg: Cfg; qs: string;
}) {
  const { query } = await import('@/lib/db');
  const avgDebits = await query<{ ledger_name: string; avg_monthly_debit: string }>(`
    select ledger_name, round(sum(debit_amount) / 3.0, 2) as avg_monthly_debit
    from fact.fact_gl
    where date >= current_date - interval '90 days' and debit_amount > 0
    group by ledger_name
  `);
  const avgMap = new Map(avgDebits.map((r) => [r.ledger_name, Number(r.avg_monthly_debit)]));

  const spikes = partiesAll
    .filter((p) => p.balance_type === 'receivable')
    .map((p) => {
      const avg = avgMap.get(p.ledger_name) ?? 0;
      return { ...p, avg, ratio: avg > 0 ? p.receivable_dr / avg : 0 };
    })
    .filter((r) => r.avg > 0 && r.ratio >= cfg.spikeX)
    .sort((a, b) => b.ratio - a.ratio);

  const staleAdvances = partiesAll
    .filter((p) => p.balance_type === 'advance_cr' && (p.days_since_activity ?? 0) >= cfg.dormantDays)
    .map((p) => ({ ...p, advance: -p.receivable_dr }))
    .sort((a, b) => b.advance - a.advance);

  const longOpenTiny = layers
    .filter((l) => l.remaining_amount <= cfg.tinyAmount && l.age_days > cfg.tinyDays)
    .sort((a, b) => b.age_days - a.age_days);

  return (
    <div className="space-y-5">
      <Card title={`Balance spikes (${spikes.length})`}>
        {spikes.length === 0 ? (
          <EmptyState message="Nothing above the configured multiple." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Party</Th>
                <Th align="right">Current balance</Th>
                <Th align="right">Avg monthly debit (90d)</Th>
                <Th align="right">Ratio</Th>
              </tr>
            </thead>
            <tbody>
              {spikes.map((r) => (
                <Tr key={r.ledger_name}>
                  <Td><PartyLink ledgerName={r.ledger_name} query={qs}>{r.party}</PartyLink></Td>
                  <Td align="right"><Money value={r.receivable_dr} /></Td>
                  <Td align="right" muted><Money value={r.avg} /></Td>
                  <Td align="right" className="tnum font-semibold">{r.ratio.toFixed(1)}×</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={`Advances received, never adjusted (${staleAdvances.length})`}>
        {staleAdvances.length === 0 ? (
          <EmptyState message="None." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Party</Th>
                <Th align="right">Advance held</Th>
                <Th align="right">Days since activity</Th>
              </tr>
            </thead>
            <tbody>
              {staleAdvances.map((r) => (
                <Tr key={r.ledger_name}>
                  <Td><PartyLink ledgerName={r.ledger_name} query={qs}>{r.party}</PartyLink></Td>
                  <Td align="right"><Money value={r.advance} /></Td>
                  <Td align="right" muted className="tnum">{r.days_since_activity ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={`Long-open small balances (${longOpenTiny.length})`}>
        {longOpenTiny.length === 0 ? (
          <EmptyState message="None." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Party</Th>
                <Th>Opened</Th>
                <Th align="right">Age</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {longOpenTiny.slice(0, 100).map((l, i) => (
                <Tr key={`${l.ledger_name}-${i}`}>
                  <Td><PartyLink ledgerName={l.ledger_name} query={qs}>{l.party}</PartyLink></Td>
                  <Td muted className="text-xs">{l.opened_date}</Td>
                  <Td align="right" muted className="tnum text-xs">{l.age_days}d</Td>
                  <Td align="right"><Money value={l.remaining_amount} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
