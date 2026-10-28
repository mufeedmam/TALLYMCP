// Filter-aware inventory data access, mirroring receivablesData. Every inventory
// tab reads through here so filters and config behave identically across reports.
import { query } from '@/lib/db';
import { getInventoryConfig } from './inventoryConfig';

export interface InventoryFilters {
  /** Item-name substring (case-insensitive). */
  q?: string;
  /** Exact stock group. */
  group?: string;
  /** Minimum stock value (₹). */
  minValue?: number;
  /** Movement date range (YYYY-MM-DD) — applies to the Movement report. */
  from?: string;
  to?: string;
  /** Restrict to items currently in stock (qty <> 0). */
  inStockOnly?: boolean;
}

export interface InvItem {
  item: string;
  stock_group: string;
  category: string | null;
  uom: string | null;
  qty: number;
  rate: number;
  stock_value: number;
  inward_qty: number;
  outward_qty: number;
  purchase_value: number;
  sales_value: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
  last_movement_date: string | null;
  days_since_movement: number | null;
  is_negative_stock: boolean;
  slow: boolean;               // days_since_movement > cfg.slowDays  (config, read-time)
  profit_unreliable: boolean;  // margin outside cfg band              (config, read-time)
}

const UNGROUPED = '(ungrouped)';

/** Distinct stock groups with at least one item, for the filter dropdown. */
export async function getStockGroups(): Promise<string[]> {
  const rows = await query<{ stock_group: string }>(
    `select distinct coalesce(stock_group, '${UNGROUPED}') as stock_group
     from mart.mart_inventory_items order by 1`,
  );
  return rows.map((r) => r.stock_group);
}

/** Per-item facts + config-derived flags, with filters applied. */
export async function loadItems(filters: InventoryFilters = {}): Promise<InvItem[]> {
  const cfg = await getInventoryConfig();
  const rows = await query<{
    item: string; stock_group: string | null; category: string | null; uom: string | null;
    qty: string; rate: string; stock_value: string; inward_qty: string; outward_qty: string;
    purchase_value: string; sales_value: string; cogs: string; gross_profit: string;
    gross_margin_pct: string | null; last_movement_date: string | null; days_since_movement: number | null;
    is_negative_stock: boolean;
  }>(
    `select item, stock_group, category, uom, qty, rate, stock_value, inward_qty, outward_qty,
            purchase_value, sales_value, cogs, gross_profit, gross_margin_pct,
            last_movement_date, days_since_movement, is_negative_stock
     from mart.mart_inventory_items`,
  );

  const [lo, hi] = cfg.marginBand;
  let items: InvItem[] = rows.map((r) => {
    const margin = r.gross_margin_pct != null ? Number(r.gross_margin_pct) : null;
    const days = r.days_since_movement;
    return {
      item: r.item,
      stock_group: r.stock_group ?? UNGROUPED,
      category: r.category,
      uom: r.uom,
      qty: Number(r.qty),
      rate: Number(r.rate),
      stock_value: Number(r.stock_value),
      inward_qty: Number(r.inward_qty),
      outward_qty: Number(r.outward_qty),
      purchase_value: Number(r.purchase_value),
      sales_value: Number(r.sales_value),
      cogs: Number(r.cogs),
      gross_profit: Number(r.gross_profit),
      gross_margin_pct: margin,
      last_movement_date: r.last_movement_date,
      days_since_movement: days,
      is_negative_stock: r.is_negative_stock,
      slow: Number(r.qty) !== 0 && (days ?? 999999) > cfg.slowDays,
      profit_unreliable: Number(r.sales_value) !== 0 && margin != null && (margin < lo || margin > hi),
    };
  });

  if (filters.group) items = items.filter((i) => i.stock_group === filters.group);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    items = items.filter((i) => i.item.toLowerCase().includes(q));
  }
  if (filters.minValue != null && filters.minValue > 0) {
    items = items.filter((i) => i.stock_value >= filters.minValue!);
  }
  if (filters.inStockOnly) items = items.filter((i) => i.qty !== 0);
  return items;
}

export interface ItemMovement {
  item: string;
  stock_group: string;
  inward_qty: number;
  outward_qty: number;
  purchase_value: number;
  sales_value: number;
}

/**
 * Per-item movement within an optional date range (the Movement report needs a
 * date-aware, item-grain source; the pre-aggregated monthly mart is company-wide).
 */
export async function loadMovement(filters: InventoryFilters = {}): Promise<ItemMovement[]> {
  const rows = await query<{
    item: string; stock_group: string | null;
    inward_qty: string; outward_qty: string; purchase_value: string; sales_value: string;
  }>(
    // sales_value / purchase_value are classified by voucher-type PARENT (real
    // Sales/Purchase net of returns), matching mart_inventory_items — so Sales/
    // Purchase orders and Stock Journal/PRODUCTION don't inflate either side.
    `select ti.item,
            si.parent as stock_group,
            sum(case when ti.quantity > 0 then ti.quantity else 0 end)   as inward_qty,
            sum(case when ti.quantity < 0 then -ti.quantity else 0 end)  as outward_qty,
            coalesce(sum(-ti.amount) filter (where vt.parent in ('Purchase', 'Debit Note')), 0) as purchase_value,
            coalesce(sum(ti.amount)  filter (where vt.parent in ('Sales', 'Credit Note')), 0)   as sales_value
     from trn_inventory ti
     join trn_voucher v on v.guid = ti.guid
     left join mst_stock_item si on si.name = ti.item
     left join mst_vouchertype vt on vt.name = v.voucher_type
     where (v.is_accounting_voucher = 1 or v.is_inventory_voucher = 1)
       and ($1::date is null or v.date >= $1::date)
       and ($2::date is null or v.date <= $2::date)
     group by ti.item, si.parent`,
    [filters.from ?? null, filters.to ?? null],
  );

  let out: ItemMovement[] = rows.map((r) => ({
    item: r.item,
    stock_group: r.stock_group?.trim() || UNGROUPED,
    inward_qty: Number(r.inward_qty),
    outward_qty: Number(r.outward_qty),
    purchase_value: Number(r.purchase_value),
    sales_value: Number(r.sales_value),
  }));

  if (filters.group) out = out.filter((m) => m.stock_group === filters.group);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    out = out.filter((m) => m.item.toLowerCase().includes(q));
  }
  return out.filter((m) => m.inward_qty !== 0 || m.outward_qty !== 0);
}

/** Company-wide monthly movement, optionally bounded to the filter date range. */
export async function loadMonthly(filters: InventoryFilters = {}) {
  const rows = await query<{ year_month: string; inward_qty: string; outward_qty: string; purchase_value: string; sales_value: string }>(
    `select year_month, inward_qty, outward_qty, purchase_value, sales_value
     from mart.mart_inventory_monthly order by year_month desc`,
  );
  const fromM = filters.from?.slice(0, 7);
  const toM = filters.to?.slice(0, 7);
  return rows
    .filter((r) => (!fromM || r.year_month >= fromM) && (!toM || r.year_month <= toM))
    .map((r) => ({
      year_month: r.year_month,
      inward_qty: Number(r.inward_qty),
      outward_qty: Number(r.outward_qty),
      purchase_value: Number(r.purchase_value),
      sales_value: Number(r.sales_value),
    }));
}

/* ---------- generic group rollup (Group → Item) ---------- */

export interface GroupRollup<T> {
  group: string;
  items: T[];
  // numeric column totals, summed across the group's items
  totals: Record<string, number>;
}

/** Roll rows up by stock_group, summing the named numeric fields. */
export function rollupByGroup<T extends { stock_group: string }>(
  rows: T[],
  numericFields: (keyof T)[],
  sortBy: keyof T,
): GroupRollup<T>[] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!m.has(r.stock_group)) m.set(r.stock_group, []);
    m.get(r.stock_group)!.push(r);
  }
  const groups: GroupRollup<T>[] = [...m.entries()].map(([group, items]) => {
    const totals: Record<string, number> = {};
    for (const f of numericFields) {
      totals[f as string] = items.reduce((s, it) => s + (Number(it[f]) || 0), 0);
    }
    items.sort((a, b) => (Number(b[sortBy]) || 0) - (Number(a[sortBy]) || 0));
    return { group, items, totals };
  });
  groups.sort((a, b) => (b.totals[sortBy as string] ?? 0) - (a.totals[sortBy as string] ?? 0));
  return groups;
}

/* ---------- filter parsing (mirrors receivablesData) ---------- */

export function parseInventoryFilters(sp: Record<string, string | string[] | undefined>): InventoryFilters {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const n = one('minValue');
  return {
    q: one('q'),
    group: one('group'),
    minValue: n != null && Number.isFinite(Number(n)) ? Number(n) : undefined,
    from: one('from'),
    to: one('to'),
    inStockOnly: one('inStock') === '1',
  };
}
