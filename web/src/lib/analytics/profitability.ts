// Party-wise profitability, shared by Receivables (customers) and Payables (suppliers).
//
// METHOD: Tally doesn't store a cost on each sales line, so per-party profit is
// attributed from the ITEM margin. For each party we sum, over the items they
// transacted, (their value on that item) × (that item's gross-margin %). Item
// margin is the value-based figure from mart_inventory_items (opening + purchases −
// closing), which ties to the P&L in aggregate. This is an attribution, not a
// ledger balance — Σ across parties ≈ the attributable gross profit, not exact.
//   * Customers: value = sales (outward) to them → their profit contribution.
//   * Suppliers: value = purchases (inward) from them → margin the goods they
//     source go on to earn.
import { query } from '@/lib/db';

export interface PartyProfit {
  ledger_name: string;
  party: string;
  group_name: string;
  revenue: number;        // customers: sales value; suppliers: purchase value sourced
  gross_profit: number;   // margin-attributed
  margin_pct: number | null;
  item_count: number;
}

export interface ProfitabilityFilters {
  q?: string;
  group?: string;
  from?: string;
  to?: string;
}

async function load(side: 'customer' | 'supplier', filters: ProfitabilityFilters): Promise<PartyProfit[]> {
  // Customers debit-track receivables and appear on OUTWARD (sale) lines;
  // suppliers on INWARD (purchase) lines. Amount is credit-positive: outward +,
  // inward −, so we normalise to a positive "value".
  const isCustomer = side === 'customer';
  const partyFlag = isCustomer ? 'dl.is_receivable' : 'dl.is_payable';
  const qtySign = isCustomer ? 'ti.quantity < 0' : 'ti.quantity > 0';
  const valueExpr = isCustomer ? 'ti.amount' : '-ti.amount';

  const rows = await query<{
    ledger_name: string; party: string; group_name: string;
    revenue: string; gross_profit: string; item_count: string;
  }>(
    `select dl.ledger_name,
            dl.display_name as party,
            dl.group_name,
            round(sum(${valueExpr}), 2)                                              as revenue,
            round(sum(${valueExpr} * coalesce(mi.gross_margin_pct, 0) / 100.0), 2)   as gross_profit,
            count(distinct ti.item)                                                  as item_count
     from trn_inventory ti
     join trn_voucher v on v.guid = ti.guid
     join dim.dim_ledger dl on dl.ledger_name = v.party_name and ${partyFlag}
     left join mart.mart_inventory_items mi on mi.item = ti.item
     where ${qtySign}
       and (v.is_accounting_voucher = 1 or v.is_inventory_voucher = 1)
       and ($1::date is null or v.date >= $1::date)
       and ($2::date is null or v.date <= $2::date)
     group by dl.ledger_name, dl.display_name, dl.group_name`,
    [filters.from ?? null, filters.to ?? null],
  );

  let out: PartyProfit[] = rows.map((r) => {
    const revenue = Number(r.revenue);
    const gross_profit = Number(r.gross_profit);
    return {
      ledger_name: r.ledger_name,
      party: r.party,
      group_name: r.group_name,
      revenue,
      gross_profit,
      margin_pct: revenue !== 0 ? Math.round((gross_profit / revenue) * 1000) / 10 : null,
      item_count: Number(r.item_count),
    };
  });

  if (filters.group) out = out.filter((p) => p.group_name === filters.group);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    out = out.filter((p) => p.party.toLowerCase().includes(q));
  }
  return out.filter((p) => p.revenue !== 0).sort((a, b) => b.gross_profit - a.gross_profit);
}

export const loadCustomerProfitability = (f: ProfitabilityFilters = {}) => load('customer', f);
export const loadSupplierProfitability = (f: ProfitabilityFilters = {}) => load('supplier', f);
