import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { buildQuery } from '@/lib/analytics/receivablesData';
import {
  PageHeader, Card, StatTile, Table, Th, Td, Tr, Badge, EmptyState, Money, formatCompact,
} from '@/components/kit';

type SP = Record<string, string | string[] | undefined>;

const inputCls =
  'rounded-md border border-neutral-300 bg-card px-2.5 py-1.5 text-sm text-neutral-900 ' +
  'focus:border-primary focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';

export default async function PartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<SP>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const ledgerName = decodeURIComponent(name);

  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const txFrom = one('txFrom');
  const txTo = one('txTo');

  const [partyRows, layerRows, txnRows] = await Promise.all([
    query<{
      party: string; group_name: string; state: string | null; receivable_dr: string;
      balance_type: string; last_activity_date: string | null; days_since_activity: number | null;
    }>(
      `select party, group_name, state, receivable_dr, balance_type,
              last_activity_date::text as last_activity_date, days_since_activity
       from mart.mart_party_receivables where ledger_name = $1`,
      [ledgerName],
    ),
    query<{ opened_date: string; age_days: number; remaining_amount: string }>(
      `select opened_date::text as opened_date, (as_of_date - opened_date) as age_days, remaining_amount
       from fact.fact_receivables_fifo where ledger_name = $1 order by opened_date`,
      [ledgerName],
    ),
    query<{ date: string; voucher_type: string; voucher_number: string; debit_amount: string; credit_amount: string; narration: string | null }>(
      `select date::text as date, voucher_type, voucher_number, debit_amount, credit_amount, narration
       from fact.fact_gl
       where ledger_name = $1
         and ($2::date is null or date >= $2::date)
         and ($3::date is null or date <= $3::date)
       order by date, gl_id`,
      [ledgerName, txFrom ?? null, txTo ?? null],
    ),
  ]);

  const p = partyRows[0];
  if (!p) notFound();

  const balance = Number(p.receivable_dr);
  const layers = layerRows.map((l) => ({ ...l, remaining_amount: Number(l.remaining_amount) }));

  // Running balance makes the ledger readable as a story rather than a list.
  let running = 0;
  const txns = txnRows.map((t) => {
    const dr = Number(t.debit_amount);
    const cr = Number(t.credit_amount);
    running += dr - cr;
    return { ...t, dr, cr, running };
  });

  const backQs = buildQuery(sp, { txFrom: undefined, txTo: undefined });

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/receivables${backQs}`}
        className="text-xs text-neutral-400 transition-colors hover:text-primary dark:hover:text-primary"
      >
        ← Back to Receivables
      </Link>

      <div className="mt-2">
        <PageHeader
          eyebrow={p.group_name}
          title={p.party}
          description={p.state ?? undefined}
          actions={
            <Badge tone={p.balance_type === 'receivable' ? 'info' : p.balance_type === 'advance_cr' ? 'warn' : 'neutral'}>
              {p.balance_type}
            </Badge>
          }
        />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile label="Balance" value={formatCompact(balance)} sub={p.balance_type} />
        <StatTile
          label="Last activity"
          value={p.last_activity_date ?? '—'}
          sub={p.days_since_activity != null ? `${p.days_since_activity} days ago` : undefined}
          tone={(p.days_since_activity ?? 0) > 180 ? 'warn' : 'default'}
        />
        <StatTile label="Open FIFO layers" value={String(layers.length)} />
      </div>

      <div className="mb-5">
        <Card title="Open layers (FIFO)" padded={false}>
          <div className="px-5 pb-5 pt-1">
            {layers.length === 0 ? (
              <EmptyState message="Nothing open — this ledger is fully settled." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Opened</Th>
                    <Th align="right">Age</Th>
                    <Th align="right">Open amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {layers.map((l, i) => (
                    <Tr key={i}>
                      <Td>{l.opened_date}</Td>
                      <Td align="right" muted className="tnum">{l.age_days}d</Td>
                      <Td align="right"><Money value={l.remaining_amount} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <Card
        title={`Transaction history (${txns.length})`}
        padded={false}
        actions={
          <form method="GET" className="flex flex-wrap items-center gap-2">
            {Object.entries(sp).map(([k, v]) =>
              k === 'txFrom' || k === 'txTo' ? null : (
                <input key={k} type="hidden" name={k} value={Array.isArray(v) ? v[0] : (v ?? '')} />
              ),
            )}
            <input className={inputCls} type="date" name="txFrom" defaultValue={txFrom ?? ''} aria-label="From date" />
            <span className="text-xs text-neutral-400">→</span>
            <input className={inputCls} type="date" name="txTo" defaultValue={txTo ?? ''} aria-label="To date" />
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary"
            >
              Filter
            </button>
            {(txFrom || txTo) && (
              <Link
                href={`/receivables/party/${encodeURIComponent(ledgerName)}${backQs}`}
                className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                Clear
              </Link>
            )}
          </form>
        }
      >
        <div className="px-5 pb-5 pt-1">
          {txns.length === 0 ? (
            <EmptyState message="No transactions in this date range." hint="Clear the date filter to see the full history." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Voucher</Th>
                  <Th align="right">Debit</Th>
                  <Th align="right">Credit</Th>
                  <Th align="right">Running</Th>
                  <Th>Narration</Th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t, i) => (
                  <Tr key={i}>
                    <Td className="whitespace-nowrap">{t.date}</Td>
                    <Td muted className="whitespace-nowrap text-xs">{t.voucher_type} {t.voucher_number}</Td>
                    <Td align="right">{t.dr ? <Money value={t.dr} /> : ''}</Td>
                    <Td align="right">{t.cr ? <Money value={t.cr} /> : ''}</Td>
                    <Td align="right" className="tnum font-medium">{formatCompact(t.running)}</Td>
                    <Td muted className="text-xs">{t.narration ?? ''}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
