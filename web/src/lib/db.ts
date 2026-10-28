// Server-only Postgres access. Do not import from client components.
import { Pool, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    try {
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
        // Serverless-safe pooling: on Vercel each warm function instance keeps its
        // OWN pool, so hold few connections and release idle ones fast — otherwise
        // a Supabase pooler is exhausted and every later request silently returns
        // []. Point DATABASE_URL at the TRANSACTION pooler (:6543) in production.
        max: Number(process.env.PG_POOL_MAX ?? 3),
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
      });
      // Critical on serverless: without this listener, an idle connection dropped
      // by the pooler makes node-pg emit an UNHANDLED 'error' that crashes the
      // whole function (surfaces as "not connected" with nothing in the browser).
      pool.on('error', (err) => console.error('[db] idle client error:', err.message));
    } catch (err) {
      // getPool() runs before query()'s try/catch, so a bad/missing URL must not
      // throw out of here — that would 500 every page instead of degrading to
      // the "not connected" state.
      console.error('[db] pool init failed:', (err as Error).message);
      pool = null;
      return null;
    }
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
