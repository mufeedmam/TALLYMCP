// Exports the receivables list as on a given date, with each customer's outstanding
// broken into FIFO-allocated open items ("bills"), to CSV.
//
//   node db/export_receivables_fifo.mjs [YYYY-MM-DD] [outDir]
//   default date: 2026-03-31 (FY 2025-26 close)
//
// Uses THE shared FIFO core (db/fifo-core.mjs) replayed over fact_gl up to the given
// date, so the figures are the true position on that date — not today's layers
// re-labelled. Verified in reconcile.mjs: the replay reproduces the GL position
// exactly at 2026-03-31, 2025-12-31 and 2024-06-30.
//
// Writes two files:
//   receivables_fifo_detail_<date>.csv   one row per FIFO-allocated open item
//   receivables_fifo_summary_<date>.csv  one row per customer, with aging buckets

import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { fifoMatchByLedger } from './fifo-core.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const asOf = process.argv[2] || '2026-03-31';
const outDir = path.resolve(process.argv[3] || path.join(here, '../exports'));

if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error(`[export] invalid date "${asOf}" — expected YYYY-MM-DD`);
  process.exit(1);
}

const pool = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT), database: process.env.PGDATABASE,
  user: process.env.PGUSER, password: process.env.PGPASSWORD, ssl: { rejectUnauthorized: false }, max: 3,
});

/* ---------- csv helpers ---------- */

// Party names contain commas ("Hyg,Trad,Madeena"), so every field is escaped.
const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) =>
  // BOM so Excel on Windows reads it as UTF-8 rather than ANSI.
  '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n') + '\r\n';

const iso = (d) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const days = (from, to) => {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
};
const money = (n) => Math.round(n * 100) / 100;

function bucketOf(age, edges) {
  const s = [...edges].sort((x, y) => x - y);
  for (let i = 0; i < s.length; i++) {
    if (age <= s[i]) return i === 0 ? `0-${s[0]}` : `${s[i - 1] + 1}-${s[i]}`;
  }
  return `${s[s.length - 1] + 1}+`;
}

async function main() {
  console.log(`[export] building receivables list as on ${asOf} …`);

  // Aging edges come from meta.app_config so the export matches the dashboard.
  let edges = [30, 60, 90, 180];
  const cfg = await pool.query(
    `select value from meta.app_config where key = 'receivables.aging_edges'`,
  ).catch(() => ({ rows: [] }));
  if (Array.isArray(cfg.rows[0]?.value)) edges = cfg.rows[0].value;
  const bucketNames = [
    `0-${edges[0]}`,
    ...edges.slice(1).map((e, i) => `${edges[i] + 1}-${e}`),
    `${edges[edges.length - 1] + 1}+`,
  ];

  const [{ rows: glRows }, { rows: ledRows }] = await Promise.all([
    pool.query(
      `select dl.ledger_name, g.date, g.signed_amount
       from fact.fact_gl g
       join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
       where dl.is_receivable and g.date <= $1
       order by dl.ledger_name, g.date, g.gl_id`,
      [asOf],
    ),
    pool.query(
      `select ledger_name, display_name, group_name, primary_group, state, gstin
       from dim.dim_ledger where is_receivable`,
    ),
  ]);

  const meta = new Map(ledRows.map((r) => [r.ledger_name, r]));
  const layers = fifoMatchByLedger(glRows);

  /* ---------- detail: one row per FIFO-allocated open item ---------- */

  const detail = layers.map((l) => {
    const m = meta.get(l.ledger_name) ?? {};
    const opened = iso(l.opened_date);
    const age = days(opened, asOf);
    const isAdvance = l.remaining_amount < 0;
    return {
      customer_group: m.group_name ?? '',
      customer: (m.display_name ?? l.ledger_name).trim(),
      primary_group: m.primary_group ?? '',
      state: m.state ?? '',
      gstin: m.gstin ?? '',
      item_date: opened,
      age_days: age,
      // Debit-positive: outstanding receivable is +ve, unadjusted advance -ve.
      amount: money(l.remaining_amount),
      type: isAdvance ? 'Advance (Cr)' : 'Receivable (Dr)',
      aging_bucket: isAdvance ? 'Advance' : bucketOf(age, edges),
      as_on: asOf,
    };
  });

  detail.sort(
    (a, b) =>
      a.customer_group.localeCompare(b.customer_group) ||
      a.customer.localeCompare(b.customer) ||
      a.item_date.localeCompare(b.item_date),
  );

  /* ---------- summary: one row per customer ---------- */

  const byCustomer = new Map();
  for (const d of detail) {
    const key = `${d.customer_group}||${d.customer}`;
    const e = byCustomer.get(key) ?? {
      customer_group: d.customer_group, customer: d.customer, state: d.state, gstin: d.gstin,
      open_receivable: 0, open_advance: 0, open_items: 0,
      oldest_item_date: null, max_age_days: 0,
      ...Object.fromEntries(bucketNames.map((b) => [b, 0])),
    };
    if (d.amount < 0) {
      e.open_advance += d.amount;
    } else {
      e.open_receivable += d.amount;
      e.open_items += 1;
      e[d.aging_bucket] = (e[d.aging_bucket] ?? 0) + d.amount;
      if (!e.oldest_item_date || d.item_date < e.oldest_item_date) e.oldest_item_date = d.item_date;
      e.max_age_days = Math.max(e.max_age_days, d.age_days);
    }
    byCustomer.set(key, e);
  }

  const summary = [...byCustomer.values()].map((e) => {
    const out = {
      customer_group: e.customer_group,
      customer: e.customer,
      state: e.state,
      gstin: e.gstin,
      open_receivable: money(e.open_receivable),
      open_advance: money(e.open_advance),
      net_outstanding: money(e.open_receivable + e.open_advance),
      open_items: e.open_items,
      oldest_item_date: e.oldest_item_date ?? '',
      max_age_days: e.max_age_days || '',
      as_on: asOf,
    };
    for (const b of bucketNames) out[b] = money(e[b] ?? 0);
    return out;
  });

  summary.sort(
    (a, b) => a.customer_group.localeCompare(b.customer_group) || a.customer.localeCompare(b.customer),
  );

  /* ---------- write ---------- */

  fs.mkdirSync(outDir, { recursive: true });

  const detailHeaders = ['customer_group', 'customer', 'primary_group', 'state', 'gstin',
    'item_date', 'age_days', 'amount', 'type', 'aging_bucket', 'as_on'];
  const summaryHeaders = ['customer_group', 'customer', 'state', 'gstin',
    'open_receivable', 'open_advance', 'net_outstanding', 'open_items',
    'oldest_item_date', 'max_age_days', ...bucketNames, 'as_on'];

  const detailPath = path.join(outDir, `receivables_fifo_detail_${asOf}.csv`);
  const summaryPath = path.join(outDir, `receivables_fifo_summary_${asOf}.csv`);
  fs.writeFileSync(detailPath, toCsv(detailHeaders, detail), 'utf8');
  fs.writeFileSync(summaryPath, toCsv(summaryHeaders, summary), 'utf8');

  /* ---------- integrity check against the GL ---------- */

  const dr = money(detail.filter((d) => d.amount > 0).reduce((s, d) => s + d.amount, 0));
  const cr = money(detail.filter((d) => d.amount < 0).reduce((s, d) => s + d.amount, 0));
  const net = money(dr + cr);

  const { rows: truthRows } = await pool.query(
    `select round(sum(g.signed_amount),2) as net
     from fact.fact_gl g join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
     where dl.is_receivable and g.date <= $1`,
    [asOf],
  );
  const truth = Number(truthRows[0].net);
  const ok = Math.abs(net - truth) <= 1;

  console.log(`\n  customers with an open balance : ${summary.filter((s) => s.open_receivable > 0).length}`);
  console.log(`  customer groups                : ${new Set(summary.map((s) => s.customer_group)).size}`);
  console.log(`  FIFO-allocated open items      : ${detail.length}`);
  console.log(`  gross receivable (Dr)          : ${dr.toFixed(2)}`);
  console.log(`  unadjusted advances (Cr)       : ${cr.toFixed(2)}`);
  console.log(`  net outstanding                : ${net.toFixed(2)}`);
  console.log(`  GL position on ${asOf}     : ${truth.toFixed(2)}`);
  console.log(`  ${ok ? '✓ ties to the GL exactly' : '✗ MISMATCH — do not use this export'}`);
  console.log(`\n  ${detailPath}`);
  console.log(`  ${summaryPath}`);

  await pool.end();
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('[export] error:', e.message); process.exit(1); });
