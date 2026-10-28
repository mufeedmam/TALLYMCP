import { query } from '@/lib/db';

// The loaded company's name lives in the loader's `config` table (updated every
// sync). Reading it keeps the app company-agnostic — nothing hardcodes NAQD, so
// reloading a different company (Den Healthcare, …) just works.
export async function getCompanyName(): Promise<string | null> {
  const rows = await query<{ value: string }>(
    `select value from config where name = 'Company Name' limit 1`,
  );
  return rows[0]?.value ?? null;
}
