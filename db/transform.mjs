// Applies SQL model files in db/models/ in filename order (idempotent).
import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const pool = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT), database: process.env.PGDATABASE,
  user: process.env.PGUSER, password: process.env.PGPASSWORD, ssl: { rejectUnauthorized: false }, max: 3,
});

// node transform.mjs [filenameSubstring] [modelsSubdir]
const only = process.argv[2] || '';
const modelsDir = path.join(here, process.argv[3] || 'models');

const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.sql') && (!only || f.includes(only))).sort();

console.log(`[transform] applying ${files.length} model file(s)…`);
for (const f of files) {
  const sql = fs.readFileSync(path.join(modelsDir, f), 'utf8');
  const t0 = Date.now();
  try {
    await pool.query(sql);
    console.log(`  ✓ ${f} (${Date.now() - t0} ms)`);
  } catch (e) {
    console.error(`  ✗ ${f}: ${e.message}`);
    await pool.end();
    process.exit(1);
  }
}
await pool.end();
console.log('[transform] done.');
