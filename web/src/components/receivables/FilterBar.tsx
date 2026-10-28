import Link from 'next/link';
import type { ReceivablesFilters } from '@/lib/analytics/receivablesData';
import { buildQuery } from '@/lib/analytics/receivablesData';

const inputCls =
  'w-full rounded-md border border-neutral-300 bg-card px-2.5 py-1.5 text-sm text-neutral-900 ' +
  'placeholder:text-neutral-400 focus:border-primary focus:outline-none ' +
  'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500';

const labelCls = 'block text-[11px] font-medium text-neutral-500 dark:text-neutral-400';

/**
 * Filters are a plain GET <form>: submitting navigates to the same page with new
 * query params, which the server component reads. No client JS, shareable URLs,
 * and the back button works.
 */
export default function FilterBar({
  tab,
  filters,
  groups,
  snapshotDate,
  sp,
  resultCount,
}: {
  tab: string;
  filters: ReceivablesFilters;
  groups: string[];
  snapshotDate: string | null;
  sp: Record<string, string | string[] | undefined>;
  resultCount?: number;
}) {
  const active: { key: string; label: string }[] = [];
  if (filters.asOf && filters.asOf !== snapshotDate) active.push({ key: 'asOf', label: `As of ${filters.asOf}` });
  if (filters.from) active.push({ key: 'from', label: `From ${filters.from}` });
  if (filters.to) active.push({ key: 'to', label: `To ${filters.to}` });
  if (filters.q) active.push({ key: 'q', label: `“${filters.q}”` });
  if (filters.group) active.push({ key: 'group', label: filters.group });
  if (filters.minAmt) active.push({ key: 'minAmt', label: `≥ ₹${filters.minAmt.toLocaleString('en-IN')}` });
  if (filters.bucket) active.push({ key: 'bucket', label: `Bucket ${filters.bucket}` });

  const recomputing = Boolean(filters.asOf && snapshotDate && filters.asOf !== snapshotDate);

  return (
    <div className="mb-5 rounded-xl border border-neutral-200 bg-card shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <form method="GET" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input type="hidden" name="tab" value={tab} />

        <div>
          <label className={labelCls} htmlFor="f-asOf">Aging as of</label>
          <input id="f-asOf" className={`mt-1 ${inputCls}`} type="date" name="asOf" defaultValue={filters.asOf ?? snapshotDate ?? ''} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-from">Opened from</label>
          <input id="f-from" className={`mt-1 ${inputCls}`} type="date" name="from" defaultValue={filters.from ?? ''} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-to">Opened to</label>
          <input id="f-to" className={`mt-1 ${inputCls}`} type="date" name="to" defaultValue={filters.to ?? ''} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-q">Party contains</label>
          <input id="f-q" className={`mt-1 ${inputCls}`} type="search" name="q" placeholder="Search…" defaultValue={filters.q ?? ''} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-group">Group</label>
          <select id="f-group" className={`mt-1 ${inputCls}`} name="group" defaultValue={filters.group ?? ''}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="f-minAmt">Min amount (₹)</label>
          <input id="f-minAmt" className={`mt-1 ${inputCls}`} type="number" name="minAmt" min="0" placeholder="0" defaultValue={filters.minAmt ?? ''} />
        </div>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary"
          >
            Apply filters
          </button>
          {active.length > 0 && (
            <Link
              href={`/receivables?tab=${tab}`}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              Clear all
            </Link>
          )}
          {resultCount != null && (
            <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
              {resultCount.toLocaleString('en-IN')} matching {resultCount === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
      </form>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
          {active.map((a) => (
            <Link
              key={a.key}
              href={`/receivables${buildQuery(sp, { [a.key]: undefined })}`}
              className="group inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/20"
              title="Remove this filter"
            >
              {a.label}
              <span aria-hidden="true" className="opacity-50 group-hover:opacity-100">✕</span>
            </Link>
          ))}
          {recomputing && (
            <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400">
              Aging recomputed from the ledger for this date
            </span>
          )}
        </div>
      )}
    </div>
  );
}
