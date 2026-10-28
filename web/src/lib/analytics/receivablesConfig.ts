import { query } from '@/lib/db';

// Thresholds live in meta.app_config (seeded in db/meta.sql) so they're tunable
// in-app without a code change or a data re-transform. FIFO layers (fact.fact_receivables_fifo)
// are recomputed per sync; bucketing/scoring against these thresholds happens at
// read time here, so changing a threshold takes effect on the next page load.
//
// Note: the seeded risk_weights key is named "breach" (from the original bill-credit-period
// design), but NCPL maintains no credit periods (see DICTIONARY.md), so that weight is
// repurposed here as the "dormancy" component (no recent activity = risk) — same key,
// re-interpreted meaning, no migration needed.

export interface ReceivablesConfig {
  agingEdges: number[];
  dormantDays: number;
  riskWeights: { overdue: number; age: number; concentration: number; dormancy: number };
  riskBands: [number, number];
  spikeX: number;
  tinyDays: number;
  tinyAmount: number;
}

const DEFAULTS: ReceivablesConfig = {
  agingEdges: [30, 60, 90, 180],
  dormantDays: 90,
  riskWeights: { overdue: 0.35, age: 0.25, concentration: 0.2, dormancy: 0.2 },
  riskBands: [30, 60],
  spikeX: 3,
  tinyDays: 180,
  tinyAmount: 1000,
};

export async function getReceivablesConfig(): Promise<ReceivablesConfig> {
  const rows = await query<{ key: string; value: unknown }>(
    `select key, value from meta.app_config where category = 'receivables'`,
  );
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const weights = (m.get('receivables.risk_weights') as Record<string, number> | undefined) ?? {};
  const bands = (m.get('receivables.risk_bands') as number[] | undefined) ?? DEFAULTS.riskBands;
  return {
    agingEdges: (m.get('receivables.aging_edges') as number[] | undefined) ?? DEFAULTS.agingEdges,
    dormantDays: (m.get('receivables.dormant_days') as number | undefined) ?? DEFAULTS.dormantDays,
    riskWeights: {
      overdue: weights.overdue ?? DEFAULTS.riskWeights.overdue,
      age: weights.age ?? DEFAULTS.riskWeights.age,
      concentration: weights.concentration ?? DEFAULTS.riskWeights.concentration,
      dormancy: weights.breach ?? DEFAULTS.riskWeights.dormancy,
    },
    riskBands: [bands[0] ?? DEFAULTS.riskBands[0], bands[1] ?? DEFAULTS.riskBands[1]],
    spikeX: (m.get('receivables.spike_x') as number | undefined) ?? DEFAULTS.spikeX,
    tinyDays: (m.get('receivables.tiny_days') as number | undefined) ?? DEFAULTS.tinyDays,
    tinyAmount: (m.get('receivables.tiny_amount') as number | undefined) ?? DEFAULTS.tinyAmount,
  };
}

export async function updateReceivablesConfig(updates: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    await query(
      `update meta.app_config set value = $2::jsonb, updated_at = now() where key = $1`,
      [key, JSON.stringify(value)],
    );
  }
}

/** Bucket label for an age in days, given ordered edges — regenerated from the
 *  edges themselves so labels never go stale when thresholds change. */
export function bucketLabel(ageDays: number, edges: number[]): string {
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
