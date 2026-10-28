import { query } from '@/lib/db';

// Inventory thresholds live in meta.app_config (category 'inventory') so they're
// tunable in-app. The mart holds threshold-INDEPENDENT facts; the slow/dead flag
// and the profit-reliability flag are applied at read time against this config,
// so changing a threshold takes effect on the next page load (no re-transform).

export interface InventoryConfig {
  slowDays: number;
  marginBand: [number, number]; // plausible gross-margin % band; outside → profit_unreliable
}

const DEFAULTS: InventoryConfig = {
  slowDays: 180,
  marginBand: [-20, 95],
};

export async function getInventoryConfig(): Promise<InventoryConfig> {
  const rows = await query<{ key: string; value: unknown }>(
    `select key, value from meta.app_config where category = 'inventory'`,
  );
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const band = (m.get('inventory.margin_band') as number[] | undefined) ?? DEFAULTS.marginBand;
  return {
    slowDays: (m.get('inventory.slow_days') as number | undefined) ?? DEFAULTS.slowDays,
    marginBand: [band[0] ?? DEFAULTS.marginBand[0], band[1] ?? DEFAULTS.marginBand[1]],
  };
}

export async function updateInventoryConfig(updates: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    // Upsert (not bare update) so a save works even before the key is seeded.
    await query(
      `insert into meta.app_config (key, value, category, updated_at)
       values ($1, $2::jsonb, 'inventory', now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}
