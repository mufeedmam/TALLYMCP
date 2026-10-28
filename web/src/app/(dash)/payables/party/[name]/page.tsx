import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { buildQuery } from '@/lib/analytics/receivablesData';
import { PageHeader, Card, StatTile, Table, Th, Td, Tr, EmptyState, Note, Money, formatCompact } from '@/components/kit';

type SP = Record<string, string | string[] | undefined>;

export default async function SupplierDetailPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SP> }) {
  const { name } = await params;
  const sp = await searchParams;
  const ledgerName = decodeURIComponent(name);

  const [ledRows, txnRows] = await Promise.all([
    query<{ party: string; group_name: string; state: string | null; closing_balance: string }>(
      `select display_name as party, group_name, state, closing_balance
       from dim.dim_ledger where ledger_name = $1 and is_payable`,
      [ledgerName],
    ),
    query<{ date: string; voucher_type: string; voucher_number: string; debit_amount: string; credit_amount: string; narration: string | null }>(
      `select date::text as date, voucher_type, voucher_number, debit_amount, credit_amount, narration
       from fact.fact_gl where ledger_name = $1 order by date, gl_id`,
      [ledgerName],
    ),
  ]);

  const led = ledRows[0];
  if (!led) notFound();

  const owed = -Number(led.closing_balance); // credit-positive = we owe
  // Running balance is the credit (owed) position: credits increase it, debits (payments) reduce it.
  let running = 0;
  const txns = txnRows.map((t) => {
    const dr = Number(t.debit_amount);
    const cr = Number(t.credit_amount);
    running += cr - dr;
    return { ...t, dr, cr, running };
  });
  const backQs = buildQuery(sp, {});

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/payables${backQs}`} className="text-xs text-muted-foreground transition-colors hover:text-primary">← Back to Payables</Link>
      <div className="mt-2">
        <PageHeader eyebrow={led.group_name} title={led.party} description={led.state ?? undefined} />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile label="Owed to supplier" value={formatCompact(owed)} tone={owed > 0 ? 'warn' : 'default'} />
        <StatTile label="Postings" value={String(txns.length)} />
        <StatTile label="Last activity" value={txns.at(-1)?.date ?? '—'} />
      </div>

      <Card title={`Transaction history (${txns.length})`} padded={false}>
        <div className="px-5 pb-5 pt-1">
          {txns.length === 0 ? <EmptyState message="No postings for this supplier." /> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Voucher</Th><Th align="right">Debit</Th><Th align="right">Credit</Th><Th align="right">Owed</Th><Th>Narration</Th></tr></thead>
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
      <Note>The running &quot;Owed&quot; column is the credit (payable) position: purchases increase it, payments reduce it. Ends at the supplier&apos;s Tally closing balance.</Note>
    </div>
  );
}
