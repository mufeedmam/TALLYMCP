// One-off inspection of the loaded raw data to lock sign conventions before writing transforms.
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const pool = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT), database: process.env.PGDATABASE,
  user: process.env.PGUSER, password: process.env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});

const show = async (label, sql, params) => {
  console.log('\n===== ' + label + ' =====');
  try { const r = await pool.query(sql, params); console.table(r.rows); }
  catch (e) { console.log('ERR:', e.message); }
};

// A. Debtor/creditor groups + their primary group
await show('A. debtor/creditor groups',
  `select name, parent, primary_group, is_revenue, is_deemedpositive, affects_gross_profit
   from mst_group where name in ('Sundry Debtors','Sundry Creditors') order by name`);

// B. Ledger columns actually present
await show('B. mst_ledger columns',
  `select column_name, data_type from information_schema.columns
   where table_schema='public' and table_name='mst_ledger' order by ordinal_position`);

// C. Count ledgers directly under Sundry Debtors, sample a few with balances
await show('C. sample Sundry Debtors ledgers',
  `select name, parent, opening_balance, closing_balance, bill_credit_period, mailing_state, gstn
   from mst_ledger where parent='Sundry Debtors' order by name limit 6`);
await show('C2. debtor ledger count + opening/closing sums',
  `select count(*) n, round(sum(opening_balance),2) sum_open, round(sum(closing_balance),2) sum_close
   from mst_ledger where parent='Sundry Debtors'`);

// D. A sales invoice: accounting lines + signs (debtor should be one side, sales/GST the other)
await show('D. one sales voucher accounting lines',
  `select v.date, v.voucher_type, v.voucher_number, v.party_name, a.ledger, a.amount
   from trn_voucher v join trn_accounting a on a.guid=v.guid
   where v.guid = (select guid from trn_voucher where lower(voucher_type) like '%sales%' order by date desc limit 1)
   order by a.amount`);

// E. trn_bill structure + billtype values + sign, for a debtor with bills
await show('E. trn_bill billtype distribution',
  `select billtype, count(*) n, round(sum(amount),2) sum_amt, round(min(amount),2) min_amt, round(max(amount),2) max_amt
   from trn_bill group by billtype order by n desc`);
await show('E2. sample trn_bill rows',
  `select b.ledger, b.name bill_ref, b.amount, b.billtype, b.bill_credit_period, v.date, v.voucher_type
   from trn_bill b join trn_voucher v on v.guid=b.guid order by v.date desc limit 8`);

// F. Net a few bill refs to see if netting yields open receivables
await show('F. netted open bills (top 8 by abs outstanding)',
  `select b.ledger, b.name bill_ref, round(sum(b.amount),2) outstanding, count(*) allocs
   from trn_bill b group by b.ledger, b.name having round(sum(b.amount),2) <> 0
   order by abs(sum(b.amount)) desc limit 8`);
await show('F2. overall netted-bill totals',
  `select count(*) open_bills, count(distinct ledger) parties, round(sum(t.outstanding),2) total
   from (select ledger, name, sum(amount) outstanding from trn_bill group by ledger, name
         having round(sum(amount),2) <> 0) t`);

await pool.end();
