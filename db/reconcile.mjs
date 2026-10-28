// Reconciliation gate: verifies derived models tie back to Tally. Exits 1 on any failure.
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const pool = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT), database: process.env.PGDATABASE,
  user: process.env.PGUSER, password: process.env.PGPASSWORD, ssl: { rejectUnauthorized: false }, max: 3,
});

const TOL = 1; // ₹1 tolerance
let failed = 0;
const num = (v) => (v === null || v === undefined ? NaN : Number(v));

async function check(label, sql, assertFn) {
  try {
    const { rows } = await pool.query(sql);
    const r = rows[0] ?? {};
    const { ok, detail } = await assertFn(r); // await: some checks replay FIFO in-process
    console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
    if (!ok) failed++;
  } catch (e) {
    console.log(`✗ ERROR ${label} — ${e.message}`);
    failed++;
  }
}

// 1. Voucher balance invariant: every voucher balances, so all VOUCHER postings net
//    to 0. Scoped to vouchers — injected opening rows are Tally carried-forward
//    figures and may carry a small "difference in opening balances" (checked in #2b).
await check('fact_gl balances (Σ raw_amount = 0, vouchers)',
  `select round(sum(raw_amount),2) s, count(*) n from fact.fact_gl where voucher_type <> 'Opening Balance'`,
  (r) => ({ ok: Math.abs(num(r.s)) <= TOL, detail: `Σ=${r.s} over ${r.n} postings` }));

// 2. Debit total equals credit total (vouchers).
await check('fact_gl debits = credits (vouchers)',
  `select round(sum(debit_amount),2) d, round(sum(credit_amount),2) c from fact.fact_gl where voucher_type <> 'Opening Balance'`,
  (r) => ({ ok: Math.abs(num(r.d) - num(r.c)) <= TOL, detail: `Dr=${r.d} Cr=${r.c}` }));

// 2b. Opening balances tie to Tally's own opening figures (a small difference in
//    opening balances is normal in Tally and is surfaced here rather than hidden).
await check('opening rows == Σ ledger opening_balance',
  `select round(coalesce((select sum(raw_amount) from fact.fact_gl where voucher_type='Opening Balance'),0),2) inj,
          round(coalesce((select sum(opening_balance) from mst_ledger),0),2) led`,
  (r) => ({ ok: Math.abs(num(r.inj) - num(r.led)) <= TOL, detail: `injected=${r.inj} ledger=${r.led}` }));

// 3. Receivable ledger closing (Tally) == derived movement INCLUDING injected openings.
//    Tally closing is credit-positive (neg = Dr); signed_amount is debit-positive → equal and opposite.
//    fact_gl now carries opening rows, so this ties for companies that carry openings (Den) too.
await check('receivables: fact_gl movement == ledger closing',
  `select
     round(sum(gl.signed),2) as derived_dr,
     round(-sum(dl.closing_balance),2) as ledger_dr
   from dim.dim_ledger dl
   left join (select ledger_name, sum(signed_amount) signed from fact.fact_gl group by ledger_name) gl
     on gl.ledger_name = dl.ledger_name
   where dl.is_receivable`,
  (r) => ({ ok: Math.abs(num(r.derived_dr) - num(r.ledger_dr)) <= TOL,
            detail: `derived Dr=${r.derived_dr} vs ledger Dr=${r.ledger_dr}` }));

// 4. Classification sanity.
await check('dim_ledger classification populated',
  `select
     count(*) filter (where is_receivable) recv,
     count(*) filter (where is_payable)    pay,
     count(*) filter (where is_bank)        bank,
     count(*) total
   from dim.dim_ledger`,
  (r) => ({ ok: num(r.recv) > 0 && num(r.total) > 0,
            detail: `recv=${r.recv} pay=${r.pay} bank=${r.bank} total=${r.total}` }));

// 5. Row-count sanity vs raw: fact_gl's non-opening rows must equal the raw
//    ACCOUNTING lines (order/non-accounting vouchers are excluded from both).
await check('fact_gl accounting rows == trn_accounting accounting lines',
  `select
     (select count(*) from fact.fact_gl where voucher_type <> 'Opening Balance') f,
     (select count(*) from trn_accounting a join trn_voucher v on v.guid=a.guid where v.is_accounting_voucher=1) a`,
  (r) => ({ ok: num(r.f) === num(r.a), detail: `fact=${r.f} raw_accounting=${r.a}` }));

// 6. Party receivables mart ties to receivable ledger closing.
await check('mart_party_receivables net == receivable ledger closing',
  `select round(sum(receivable_dr),2) mart,
          (select round(-sum(closing_balance),2) from dim.dim_ledger where is_receivable) ledger
   from mart.mart_party_receivables`,
  (r) => ({ ok: Math.abs(num(r.mart) - num(r.ledger)) <= TOL, detail: `mart=${r.mart} ledger=${r.ledger}` }));

// 7. FIFO aging ties to ledger closing, LEDGER BY LEDGER (not just in aggregate).
await check('FIFO aging (per ledger) == ledger closing, worst mismatch',
  `select count(*) mismatches, max(abs(diff)) worst from (
     select p.ledger_name, round(p.receivable_dr - coalesce(a.net,0), 2) as diff
     from mart.mart_party_receivables p
     left join (select ledger_name, sum(remaining_amount) net from mart.mart_receivables_aging group by ledger_name) a
       on a.ledger_name = p.ledger_name
   ) d where abs(diff) > ${TOL}`,
  (r) => ({ ok: num(r.mismatches) === 0, detail: `mismatches=${r.mismatches ?? 0} worst_diff=${r.worst ?? 0}` }));

// 8. Total open receivable layers == net receivable (sanity on the aggregate too).
await check('FIFO total open receivable == mart_party_receivables total',
  `select
     round((select sum(remaining_amount) from mart.mart_receivables_aging where remaining_amount>0),2) fifo_dr,
     round((select sum(receivable_dr) from mart.mart_party_receivables where balance_type='receivable'),2) mart_dr`,
  (r) => ({ ok: Math.abs(num(r.fifo_dr) - num(r.mart_dr)) <= TOL, detail: `fifo=${r.fifo_dr} mart=${r.mart_dr}` }));

// 9. The dashboard's "aging as of <past date>" recomputes FIFO in-process via the
//    shared core. Replaying it at historical dates must reproduce the GL position
//    exactly, or time-travel aging silently lies.
{
  const { fifoMatchByLedger } = await import('./fifo-core.mjs');
  for (const dt of ['2026-03-31', '2025-12-31', '2024-06-30']) {
    await check(`as-of recompute ties to GL @ ${dt}`,
      `select round(coalesce(sum(g.signed_amount),0),2) as truth from fact.fact_gl g
       join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
       where dl.is_receivable and g.date <= '${dt}'`,
      async (r) => {
        const { rows } = await pool.query(
          `select dl.ledger_name, g.date, g.signed_amount
           from fact.fact_gl g join dim.dim_ledger dl on dl.ledger_name = g.ledger_name
           where dl.is_receivable and g.date <= $1
           order by dl.ledger_name, g.date, g.gl_id`, [dt]);
        const net = fifoMatchByLedger(rows).reduce((s, l) => s + l.remaining_amount, 0);
        const truth = num(r.truth);
        return { ok: Math.abs(net - truth) <= TOL, detail: `fifo=${net.toFixed(2)} gl=${truth.toFixed(2)}` };
      });
  }
}

// 12. Bill-wise mart ties to receivable ledger closing, per ledger (the toggle's
//     alternate basis must reconcile just like FIFO does).
await check('bill-wise mart (per ledger) == ledger closing, worst mismatch',
  `select count(*) mismatches, coalesce(max(abs(diff)),0) worst from (
     select dl.ledger_name, round(-dl.closing_balance - coalesce(b.net,0), 2) as diff
     from dim.dim_ledger dl
     left join (select ledger_name, sum(remaining_amount) net from mart.mart_receivables_bills group by ledger_name) b
       on b.ledger_name = dl.ledger_name
     where dl.is_receivable
   ) d where abs(diff) > ${TOL}`,
  (r) => ({ ok: num(r.mismatches) === 0, detail: `mismatches=${r.mismatches ?? 0} worst_diff=${r.worst ?? 0}` }));

// 13. Inventory mart faithfully reflects Tally's item valuation (sign flip applied).
//     Den has no closing-stock ledger to cross-tie to, so this confirms the mart ==
//     Tally's own computed closing value, and surfaces any oversold (negative qty) items.
await check('inventory mart value == Tally item valuation',
  `select round(coalesce((select sum(stock_value) from mart.mart_inventory_items),0),2) mart,
          round(coalesce((select -sum(closing_value) from mst_stock_item),0),2) tally,
          (select count(*) from mart.mart_inventory_items where is_negative_stock) oversold`,
  (r) => ({ ok: Math.abs(num(r.mart) - num(r.tally)) <= TOL,
            detail: `mart=${r.mart} tally=${r.tally} oversold_items=${r.oversold}` }));

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : failed + ' CHECK(S) FAILED'}`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
