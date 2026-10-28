// Computes FIFO-matched open "layers" per receivable ledger from fact_gl.
//
// Why: bill-wise (referenced) tracking covers only ~7 of 149 active debtors here
// (see DICTIONARY.md) — most receivables have no bill reference at all. So aging
// can't be "days since due date on a referenced bill"; it has to be derived from
// the transaction stream itself: each debit (invoice/debit note) is a candidate
// "layer" that ages until it's matched by a later credit (receipt/credit note),
// oldest layer consumed first — the same FIFO-lot-matching idea used for
// inventory costing, applied to money instead of stock.
//
// Algorithm per ledger (rows ordered by date, then gl_id):
//   queue = []  // open layers: { date, remaining }  (remaining can be +Dr or -Cr/advance)
//   for each posting amt (debit-positive signed_amount):
//     while amt != 0 and queue non-empty and sign(queue[0].remaining) != sign(amt):
//       front = queue[0]
//       if |front.remaining| <= |amt|: amt += front.remaining; queue.shift()   // fully consumes front
//       else: front.remaining += amt; amt = 0                                  // partially consumes front
//     if amt != 0: queue.push({ date, remaining: amt })   // opens a new layer
//   -> queue at the end = open layers as of `asOfDate`, each dated when it originated.
//
// Result is written to fact.fact_receivables_fifo (one row per open layer).

import dotenv from 'dotenv';
import pg from 'pg';
import path from 'node:path';
import url from 'node:url';
import { fifoMatchByLedger } from './fifo-core.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const asOfDate = process.argv[2] || new Date().toISOString().slice(0, 10);

const pool = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT), database: process.env.PGDATABASE,
  user: process.env.PGUSER, password: process.env.PGPASSWORD, ssl: { rejectUnauthorized: false }, max: 3,
});

async function main() {
  console.log(`[fifo] computing open layers as of ${asOfDate} …`);

  const { rows } = await pool.query(
    `select dl.ledger_name, g.date, g.signed_amount, g.gl_id
     from fact.fact_gl g
     join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
     where dl.is_receivable and g.date <= $1
     order by dl.ledger_name, g.date, g.gl_id`,
    [asOfDate],
  );

  const layerRows = fifoMatchByLedger(rows);
  const ledgerCount = new Set(rows.map((r) => r.ledger_name)).size;

  console.log(`[fifo] ${ledgerCount} ledgers processed, ${layerRows.length} open layers found.`);

  // Create-if-absent + TRUNCATE (not drop+recreate): the mart.v_receivables_*
  // views depend on this table, and a bare DROP would fail while they exist (and
  // CASCADE would leave them missing if `npm run fifo` is run on its own). Truncate
  // keeps the table and its dependents intact and just swaps the rows.
  await pool.query(`
    create schema if not exists fact;
    create table if not exists fact.fact_receivables_fifo (
      layer_id        bigint generated always as identity primary key,
      ledger_name     varchar not null,
      opened_date     date not null,
      remaining_amount numeric(17,2) not null,
      as_of_date      date not null
    );
    create index if not exists fact_recv_fifo_ledger on fact.fact_receivables_fifo(ledger_name);
    create index if not exists fact_recv_fifo_opened on fact.fact_receivables_fifo(opened_date);
  `);

  await pool.query('begin');
  try {
    await pool.query('truncate fact.fact_receivables_fifo');

    const CHUNK = 500;
    for (let i = 0; i < layerRows.length; i += CHUNK) {
      const chunk = layerRows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      chunk.forEach((r, idx) => {
        const b = idx * 4;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
        params.push(r.ledger_name, r.opened_date, r.remaining_amount, asOfDate);
      });
      await pool.query(
        `insert into fact.fact_receivables_fifo (ledger_name, opened_date, remaining_amount, as_of_date) values ${values.join(',')}`,
        params,
      );
    }

    await pool.query('commit');
  } catch (e) {
    await pool.query('rollback');
    throw e;
  }

  console.log('[fifo] fact.fact_receivables_fifo written.');
  await pool.end();
}

main().catch((e) => { console.error('[fifo] error:', e.message); process.exit(1); });
