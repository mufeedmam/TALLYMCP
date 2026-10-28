// Filter-aware receivables data access. Every receivables metric reads through
// here so filters behave identically across every tab.
import { query } from '@/lib/db';
import { fifoMatchByLedger } from './fifo';

export interface ReceivablesFilters {
  /** Aging reference date (YYYY-MM-DD). Defaults to the precomputed snapshot date. */
  asOf?: string;
  /** Restrict to layers opened on/after this date. */
  from?: string;
  /** Restrict to layers opened on/before this date. */
  to?: string;
  /** Case-insensitive party-name substring. */
  q?: string;
  /** Exact ledger group. */
  group?: string;
  /** Minimum open balance per layer. */
  minAmt?: number;
  /** Aging bucket label, e.g. "31-60". */
  bucket?: string;
  /** Aging basis: ledger-FIFO (default) or bill-wise outstanding. */
  method?: AgingMethod;
}

export type AgingMethod = 'fifo' | 'billwise';

export interface OpenLayer {
  ledger_name: string;
  party: string;
  group_name: string;
  state: string | null;
  opened_date: string;
  remaining_amount: number;
  age_days: number;
  /** Bill reference / "On account / Opening" — only set in bill-wise mode. */
  bill_ref?: string;
  item_kind?: 'bill' | 'unreferenced';
}

function toISO(d: string | Date): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISODate: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISODate.slice(0, 4), +toISODate.slice(5, 7) - 1, +toISODate.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** The as-of date the precomputed FIFO table was built for. */
export async function getSnapshotDate(): Promise<string | null> {
  const rows = await query<{ d: string | null }>(
    `select max(as_of_date)::text as d from fact.fact_receivables_fifo`,
  );
  return rows[0]?.d ?? null;
}

/** Distinct receivable groups, for the filter dropdown. */
export async function getGroups(): Promise<string[]> {
  const rows = await query<{ group_name: string }>(
    `select distinct group_name from dim.dim_ledger where is_receivable and group_name is not null order by group_name`,
  );
  return rows.map((r) => r.group_name);
}

/** Ledger attributes, keyed by raw ledger_name. */
async function getLedgerMeta() {
  const rows = await query<{ ledger_name: string; party: string; group_name: string; state: string | null }>(
    `select ledger_name, display_name as party, group_name, state
     from dim.dim_ledger where is_receivable`,
  );
  return new Map(rows.map((r) => [r.ledger_name, r]));
}

/**
 * Open FIFO layers, aged against `asOf`.
 *
 * Fast path: when asOf matches the precomputed snapshot we read the reconciled
 * fact table. Otherwise we replay the same FIFO core over fact_gl up to that
 * date — slower, but it's the only way to answer "what did aging look like on
 * 31 March" truthfully rather than re-labelling today's layers.
 */
export async function loadOpenLayers(filters: ReceivablesFilters = {}): Promise<OpenLayer[]> {
  const snapshotDate = await getSnapshotDate();
  const asOf = filters.asOf || snapshotDate || new Date().toISOString().slice(0, 10);
  const meta = await getLedgerMeta();

  // Bill-wise basis: read the reconciled bills mart (a referenced-bill row or an
  // "On account / Opening" remainder row per ledger). It's a snapshot at the mart's
  // build date, so the arbitrary as-of recompute (a FIFO-only capability) doesn't
  // apply here; ages are measured to the snapshot date.
  if (filters.method === 'billwise') {
    const rows = await query<{ ledger_name: string; bill_ref: string; opened_date: string; remaining_amount: string; item_kind: 'bill' | 'unreferenced'; as_of: string }>(
      `select ledger_name, bill_ref, opened_date::text as opened_date, remaining_amount,
              item_kind, as_of_date::text as as_of
       from mart.mart_receivables_bills`,
    );
    const billAsOf = rows[0]?.as_of ?? snapshotDate ?? asOf;
    let layers: OpenLayer[] = rows.map((r) => {
      const m = meta.get(r.ledger_name);
      const opened = toISO(r.opened_date);
      return {
        ledger_name: r.ledger_name,
        party: m?.party ?? r.ledger_name.trim(),
        group_name: m?.group_name ?? '(none)',
        state: m?.state ?? null,
        opened_date: opened,
        remaining_amount: Number(r.remaining_amount),
        age_days: daysBetween(opened, billAsOf),
        bill_ref: r.bill_ref,
        item_kind: r.item_kind,
      };
    });
    return applyLayerFilters(layers, filters);
  }

  let raw: { ledger_name: string; opened_date: string; remaining_amount: number }[];

  if (snapshotDate && asOf === snapshotDate) {
    const rows = await query<{ ledger_name: string; opened_date: string; remaining_amount: string }>(
      `select ledger_name, opened_date::text as opened_date, remaining_amount
       from fact.fact_receivables_fifo`,
    );
    raw = rows.map((r) => ({ ...r, remaining_amount: Number(r.remaining_amount) }));
  } else {
    const rows = await query<{ ledger_name: string; date: string; signed_amount: string }>(
      `select dl.ledger_name, g.date, g.signed_amount
       from fact.fact_gl g
       join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
       where dl.is_receivable and g.date <= $1
       order by dl.ledger_name, g.date, g.gl_id`,
      [asOf],
    );
    raw = fifoMatchByLedger(rows).map((l) => ({
      ledger_name: l.ledger_name,
      opened_date: toISO(l.opened_date),
      remaining_amount: l.remaining_amount,
    }));
  }

  let layers: OpenLayer[] = raw.map((r) => {
    const m = meta.get(r.ledger_name);
    const opened = toISO(r.opened_date);
    return {
      ledger_name: r.ledger_name,
      party: m?.party ?? r.ledger_name.trim(),
      group_name: m?.group_name ?? '(none)',
      state: m?.state ?? null,
      opened_date: opened,
      remaining_amount: r.remaining_amount,
      age_days: daysBetween(opened, asOf),
    };
  });

  return applyLayerFilters(layers, filters);
}

/** Shared open-layer filters, applied identically to the FIFO and bill-wise sources. */
function applyLayerFilters(layers: OpenLayer[], filters: ReceivablesFilters): OpenLayer[] {
  let out = layers;
  if (filters.from) out = out.filter((l) => l.opened_date >= filters.from!);
  if (filters.to) out = out.filter((l) => l.opened_date <= filters.to!);
  if (filters.group) out = out.filter((l) => l.group_name === filters.group);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    out = out.filter((l) => l.party.toLowerCase().includes(q));
  }
  if (filters.minAmt != null && filters.minAmt > 0) {
    out = out.filter((l) => l.remaining_amount >= filters.minAmt!);
  }
  return out;
}

export interface PartyRow {
  ledger_name: string;
  party: string;
  group_name: string;
  receivable_dr: number;
  balance_type: string;
  last_activity_date: string | null;
  days_since_activity: number | null;
}

/** Party balances, filtered consistently with loadOpenLayers (minus layer-level filters). */
export async function loadParties(filters: ReceivablesFilters = {}): Promise<PartyRow[]> {
  const rows = await query<{
    ledger_name: string; party: string; group_name: string; receivable_dr: string;
    balance_type: string; last_activity_date: string | null; days_since_activity: number | null;
  }>(
    `select ledger_name, party, group_name, receivable_dr, balance_type,
            last_activity_date::text as last_activity_date, days_since_activity
     from mart.mart_party_receivables`,
  );

  let parties = rows.map((r) => ({ ...r, receivable_dr: Number(r.receivable_dr) }));
  if (filters.group) parties = parties.filter((p) => p.group_name === filters.group);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    parties = parties.filter((p) => p.party.toLowerCase().includes(q));
  }
  return parties;
}

/* ---------- bucketing (shared so every tab agrees) ---------- */

export function bucketFor(ageDays: number, edges: number[]): string {
  const sorted = [...edges].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (ageDays <= sorted[i]) return i === 0 ? `0-${sorted[0]}` : `${sorted[i - 1] + 1}-${sorted[i]}`;
  }
  return `${sorted[sorted.length - 1] + 1}+`;
}

export function bucketOrder(edges: number[]): string[] {
  const sorted = [...edges].sort((a, b) => a - b);
  return [
    `0-${sorted[0]}`,
    ...sorted.slice(1).map((e, i) => `${sorted[i] + 1}-${e}`),
    `${sorted[sorted.length - 1] + 1}+`,
  ];
}

/** Parse raw searchParams into typed filters. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): ReceivablesFilters {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const n = one('minAmt');
  return {
    asOf: one('asOf'),
    from: one('from'),
    to: one('to'),
    q: one('q'),
    group: one('group'),
    bucket: one('bucket'),
    minAmt: n != null && Number.isFinite(Number(n)) ? Number(n) : undefined,
    method: one('method') === 'billwise' ? 'billwise' : 'fifo',
  };
}

/** Rebuild a querystring preserving current filters, with overrides applied. */
export function buildQuery(
  current: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | number | undefined>,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s && s.trim()) p.set(k, s);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === '') p.delete(k);
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
