import { isDbConfigured } from '@/lib/db';
import {
  loadItems, loadMovement, getStockGroups, rollupByGroup, parseInventoryFilters,
  type InvItem, type ItemMovement,
} from '@/lib/analytics/inventoryData';
import { getInventoryConfig } from '@/lib/analytics/inventoryConfig';
import {
  PageHeader, StatTile, Card, Money, Badge, Note, EmptyState, formatCompact,
} from '@/components/kit';
import InventoryTabs from '@/components/inventory/Tabs';
import InventoryFilterBar from '@/components/inventory/FilterBar';
import InventorySettingsDrawer from '@/components/inventory/SettingsDrawer';
import GroupReport, { type GroupReportGroup } from '@/components/inventory/GroupReport';
import SectionPlaceholder from '@/components/SectionPlaceholder';

type SP = Record<string, string | string[] | undefined>;

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const RightMuted = ({ children }: { children: React.ReactNode }) => (
  <span className="tnum text-neutral-500 dark:text-neutral-400">{children}</span>
);

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isDbConfigured()) {
    return <SectionPlaceholder title="Inventory" bucket="B3 — not connected" items={['Configure DATABASE_URL to see live data.']} />;
  }

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) || 'snapshot';
  const filters = parseInventoryFilters(sp);

  const [cfg, groups, items] = await Promise.all([
    getInventoryConfig(),
    getStockGroups(),
    loadItems(filters),
  ]);

  if (groups.length === 0) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader eyebrow="Analytics" title="Inventory" />
        <EmptyState message="This company keeps no stock items." hint="Inventory analysis applies to companies that maintain inventory." />
      </div>
    );
  }

  // KPI row reflects the current filters (consistent with the tables below).
  const stockValue = items.reduce((s, i) => s + i.stock_value, 0);
  const salesValue = items.reduce((s, i) => s + i.sales_value, 0);
  const grossProfit = items.reduce((s, i) => s + i.gross_profit, 0);
  const margin = salesValue !== 0 ? Math.round((grossProfit / salesValue) * 1000) / 10 : null;
  const inStock = items.filter((i) => i.qty !== 0).length;
  const slow = items.filter((i) => i.slow);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={tab === 'snapshot' ? 'Snapshot' : 'Detailed'}
        title="Inventory"
        description="Stock at Tally's closing valuation (positive asset). Every report groups by stock group — expand a group to see its items, click an item to drill down."
      />

      <InventoryTabs active={tab} />

      <InventoryFilterBar tab={tab} filters={filters} groups={groups} sp={sp} resultCount={items.length} showDates={tab === 'movement'} />

      <InventorySettingsDrawer cfg={cfg} />

      <div className="my-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Stock value" value={formatCompact(stockValue)} sub={`${inStock} of ${items.length} SKUs in stock`} />
        <StatTile label="Gross margin" value={margin != null ? `${margin}%` : '—'} sub={`GP ${formatCompact(grossProfit)}`} tone="good" />
        <StatTile label="Sales" value={formatCompact(salesValue)} sub="Outward value" />
        <StatTile label={`Slow movers (${cfg.slowDays}d+)`} value={String(slow.length)} sub={formatCompact(slow.reduce((s, i) => s + i.stock_value, 0))} tone={slow.length > 0 ? 'warn' : 'default'} />
      </div>

      {tab === 'snapshot' && <SnapshotTab items={items} />}
      {tab === 'movement' && <MovementTab filters={filters} />}
      {tab === 'profitability' && <ProfitabilityTab items={items} />}
      {tab === 'slow' && <SlowTab items={slow} cfg={cfg} />}
    </div>
  );
}

/* ---------------- Snapshot (stock by group → item) ---------------- */

function SnapshotTab({ items }: { items: InvItem[] }) {
  const inStock = items.filter((i) => i.qty !== 0);
  const rolled = rollupByGroup(inStock, ['stock_value'], 'stock_value');
  const groups: GroupReportGroup[] = rolled.map((g) => ({
    group: g.group,
    itemCount: g.items.length,
    bar: { value: g.totals.stock_value, max: 1 },
    summary: <Money value={g.totals.stock_value} className="font-semibold text-neutral-900 dark:text-neutral-50" />,
    items: g.items.map((it) => ({
      item: it.item,
      cells: [
        <span key="q" className="tnum">{qty(it.qty)} <span className="text-xs text-neutral-400">{it.uom ?? ''}</span></span>,
        <RightMuted key="r">{it.rate.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</RightMuted>,
        <Money key="v" value={it.stock_value} />,
      ],
    })),
  }));

  return (
    <Card title={`Stock on hand by group (${inStock.length} items)`} padded={false}>
      <div className="px-5 pb-2">
        <GroupReport headers={[{ label: 'Qty', align: 'right' }, { label: 'Rate', align: 'right' }, { label: 'Value', align: 'right' }]} groups={groups} />
      </div>
    </Card>
  );
}

/* ---------------- Movement (by group → item) ---------------- */

async function MovementTab({ filters }: { filters: ReturnType<typeof parseInventoryFilters> }) {
  const movement = await loadMovement(filters);

  const rolled = rollupByGroup(movement, ['inward_qty', 'outward_qty', 'purchase_value', 'sales_value'], 'sales_value');
  const groups: GroupReportGroup[] = rolled.map((g) => ({
    group: g.group,
    itemCount: g.items.length,
    bar: { value: g.totals.sales_value, max: 1 },
    summary: (
      <span className="text-xs">
        <span className="text-neutral-400">out </span>
        <Money value={g.totals.sales_value} className="font-semibold text-neutral-900 dark:text-neutral-50" />
      </span>
    ),
    items: g.items.map((it: ItemMovement) => ({
      item: it.item,
      cells: [
        <RightMuted key="iq">{qty(it.inward_qty)}</RightMuted>,
        <RightMuted key="oq">{qty(it.outward_qty)}</RightMuted>,
        <Money key="p" value={it.purchase_value} />,
        <Money key="s" value={it.sales_value} />,
      ],
    })),
  }));

  return (
    <div className="space-y-5">
      <Card title={`Movement by group (${movement.length} items)`} padded={false}>
        <div className="px-5 pb-2">
          <GroupReport
            headers={[{ label: 'In qty', align: 'right' }, { label: 'Out qty', align: 'right' }, { label: 'Purchases', align: 'right' }, { label: 'Sales', align: 'right' }]}
            groups={groups}
          />
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Profitability (by group → item) ---------------- */

function ProfitabilityTab({ items }: { items: InvItem[] }) {
  const sold = items.filter((i) => i.sales_value !== 0);
  const rolled = rollupByGroup(sold, ['sales_value', 'cogs', 'gross_profit'], 'gross_profit');
  const flagged = sold.filter((i) => i.profit_unreliable).length;

  const groups: GroupReportGroup[] = rolled.map((g) => {
    const m = g.totals.sales_value !== 0 ? Math.round((g.totals.gross_profit / g.totals.sales_value) * 1000) / 10 : null;
    return {
      group: g.group,
      itemCount: g.items.length,
      bar: { value: g.totals.gross_profit, max: 1 },
      summary: (
        <span className="text-xs">
          <Money value={g.totals.gross_profit} className="font-semibold text-neutral-900 dark:text-neutral-50" />
          {m != null && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{m}%</span>}
        </span>
      ),
      items: g.items.map((it) => ({
        item: it.item,
        cells: [
          <RightMuted key="s"><Money value={it.sales_value} /></RightMuted>,
          <RightMuted key="c"><Money value={it.cogs} /></RightMuted>,
          <Money key="g" value={it.gross_profit} />,
          <span key="m" className={`tnum font-medium ${it.gross_margin_pct != null && it.gross_margin_pct < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {it.gross_margin_pct != null ? `${it.gross_margin_pct}%` : '—'}
            {it.profit_unreliable && <> <Badge tone="warn">check</Badge></>}
          </span>,
        ],
      })),
    };
  });

  return (
    <Card
      title={`Profitability by group (${sold.length} sold items)`}
      actions={flagged > 0 ? <span className="text-xs text-amber-600 dark:text-amber-400">{flagged} flagged</span> : undefined}
      padded={false}
    >
      <div className="px-5 pb-2">
        <GroupReport
          headers={[{ label: 'Sales', align: 'right' }, { label: 'COGS', align: 'right' }, { label: 'Gross profit', align: 'right' }, { label: 'Margin', align: 'right' }]}
          groups={groups}
        />
      </div>
      <Note>
        Value-based COGS (opening + purchases − closing), which ties to the P&amp;L in total. A
        <Badge tone="warn">check</Badge> flag marks an implausible per-item margin — usually stock
        renamed/transferred between item names, not a real loss. The plausible band is set in Thresholds.
      </Note>
    </Card>
  );
}

/* ---------------- Slow / Dead (by group → item) ---------------- */

function SlowTab({ items, cfg }: { items: InvItem[]; cfg: { slowDays: number } }) {
  const rolled = rollupByGroup(items, ['stock_value'], 'stock_value');
  const groups: GroupReportGroup[] = rolled.map((g) => ({
    group: g.group,
    itemCount: g.items.length,
    bar: { value: g.totals.stock_value, max: 1 },
    summary: <Money value={g.totals.stock_value} className="font-semibold text-neutral-900 dark:text-neutral-50" />,
    items: g.items.map((it) => ({
      item: it.item,
      cells: [
        <span key="q" className="tnum">{qty(it.qty)}</span>,
        <Money key="v" value={it.stock_value} />,
        <RightMuted key="d">{it.last_movement_date ?? '—'}</RightMuted>,
        <span key="i" className="tnum">{it.days_since_movement ?? '—'}</span>,
      ],
    })),
  }));

  return (
    <Card title={`Slow / dead stock — no movement in ${cfg.slowDays}+ days (${items.length})`} padded={false}>
      <div className="px-5 pb-2">
        {items.length === 0 ? (
          <EmptyState message="No slow-moving stock — everything has moved recently." />
        ) : (
          <GroupReport
            headers={[{ label: 'Qty', align: 'right' }, { label: 'Value', align: 'right' }, { label: 'Last moved', align: 'right' }, { label: 'Idle days', align: 'right' }]}
            groups={groups}
          />
        )}
      </div>
    </Card>
  );
}
