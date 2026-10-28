// THE canonical FIFO matching algorithm. Plain ESM JS (no TS syntax) so both the
// Node pipeline (db/compute_fifo.mjs) and the Next.js app (web/src/lib/analytics/fifo.ts)
// import THIS file — one implementation, so a request-time recompute can never
// drift from the reconciled precomputed table.
//
// See DICTIONARY.md for why receivables here are aged by FIFO transaction matching
// rather than by bill due dates.

/**
 * Match a ledger's postings oldest-first, returning the layers still open.
 *
 * @param {{date: any, signed_amount: any}[]} rows  postings ordered by (date, gl_id),
 *        `signed_amount` debit-positive
 * @returns {{date: any, remaining: number}[]} open layers, oldest first
 */
export function fifoMatch(rows) {
  const queue = [];
  for (const r of rows) {
    let amt = Number(r.signed_amount);
    if (amt === 0) continue;
    // An opposite-signed posting consumes the oldest open layers first.
    while (amt !== 0 && queue.length && Math.sign(queue[0].remaining) !== Math.sign(amt)) {
      const front = queue[0];
      if (Math.abs(front.remaining) <= Math.abs(amt)) {
        amt += front.remaining; // opposite signs: shrinks |amt|
        queue.shift();
      } else {
        front.remaining += amt;
        amt = 0;
      }
    }
    if (amt !== 0) queue.push({ date: r.date, remaining: amt });
  }
  return queue;
}

/** Layers below this absolute value are rounding dust, not real balances. */
export const DUST = 0.005;

/**
 * Group postings by ledger and FIFO-match each, dropping dust.
 * @param {{ledger_name: string, date: any, signed_amount: any}[]} rows
 * @returns {{ledger_name: string, opened_date: any, remaining_amount: number}[]}
 */
export function fifoMatchByLedger(rows) {
  const byLedger = new Map();
  for (const r of rows) {
    if (!byLedger.has(r.ledger_name)) byLedger.set(r.ledger_name, []);
    byLedger.get(r.ledger_name).push(r);
  }
  const out = [];
  for (const [ledgerName, txns] of byLedger) {
    for (const l of fifoMatch(txns)) {
      if (Math.abs(l.remaining) < DUST) continue;
      out.push({
        ledger_name: ledgerName,
        opened_date: l.date,
        remaining_amount: Math.round(l.remaining * 100) / 100,
      });
    }
  }
  return out;
}
