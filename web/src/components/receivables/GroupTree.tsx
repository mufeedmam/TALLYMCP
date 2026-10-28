import Link from 'next/link';
import { Badge, Chevron, EmptyState, MiniBar, Money, formatCompact } from '@/components/kit';

export interface GroupNode {
  group_name: string;
  total: number;
  overdue: number;
  parties: {
    ledger_name: string;
    party: string;
    total: number;
    oldest_age: number;
    layers: { opened_date: string; age_days: number; remaining_amount: number }[];
  }[];
}

/**
 * Group → party → open-layer drill-down.
 *
 * Rollup levels expand inline via <details> (no JS, and this data is already
 * loaded). The transaction *history* leaf stays a link to the party page rather
 * than inlining it: some ledgers carry 1,000+ postings, and eagerly rendering
 * them for every collapsed row would bloat every page load to no benefit.
 */
export default function GroupTree({ groups, query }: { groups: GroupNode[]; query: string }) {
  if (groups.length === 0) {
    return <EmptyState message="No receivables match these filters." hint="Try clearing a filter above." />;
  }
  const max = Math.max(...groups.map((g) => g.total), 1);

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {groups.map((g) => (
        <details key={g.group_name} className="group">
          <summary className="flex cursor-pointer items-center gap-3 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
            <Chevron />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  {g.group_name}
                </span>
                <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                  {g.parties.length} {g.parties.length === 1 ? 'party' : 'parties'}
                </span>
              </div>
              <div className="mt-1.5 max-w-xs">
                <MiniBar value={g.total} max={max} />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tnum text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {formatCompact(g.total)}
              </div>
              {g.overdue > 0 && (
                <div className="tnum text-xs text-neutral-400 dark:text-neutral-500">
                  {formatCompact(g.overdue)} overdue
                </div>
              )}
            </div>
          </summary>

          {/* Nested tables get their own scroll container — the page body must
              never scroll horizontally on narrow screens. */}
          <div className="overflow-x-auto pb-3 pl-3 sm:pl-6">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                  <th className="border-b border-neutral-200 pb-1.5 font-medium dark:border-neutral-800">Party</th>
                  <th className="border-b border-neutral-200 pb-1.5 text-right font-medium dark:border-neutral-800">Open</th>
                  <th className="border-b border-neutral-200 pb-1.5 text-right font-medium dark:border-neutral-800">Oldest</th>
                  <th className="border-b border-neutral-200 pb-1.5 text-right font-medium dark:border-neutral-800">Items</th>
                </tr>
              </thead>
              <tbody>
                {g.parties.map((p) => (
                  <PartyRow key={p.ledger_name} party={p} query={query} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

function PartyRow({ party, query }: { party: GroupNode['parties'][number]; query: string }) {
  return (
    <>
      <tr className="align-top">
        <td className="border-b border-neutral-100 py-2 dark:border-neutral-800/60" colSpan={4}>
          <details className="group/p">
            <summary className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
              <Chevron />
              <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{party.party}</span>
              <span className="tnum shrink-0 text-neutral-800 dark:text-neutral-200">
                {formatCompact(party.total)}
              </span>
              <span className="tnum w-16 shrink-0 text-right text-xs text-neutral-400 dark:text-neutral-500">
                {party.oldest_age}d
              </span>
              <span className="tnum w-10 shrink-0 text-right text-xs text-neutral-400 dark:text-neutral-500">
                {party.layers.length}
              </span>
            </summary>

            <div className="mt-1 mb-2 ml-2 overflow-x-auto rounded-lg bg-neutral-50 p-3 sm:ml-5 dark:bg-neutral-800/40">
              <table className="w-full min-w-[18rem] text-xs">
                <thead>
                  <tr className="text-left text-neutral-500 dark:text-neutral-400">
                    <th className="pb-1 font-medium">Opened</th>
                    <th className="pb-1 text-right font-medium">Age</th>
                    <th className="pb-1 text-right font-medium">Open amount</th>
                  </tr>
                </thead>
                <tbody>
                  {party.layers.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1 text-neutral-600 dark:text-neutral-300">{l.opened_date}</td>
                      <td className="tnum py-1 text-right text-neutral-500 dark:text-neutral-400">{l.age_days}d</td>
                      <td className="py-1 text-right text-neutral-800 dark:text-neutral-200">
                        <Money value={l.remaining_amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Link
                href={`/receivables/party/${encodeURIComponent(party.ledger_name)}${query}`}
                className="mt-2 inline-block text-xs font-medium text-primary hover:underline dark:text-primary"
              >
                View full transaction history →
              </Link>
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

export { Badge };
