// Filter-aware payables data access — the supplier-side mirror of receivablesData.
// Payables aging is computed at request time via the shared FIFO core (Den carries
// no supplier openings, so FIFO over fact_gl ties exactly to each ledger's closing
// credit balance). Amounts are credit-positive here: a positive "owed" = we owe.
import { query } from '@/lib/db';
import { fifoMatchByLedger } from './fifo';

export interface PayableFilters {
  asOf?: string;
  from?: string;
  to?: string;
  q?: string;
  group?: string;
  minAmt?: number;
  bucket?: string;
}

export interface PayableLayer {
  ledger_name: string;
  party: string;
  group_name: string;
  opened_date: string;
  owed_amount: number; // + = we owe; − = advance we've paid
  age_days: number;
}

function toISO(d: string | Date): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86400000);
}

export async function getPayableGroups(): Promise<string[]> {
  const rows = await query<{ group_name: string }>(
    `select distinct group_name from dim.dim_ledger where is_payable and group_name is not null order by group_name`,
  );
  return rows.map((r) => r.group_name);
}

/** Open FIFO layers for supplier ledgers, aged against `asOf`. */
export async function loadPayableLayers(filters: PayableFilters = {}): Promise<PayableLayer[]> {
  const asOf = filters.asOf || new Date().toISOString().slice(0, 10);
  const rows = await query<{ ledger_name: string; party: string; group_name: string; date: string; signed_amount: string }>(
    `select dl.ledger_name, dl.display_name as party, dl.group_name, g.date, g.signed_amount
     from fact.fact_gl g
     join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
     where dl.is_payable and g.date <= $1
     order by dl.ledger_name, g.date, g.gl_id`,
    [asOf],
  );

  const meta = new Map<string, { party: string; group_name: string }>();
  for (const r of rows) if (!meta.has(r.ledger_name)) meta.set(r.ledger_name, { party: r.party, group_name: r.group_name });

  // Feed credit-positive amounts so a positive open layer = amount owed.
  const raw = fifoMatchByLedger(rows.map((r) => ({ ledger_name: r.ledger_name, date: r.date, signed_amount: -Number(r.signed_amount) })));

  let layers: PayableLayer[] = raw.map((l) => {
    const m = meta.get(l.ledger_name);
    const opened = toISO(l.opened_date);
    return {
      ledger_name: l.ledger_name,
      party: m?.party ?? l.ledger_name.trim(),
      group_name: m?.group_name ?? '(none)',
      opened_date: opened,
      owed_amount: l.remaining_amount,
      age_days: daysBetween(opened, asOf),
    };
  });

  if (filters.from) layers = layers.filter((l) => l.opened_date >= filters.from!);
  if (filters.to) layers = layers.filter((l) => l.opened_date <= filters.to!);
  if (filters.group) layers = layers.filter((l) => l.group_name === filters.group);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    layers = layers.filter((l) => l.party.toLowerCase().includes(q));
  }
  if (filters.minAmt != null && filters.minAmt > 0) layers = layers.filter((l) => l.owed_amount >= filters.minAmt!);
  return layers;
}

export function parsePayableFilters(sp: Record<string, string | string[] | undefined>): PayableFilters {
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
  };
}
