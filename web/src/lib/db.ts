// Server-only Postgres access. Do not import from client components.
import { Pool, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    // Parse into discrete fields rather than passing `connectionString` directly:
    // pg-connection-string re-derives its own `ssl` config from a `sslmode=`
    // query param and that takes precedence over an explicit `ssl` option,
    // which defeats `rejectUnauthorized: false` for Supabase's cert chain.
    const u = new URL(process.env.DATABASE_URL);
    pool = new Pool({
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      database: u.pathname.replace(/^\//, '') || 'postgres',
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      ssl: { rejectUnauthorized: false }, // Supabase managed cert
      max: 5,
    });
  }
  return pool;
}

/** Run a read query. Returns [] if the DB isn't configured or the query errors
 *  (so the shell renders before Supabase is connected). */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  try {
    const res = await p.query<T>(text, params as never);
    return res.rows;
  } catch (err) {
    console.error('[db] query failed:', (err as Error).message);
    return [];
  }
}
