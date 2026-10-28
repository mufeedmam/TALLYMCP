// MCP/API-facing receivables metrics.
//
// These delegate to lib/analytics/receivablesData so they compute EXACTLY what the
// dashboard shows — same loader, same bucketing, same filters. Previously each
// metric ran its own SQL, which meant the UI and the future MCP tools could
// silently disagree about the same question.
import type { MetricDefinition } from '../types';
import { query } from '@/lib/db';
import { getReceivablesConfig } from '../receivablesConfig';
import {
  loadOpenLayers,
  loadParties,
  bucketFor,
  bucketOrder,
  type ReceivablesFilters,
  type OpenLayer,
} from '../receivablesData';

/** Filters every receivables metric accepts, so MCP callers can slice like the UI. */
const FILTER_PARAMS = [
  { name: 'asOf', type: 'string' as const, description: 'Aging reference date (YYYY-MM-DD)' },
  { name: 'from', type: 'string' as const, description: 'Only layers opened on/after this date' },
  { name: 'to', type: 'string' as const, description: 'Only layers opened on/before this date' },
  { name: 'q', type: 'string' as const, description: 'Party name contains' },
  { name: 'group', type: 'string' as const, description: 'Exact ledger group' },
  { name: 'minAmt', type: 'number' as const, description: 'Minimum open amount per layer' },
];

async function openLayers(f: ReceivablesFilters): Promise<OpenLayer[]> {
  return (await loadOpenLayers(f)).filter((l) => l.remaining_amount > 0);
}

function rollupByParty(layers: OpenLayer[]) {
  const m = new Map<string, { ledger_name: string; party: string; group_name: string; total: number; oldest: number; count: number }>();
  for (const l of layers) {
    const e = m.get(l.ledger_name) ?? { ledger_name: l.ledger_name, party: l.party, group_name: l.group_name, total: 0, oldest: 0, count: 0 };
    e.total += l.remaining_amount;
    e.oldest = Math.max(e.oldest, l.age_days);
    e.count += 1;
    m.set(l.ledger_name, e);
  }
  return [...m.values()].map((e) => ({ ...e, total: Math.round(e.total * 100) / 100 }));
}

/* ---------- snapshot ---------- */

export interface ReceivablesSnapshot {
  total_receivable: number;
  active_debtor_count: number;
  oldest_age_days: number | null;
  total_advance: number;
  overdue_amount: number;
}

export const receivablesSnapshotMetric: MetricDefinition<ReceivablesFilters, ReceivablesSnapshot> = {
  id: 'receivables.snapshot',
  title: 'Receivables snapshot',
  description: 'Headline receivables KPIs: total open, debtor count, oldest exposure, unadjusted advances, overdue amount.',
  params: FILTER_PARAMS,
  output: [
    { column: 'total_receivable', type: 'numeric', semantic: 'sum of open FIFO layers, debit-positive' },
    { column: 'active_debtor_count', type: 'int' },
    { column: 'oldest_age_days', type: 'int' },
    { column: 'total_advance', type: 'numeric', semantic: 'unadjusted advances received (credit balances)' },
    { column: 'overdue_amount', type: 'numeric', semantic: 'older than the first configured aging edge' },
  ],
  reconcile: 'mart_party_receivables',
  mcp: { toolName: 'get_receivables_snapshot' },
  run: async (f = {}) => {
    const [cfg, all] = await Promise.all([getReceivablesConfig(), loadOpenLayers(f)]);
    const open = all.filter((l) => l.remaining_amount > 0);
    const firstEdge = Math.min(...cfg.agingEdges);
    return {
      total_receivable: Math.round(open.reduce((s, l) => s + l.remaining_amount, 0) * 100) / 100,
      active_debtor_count: new Set(open.map((l) => l.ledger_name)).size,
      oldest_age_days: open.length ? Math.max(...open.map((l) => l.age_days)) : null,
      total_advance:
        Math.round(Math.abs(all.filter((l) => l.remaining_amount < 0).reduce((s, l) => s + l.remaining_amount, 0)) * 100) / 100,
      overdue_amount:
        Math.round(open.filter((l) => l.age_days > firstEdge).reduce((s, l) => s + l.remaining_amount, 0) * 100) / 100,
    };
  },
};

/* ---------- aging ---------- */

export interface AgingBucketRow {
  bucket: string;
  amount: number;
  layer_count: number;
}

export const receivablesAgingBucketsMetric: MetricDefinition<ReceivablesFilters, AgingBucketRow[]> = {
  id: 'receivables.agingBuckets',
  title: 'Receivables aging (FIFO)',
  description: 'Open receivable by age bucket (edges configurable in Settings), from FIFO-matched layers — covers all debtors, not just bill-referenced ones.',
  params: FILTER_PARAMS,
  output: [
    { column: 'bucket', type: 'text', semantic: 'generated from the configured aging edges' },
    { column: 'amount', type: 'numeric' },
    { column: 'layer_count', type: 'int' },
  ],
  reconcile: 'mart_party_receivables',
  mcp: { toolName: 'get_receivables_aging_buckets' },
  run: async (f = {}) => {
    const [cfg, layers] = await Promise.all([getReceivablesConfig(), openLayers(f)]);
    const order = bucketOrder(cfg.agingEdges);
    const totals = new Map(order.map((b) => [b, { amount: 0, count: 0 }]));
    for (const l of layers) {
      const t = totals.get(bucketFor(l.age_days, cfg.agingEdges));
      if (!t) continue;
      t.amount += l.remaining_amount;
      t.count += 1;
    }
    return order.map((b) => ({
      bucket: b,
      amount: Math.round((totals.get(b)?.amount ?? 0) * 100) / 100,
      layer_count: totals.get(b)?.count ?? 0,
    }));
  },
};

/* ---------- exposures ---------- */

export interface TopExposureRow {
  ledger_name: string;
  party: string;
  group_name: string;
  open_receivable: number;
  max_age_days: number;
}

export const receivablesTopExposuresMetric: MetricDefinition<ReceivablesFilters & { limit?: number }, TopExposureRow[]> = {
  id: 'receivables.topExposures',
  title: 'Top receivable exposures',
  description: 'Debtors with the largest open balance, with their oldest unmatched age.',
  params: [...FILTER_PARAMS, { name: 'limit', type: 'number' as const, default: 10 }],
  output: [
    { column: 'ledger_name', type: 'text', semantic: 'raw Tally ledger name, join key' },
    { column: 'party', type: 'text' },
    { column: 'group_name', type: 'text' },
    { column: 'open_receivable', type: 'numeric' },
    { column: 'max_age_days', type: 'int' },
  ],
  reconcile: 'mart_party_receivables',
  mcp: { toolName: 'get_receivables_top_exposures' },
  run: async ({ limit = 10, ...f } = {}) => {
    const layers = await openLayers(f);
    return rollupByParty(layers)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .map((r) => ({
        ledger_name: r.ledger_name,
        party: r.party,
        group_name: r.group_name,
        open_receivable: r.total,
        max_age_days: r.oldest,
      }));
  },
};

/* ---------- groupwise ---------- */

export interface GroupwiseRow {
  group_name: string;
  debtor_count: number;
  total_receivable: number;
  overdue_amount: number;
}

export const receivablesGroupwiseMetric: MetricDefinition<ReceivablesFilters, GroupwiseRow[]> = {
  id: 'receivables.groupwise',
  title: 'Receivables by group',
  description: 'Open receivable rolled up by ledger group, with the portion older than the first aging edge.',
  params: FILTER_PARAMS,
  output: [
    { column: 'group_name', type: 'text' },
    { column: 'debtor_count', type: 'int' },
    { column: 'total_receivable', type: 'numeric' },
    { column: 'overdue_amount', type: 'numeric' },
  ],
  reconcile: 'mart_party_receivables',
  mcp: { toolName: 'get_receivables_groupwise' },
  run: async (f = {}) => {
    const [cfg, layers] = await Promise.all([getReceivablesConfig(), openLayers(f)]);
    const firstEdge = Math.min(...cfg.agingEdges);
    const m = new Map<string, { ledgers: Set<string>; total: number; overdue: number }>();
    for (const l of layers) {
      const g = m.get(l.group_name) ?? { ledgers: new Set<string>(), total: 0, overdue: 0 };
      g.ledgers.add(l.ledger_name);
      g.total += l.remaining_amount;
      if (l.age_days > firstEdge) g.overdue += l.remaining_amount;
      m.set(l.group_name, g);
    }
    return [...m.entries()]
      .map(([group_name, g]) => ({
        group_name,
        debtor_count: g.ledgers.size,
        total_receivable: Math.round(g.total * 100) / 100,
        overdue_amount: Math.round(g.overdue * 100) / 100,
      }))
      .sort((a, b) => b.total_receivable - a.total_receivable);
  },
};

/* ---------- risk ---------- */

export interface RiskRow {
  ledger_name: string;
  party: string;
  group_name: string;
  receivable_dr: number;
  score: number;
  band: 'Low' | 'Med' | 'High';
  overdue_pct: number;
  max_age_days: number;
  days_since_activity: number | null;
}

export const receivablesRiskMetric: MetricDefinition<ReceivablesFilters, RiskRow[]> = {
  id: 'receivables.risk',
  title: 'Receivables risk score',
  description:
    'Weighted 0-100 score per debtor: overdue % + age + concentration (share of AR) + dormancy. No credit-limit/period term — NCPL maintains neither (see DICTIONARY.md).',
  params: FILTER_PARAMS,
  output: [
    { column: 'ledger_name', type: 'text' },
    { column: 'party', type: 'text' },
    { column: 'score', type: 'int', semantic: '0-100, higher = riskier' },
    { column: 'band', type: 'text', semantic: 'Low | Med | High from configured bands' },
    { column: 'overdue_pct', type: 'numeric' },
    { column: 'max_age_days', type: 'int' },
    { column: 'days_since_activity', type: 'int' },
  ],
  reconcile: 'mart_party_receivables',
  mcp: { toolName: 'get_receivables_risk' },
  run: async (f = {}) => {
    const [cfg, layers, allParties] = await Promise.all([getReceivablesConfig(), openLayers(f), loadParties(f)]);
    const parties = allParties.filter((p) => p.balance_type === 'receivable');
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

    return parties
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
          ledger_name: p.ledger_name,
          party: p.party,
          group_name: p.group_name,
          receivable_dr: Math.round(p.receivable_dr * 100) / 100,
          score,
          band: (score <= lowMax ? 'Low' : score <= medMax ? 'Med' : 'High') as RiskRow['band'],
          overdue_pct: Math.round(overduePct * 1000) / 10,
          max_age_days: a.maxAge,
          days_since_activity: p.days_since_activity,
        };
      })
      .sort((a, b) => b.score - a.score);
  },
};

/* ---------- dormant ---------- */

export interface NoActivityRow {
  ledger_name: string;
  party: string;
  group_name: string;
  receivable_dr: number;
  last_activity_date: string | null;
  days_since_activity: number | null;
}

export const receivablesNoActivityMetric: MetricDefinition<ReceivablesFilters, NoActivityRow[]> = {
  id: 'receivables.noActivity',
  title: 'Dormant debtors',
  description: 'Debtors with an open balance but no transaction within the configured dormant-days window.',
  params: FILTER_PARAMS,
  output: [
    { column: 'ledger_name', type: 'text' },
    { column: 'party', type: 'text' },
    { column: 'receivable_dr', type: 'numeric' },
    { column: 'last_activity_date', type: 'date' },
    { column: 'days_since_activity', type: 'int' },
  ],
  reconcile: 'mart_party_receivables',
  mcp: { toolName: 'get_receivables_no_activity' },
  run: async (f = {}) => {
    const [cfg, parties] = await Promise.all([getReceivablesConfig(), loadParties(f)]);
    return parties
      .filter((p) => p.balance_type === 'receivable' && (p.days_since_activity ?? 999999) >= cfg.dormantDays)
      .sort((a, b) => (b.days_since_activity ?? 0) - (a.days_since_activity ?? 0))
      .map((p) => ({
        ledger_name: p.ledger_name,
        party: p.party,
        group_name: p.group_name,
        receivable_dr: Math.round(p.receivable_dr * 100) / 100,
        last_activity_date: p.last_activity_date,
        days_since_activity: p.days_since_activity,
      }));
  },
};

/* ---------- unusual ---------- */

export interface UnusualResult {
  spikes: { ledger_name: string; party: string; current_balance: number; avg_monthly_debit: number; ratio: number }[];
  staleAdvances: { ledger_name: string; party: string; advance_amount: number; days_since_activity: number | null }[];
  longOpenTiny: { ledger_name: string; party: string; opened_date: string; age_days: number; amount: number }[];
}

export const receivablesUnusualMetric: MetricDefinition<ReceivablesFilters, UnusualResult> = {
  id: 'receivables.unusual',
  title: 'Unusual receivables patterns',
  description: 'Rule-based flags: balance spikes vs trailing 90-day average, advances never adjusted, and long-open small balances.',
  params: FILTER_PARAMS,
  output: [
    { column: 'spikes', type: 'array' },
    { column: 'staleAdvances', type: 'array' },
    { column: 'longOpenTiny', type: 'array' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_receivables_unusual' },
  run: async (f = {}) => {
    const [cfg, layers, parties, avgDebits] = await Promise.all([
      getReceivablesConfig(),
      openLayers(f),
      loadParties(f),
      query<{ ledger_name: string; avg_monthly_debit: string }>(`
        select ledger_name, round(sum(debit_amount) / 3.0, 2) as avg_monthly_debit
        from fact.fact_gl
        where date >= current_date - interval '90 days' and debit_amount > 0
        group by ledger_name
      `),
    ]);
    const avgMap = new Map(avgDebits.map((r) => [r.ledger_name, Number(r.avg_monthly_debit)]));

    const spikes = parties
      .filter((p) => p.balance_type === 'receivable')
      .map((p) => {
        const avg = avgMap.get(p.ledger_name) ?? 0;
        return {
          ledger_name: p.ledger_name,
          party: p.party,
          current_balance: Math.round(p.receivable_dr * 100) / 100,
          avg_monthly_debit: avg,
          ratio: avg > 0 ? p.receivable_dr / avg : 0,
        };
      })
      .filter((r) => r.avg_monthly_debit > 0 && r.ratio >= cfg.spikeX)
      .sort((a, b) => b.ratio - a.ratio);

    const staleAdvances = parties
      .filter((p) => p.balance_type === 'advance_cr' && (p.days_since_activity ?? 0) >= cfg.dormantDays)
      .map((p) => ({
        ledger_name: p.ledger_name,
        party: p.party,
        advance_amount: Math.round(-p.receivable_dr * 100) / 100,
        days_since_activity: p.days_since_activity,
      }))
      .sort((a, b) => b.advance_amount - a.advance_amount);

    const longOpenTiny = layers
      .filter((l) => l.remaining_amount <= cfg.tinyAmount && l.age_days > cfg.tinyDays)
      .sort((a, b) => b.age_days - a.age_days)
      .map((l) => ({
        ledger_name: l.ledger_name,
        party: l.party,
        opened_date: l.opened_date,
        age_days: l.age_days,
        amount: l.remaining_amount,
      }));

    return { spikes, staleAdvances, longOpenTiny };
  },
};

/* ---------- drill-down ---------- */

export interface PartyDetail {
  party: string;
  group_name: string;
  state: string | null;
  receivable_dr: number;
  balance_type: string;
  last_activity_date: string | null;
  layers: { opened_date: string; age_days: number; remaining_amount: number }[];
  transactions: { date: string; voucher_type: string; voucher_number: string; debit_amount: number; credit_amount: number; narration: string | null }[];
}

export const receivablesPartyDetailMetric: MetricDefinition<{ ledgerName: string; from?: string; to?: string }, PartyDetail | null> = {
  id: 'receivables.partyDetail',
  title: 'Party drill-down',
  description: 'FIFO open layers plus transaction history for one receivable ledger, optionally date-bounded.',
  params: [
    { name: 'ledgerName', type: 'string', required: true },
    { name: 'from', type: 'string', description: 'Transactions on/after this date' },
    { name: 'to', type: 'string', description: 'Transactions on/before this date' },
  ],
  output: [
    { column: 'layers', type: 'array' },
    { column: 'transactions', type: 'array' },
  ],
  reconcile: 'mart_party_receivables',
  mcp: { toolName: 'get_receivables_party_detail' },
  run: async ({ ledgerName, from, to }) => {
    const [partyRows, layerRows, txnRows] = await Promise.all([
      query<{ party: string; group_name: string; state: string | null; receivable_dr: string; balance_type: string; last_activity_date: string | null }>(
        `select party, group_name, state, receivable_dr, balance_type, last_activity_date::text as last_activity_date
         from mart.mart_party_receivables where ledger_name = $1`,
        [ledgerName],
      ),
      query<{ opened_date: string; age_days: number; remaining_amount: string }>(
        `select opened_date::text as opened_date, (as_of_date - opened_date) as age_days, remaining_amount
         from fact.fact_receivables_fifo where ledger_name = $1 order by opened_date`,
        [ledgerName],
      ),
      query<{ date: string; voucher_type: string; voucher_number: string; debit_amount: string; credit_amount: string; narration: string | null }>(
        `select date::text as date, voucher_type, voucher_number, debit_amount, credit_amount, narration
         from fact.fact_gl
         where ledger_name = $1
           and ($2::date is null or date >= $2::date)
           and ($3::date is null or date <= $3::date)
         order by date, gl_id`,
        [ledgerName, from ?? null, to ?? null],
      ),
    ]);
    const p = partyRows[0];
    if (!p) return null;
    return {
      party: p.party,
      group_name: p.group_name,
      state: p.state,
      receivable_dr: Number(p.receivable_dr),
      balance_type: p.balance_type,
      last_activity_date: p.last_activity_date,
      layers: layerRows.map((l) => ({ ...l, remaining_amount: Number(l.remaining_amount) })),
      transactions: txnRows.map((t) => ({ ...t, debit_amount: Number(t.debit_amount), credit_amount: Number(t.credit_amount) })),
    };
  },
};
