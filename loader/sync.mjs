// B0 sync orchestrator: records a run in meta.sync_runs, then drives the
// reference Tally Database Loader (reused as-is) to push raw data into Supabase.
//
//   node sync.mjs initdb        -> just create/upgrade the meta schema
//   node sync.mjs full          -> full (re)load of all history
//   node sync.mjs incremental   -> incremental sync (default)
//
// Connection + Tally settings come from ../.env (see .env.example).

import dotenv from 'dotenv';
import pg from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const mode = (process.argv[2] || 'incremental').toLowerCase();
const here = path.dirname(url.fileURLToPath(import.meta.url));
// .env lives at the project root (one level up from loader/), regardless of cwd.
dotenv.config({ path: path.resolve(here, '../.env') });
const loaderDir = path.resolve(here, process.env.LOADER_DIR || '../../tally-database-loader-utility-1.0.43');

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, // Supabase presents a managed cert chain
});

async function ensureMeta() {
  const sql = fs.readFileSync(path.resolve(here, '../db/meta.sql'), 'utf8');
  await pool.query(sql);
}

async function main() {
  if (!process.env.PGHOST) throw new Error('PGHOST not set — copy .env.example to .env and fill in Supabase credentials.');
  await ensureMeta();
  if (mode === 'initdb') {
    console.log('[sync] meta schema ready.');
    return;
  }

  const syncType = mode === 'full' ? 'full' : 'incremental';
  const { rows: [run] } = await pool.query(
    `insert into meta.sync_runs (job, sync_type, status) values ('raw', $1, 'running') returning id`,
    [syncType],
  );
  const runId = run.id;
  console.log(`[sync] run #${runId} (${syncType}) started; loader dir = ${loaderDir}`);

  // Generate config.json inside the loader dir from env (password left blank — passed via CLI).
  const cfg = {
    database: {
      technology: 'postgres',
      server: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      ssl: true,
      schema: process.env.PGDATABASE || 'postgres',
      username: process.env.PGUSER,
      password: '',
      loadmethod: process.env.LOAD_METHOD || 'insert',
    },
    tally: {
      definition: 'tally-export-config.yaml',
      server: process.env.TALLY_SERVER || 'localhost',
      port: Number(process.env.TALLY_PORT || 9000),
      fromdate: process.env.TALLY_FROMDATE || '2020-04-01',
      todate: process.env.TALLY_TODATE || '2027-03-31',
      sync: syncType,
      batchsize: 5000,
      frequency: 0,
      company: process.env.TALLY_COMPANY || '',
    },
  };
  fs.writeFileSync(path.join(loaderDir, 'config.json'), JSON.stringify(cfg, null, 2));

  const child = spawn('node', ['dist/index.mjs', '--database-password', process.env.PGPASSWORD || ''],
    { cwd: loaderDir, shell: false });

  let tail = '';
  const capture = (d) => { tail = (tail + d.toString()).slice(-4000); process.stdout.write(d); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const code = await new Promise((r) => child.on('close', r));

  // The loader's own process always exits 0 (it swallows internal errors and
  // just logs them), so exit code alone cannot tell success from failure.
  // Its index.mjs prints one of these two literal lines on every run — use that.
  const ok = code === 0 && tail.includes('Import completed successfully') && !tail.includes('Error in importing data');
  await pool.query(
    `update meta.sync_runs set status = $1, finished_at = now(), message = $2 where id = $3`,
    [ok ? 'success' : 'failed', tail, runId],
  );
  console.log(`\n[sync] run #${runId} ${ok ? 'SUCCESS' : 'FAILED'} (exit ${code}).`);
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => { console.error('[sync] error:', e.message); process.exitCode = 1; })
  .finally(async () => { await pool.end().catch(() => {}); });
