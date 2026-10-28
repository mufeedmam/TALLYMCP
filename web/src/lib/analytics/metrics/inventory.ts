import type { MetricDefinition } from '../types';
import { query } from '@/lib/db';

export interface InventorySnapshot {
  total_stock_value: number;
  items_in_stock: number;
  total_skus: number;
  slow_movers: number;
  oversold_items: number;
  total_sales_value: number;
  total_gross_profit: number;
  gross_margin_pct: number | null;
}

export const inventorySnapshotMetric: MetricDefinition<{ slowDays?: number }, InventorySnapshot> = {
  id: 'inventory.snapshot',
  title: 'Inventory snapshot',
  description: 'Stock valuation KPIs: total value (positive asset), SKUs in stock, slow movers, oversold items, lifetime sales.',
  params: [{ name: 'slowDays', type: 'number', default: 180 }],
  output: [
    { column: 'total_stock_value', type: 'numeric', semantic: 'positive asset value (= -Σ closing_value)' },
    { column: 'items_in_stock', type: 'int' },
    { column: 'total_skus', type: 'int' },
    { column: 'slow_movers', type: 'int', semantic: 'in stock but no movement in slowDays' },
    { column: 'oversold_items', type: 'int', semantic: 'negative closing quantity' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_inventory_snapshot' },
  run: async ({ slowDays = 180 } = {}) => {
    const rows = await query<{
      total_stock_value: string; items_in_stock: string; total_skus: string;
      slow_movers: string; oversold_items: string; total_sales_value: string;
      total_gross_profit: string; gross_margin_pct: string | null;
    }>(
      `select
         round(coalesce(sum(stock_value),0),2) as total_stock_value,
         count(*) filter (where qty <> 0)       as items_in_stock,
         count(*)                               as total_skus,
         count(*) filter (where qty <> 0 and days_since_movement > $1) as slow_movers,
         count(*) filter (where is_negative_stock) as oversold_items,
         round(coalesce(sum(sales_value),0),2)  as total_sales_value,
         round(coalesce(sum(gross_profit),0),2) as total_gross_profit,
         round(100 * coalesce(sum(gross_profit),0) / nullif(sum(sales_value),0), 1) as gross_margin_pct
       from mart.mart_inventory_items`,
      [slowDays],
    );
    const r = rows[0];
    return {
      total_stock_value: Number(r?.total_stock_value ?? 0),
      items_in_stock: Number(r?.items_in_stock ?? 0),
      total_skus: Number(r?.total_skus ?? 0),
      slow_movers: Number(r?.slow_movers ?? 0),
      oversold_items: Number(r?.oversold_items ?? 0),
      total_sales_value: Number(r?.total_sales_value ?? 0),
      total_gross_profit: Number(r?.total_gross_profit ?? 0),
      gross_margin_pct: r?.gross_margin_pct != null ? Number(r.gross_margin_pct) : null,
    };
  },
};

export interface ItemProfitRow {
  item: string;
  stock_group: string | null;
  sales_value: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
  outward_qty: number;
  profit_unreliable: boolean;
}

export const inventoryProfitabilityMetric: MetricDefinition<{ limit?: number }, ItemProfitRow[]> = {
  id: 'inventory.profitability',
  title: 'Item profitability',
  description: 'Per-item gross profit and margin (value-based COGS = opening + purchases − closing). Items whose margin falls outside a plausible band are flagged as stock rename/transfer artifacts.',
  params: [{ name: 'limit', type: 'number', default: 200 }],
  output: [
    { column: 'item', type: 'text' },
    { column: 'sales_value', type: 'numeric' },
    { column: 'cogs', type: 'numeric' },
    { column: 'gross_profit', type: 'numeric' },
    { column: 'gross_margin_pct', type: 'numeric' },
    { column: 'profit_unreliable', type: 'boolean' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_inventory_profitability' },
  run: async ({ limit = 200 } = {}) => {
    const rows = await query<ItemProfitRow>(
      `select item, stock_group, sales_value, cogs, gross_profit, gross_margin_pct, outward_qty, profit_unreliable
       from mart.mart_inventory_items
       where sales_value <> 0
       order by gross_profit desc
       limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      ...r,
      sales_value: Number(r.sales_value), cogs: Number(r.cogs), gross_profit: Number(r.gross_profit),
      outward_qty: Number(r.outward_qty),
      gross_margin_pct: r.gross_margin_pct != null ? Number(r.gross_margin_pct) : null,
    }));
  },
};

export interface MonthlyMovementRow {
  year_month: string;
  inward_qty: number;
  outward_qty: number;
  purchase_value: number;
  sales_value: number;
}

export const inventoryMovementMetric: MetricDefinition<Record<string, never>, MonthlyMovementRow[]> = {
  id: 'inventory.movement',
  title: 'Inventory movement (monthly)',
  description: 'Month-by-month inward (purchases) vs outward (sales), quantity and value.',
  params: [],
  output: [
    { column: 'year_month', type: 'text' },
    { column: 'inward_qty', type: 'numeric' },
    { column: 'outward_qty', type: 'numeric' },
    { column: 'purchase_value', type: 'numeric' },
    { column: 'sales_value', type: 'numeric' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_inventory_movement' },
  run: async () => {
    const rows = await query<MonthlyMovementRow>(
      `select year_month, inward_qty, outward_qty, purchase_value, sales_value
       from mart.mart_inventory_monthly order by year_month desc limit 24`,
    );
    return rows.map((r) => ({
      ...r, inward_qty: Number(r.inward_qty), outward_qty: Number(r.outward_qty),
      purchase_value: Number(r.purchase_value), sales_value: Number(r.sales_value),
    }));
  },
};

export interface ItemDetail {
  item: string;
  stock_group: string | null;
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
  profit_unreliable: boolean;
  last_movement_date: string | null;
  total_movements: number;
  transactions: {
    date: string; voucher_type: string; voucher_number: string; party: string | null;
    quantity: number; rate: number; amount: number; running_qty: number;
  }[];
}

const ITEM_HISTORY_LIMIT = 300;

export const inventoryItemDetailMetric: MetricDefinition<{ item: string }, ItemDetail | null> = {
  id: 'inventory.itemDetail',
  title: 'Stock item drill-down',
  description: 'One item: stock, profitability, and full movement history (each voucher line, with a running quantity balance).',
  params: [{ name: 'item', type: 'string', required: true }],
  output: [
    { column: 'transactions', type: 'array' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_inventory_item_detail' },
  run: async ({ item }) => {
    // Running balance + newest-N slice are done IN SQL (window functions), so only
    // ITEM_HISTORY_LIMIT rows cross the network even for items with thousands of
    // movements — pulling the full history to Node was the bottleneck.
    const [head, txns] = await Promise.all([
      query<Omit<ItemDetail, 'transactions' | 'total_movements'>>(
        `select item, stock_group, category, uom, qty, rate, stock_value, inward_qty, outward_qty,
                purchase_value, sales_value, cogs, gross_profit, gross_margin_pct, profit_unreliable, last_movement_date
         from mart.mart_inventory_items where item = $1`,
        [item],
      ),
      query<{ date: string; voucher_type: string; voucher_number: string; party: string | null; quantity: string; rate: string; amount: string; running_qty: string; total: string }>(
        `select date, voucher_type, voucher_number, party, quantity, rate, amount, running_qty, total
         from (
           select v.date::text as date, v.voucher_type, v.voucher_number, nullif(v.party_name,'') as party,
                  ti.quantity, ti.rate, ti.amount,
                  sum(ti.quantity) over (order by v.date, ti.guid rows between unbounded preceding and current row) as running_qty,
                  row_number() over (order by v.date desc, ti.guid desc) as rn,
                  count(*) over () as total
           from trn_inventory ti
           join trn_voucher v on v.guid = ti.guid
           where ti.item = $1 and (v.is_accounting_voucher = 1 or v.is_inventory_voucher = 1)
         ) x
         where rn <= $2
         order by rn`,
        [item, ITEM_HISTORY_LIMIT],
      ),
    ]);
    const h = head[0];
    if (!h) return null;
    const transactions = txns.map((t) => ({
      date: t.date, voucher_type: t.voucher_type, voucher_number: t.voucher_number, party: t.party,
      quantity: Number(t.quantity), rate: Number(t.rate), amount: Number(t.amount),
      running_qty: Math.round(Number(t.running_qty) * 1000) / 1000,
    }));
    return {
      ...h,
      qty: Number(h.qty), rate: Number(h.rate), stock_value: Number(h.stock_value),
      inward_qty: Number(h.inward_qty), outward_qty: Number(h.outward_qty),
      purchase_value: Number(h.purchase_value), sales_value: Number(h.sales_value),
      cogs: Number(h.cogs), gross_profit: Number(h.gross_profit),
      gross_margin_pct: h.gross_margin_pct != null ? Number(h.gross_margin_pct) : null,
      total_movements: txns[0] ? Number(txns[0].total) : 0,
      transactions,
    };
  },
};

export interface InventoryItemRow {
  item: string;
  stock_group: string | null;
  uom: string | null;
  qty: number;
  rate: number;
  stock_value: number;
  outward_qty: number;
  sales_value: number;
  last_movement_date: string | null;
  days_since_movement: number | null;
  is_negative_stock: boolean;
}

export const inventoryItemsMetric: MetricDefinition<{ limit?: number; inStockOnly?: boolean }, InventoryItemRow[]> = {
  id: 'inventory.items',
  title: 'Stock items',
  description: 'Per-item stock: quantity on hand, rate, value, outward movement, last movement.',
  params: [
    { name: 'limit', type: 'number', default: 100 },
    { name: 'inStockOnly', type: 'boolean', default: true },
  ],
  output: [
    { column: 'item', type: 'text' },
    { column: 'qty', type: 'numeric' },
    { column: 'rate', type: 'numeric' },
    { column: 'stock_value', type: 'numeric' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_inventory_items' },
  run: async ({ limit = 100, inStockOnly = true } = {}) => {
    const rows = await query<InventoryItemRow>(
      `select item, stock_group, uom, qty, rate, stock_value, outward_qty, sales_value,
              last_movement_date, days_since_movement, is_negative_stock
       from mart.mart_inventory_items
       ${inStockOnly ? 'where qty <> 0' : ''}
       order by stock_value desc nulls last
       limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      ...r,
      qty: Number(r.qty), rate: Number(r.rate), stock_value: Number(r.stock_value),
      outward_qty: Number(r.outward_qty), sales_value: Number(r.sales_value),
    }));
  },
};

export interface InventoryGroupRow {
  stock_group: string;
  item_count: number;
  items_in_stock: number;
  stock_value: number;
  sales_value: number;
  gross_profit: number;
}

export const inventoryGroupsMetric: MetricDefinition<Record<string, never>, InventoryGroupRow[]> = {
  id: 'inventory.groups',
  title: 'Inventory by group',
  description: 'Stock value and sales rolled up by stock group.',
  params: [],
  output: [
    { column: 'stock_group', type: 'text' },
    { column: 'item_count', type: 'int' },
    { column: 'stock_value', type: 'numeric' },
    { column: 'sales_value', type: 'numeric' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_inventory_groups' },
  run: async () => {
    const rows = await query<InventoryGroupRow>(
      `select stock_group, item_count, items_in_stock, stock_value, sales_value, gross_profit
       from mart.mart_inventory_by_group order by stock_value desc`,
    );
    return rows.map((r) => ({
      ...r, item_count: Number(r.item_count), items_in_stock: Number(r.items_in_stock),
      stock_value: Number(r.stock_value), sales_value: Number(r.sales_value), gross_profit: Number(r.gross_profit),
    }));
  },
};

export const inventorySlowMoversMetric: MetricDefinition<{ slowDays?: number }, InventoryItemRow[]> = {
  id: 'inventory.slowMovers',
  title: 'Slow / dead stock',
  description: 'Items with stock on hand but no movement within the slow-days window — capital tied up.',
  params: [{ name: 'slowDays', type: 'number', default: 180 }],
  output: [
    { column: 'item', type: 'text' },
    { column: 'stock_value', type: 'numeric' },
    { column: 'days_since_movement', type: 'int' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_inventory_slow_movers' },
  run: async ({ slowDays = 180 } = {}) => {
    const rows = await query<InventoryItemRow>(
      `select item, stock_group, uom, qty, rate, stock_value, outward_qty, sales_value,
              last_movement_date, days_since_movement, is_negative_stock
       from mart.mart_inventory_items
       where qty <> 0 and coalesce(days_since_movement, 999999) > $1
       order by stock_value desc nulls last`,
      [slowDays],
    );
    return rows.map((r) => ({
      ...r, qty: Number(r.qty), rate: Number(r.rate), stock_value: Number(r.stock_value),
      outward_qty: Number(r.outward_qty), sales_value: Number(r.sales_value),
    }));
  },
};
