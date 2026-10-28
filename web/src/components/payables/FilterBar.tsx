import Link from 'next/link';
import type { PayableFilters } from '@/lib/analytics/payablesData';
import { buildQuery } from '@/lib/analytics/receivablesData';

const inputCls =
  'mt-1 w-full rounded-md border bg-card px-2.5 py-1.5 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:border-primary focus:outline-none';
const labelCls = 'block text-[11px] font-medium text-muted-foreground';

export default function PayablesFilterBar({
  tab,
  filters,
  groups,
  sp,
  resultCount,
}: {
  tab: string;
  filters: PayableFilters;
  groups: string[];
  sp: Record<string, string | string[] | undefined>;
  resultCount?: number;
}) {
  const active: { key: string; label: string }[] = [];
  if (filters.from) active.push({ key: 'from', label: `From ${filters.from}` });
  if (filters.to) active.push({ key: 'to', label: `To ${filters.to}` });
  if (filters.q) active.push({ key: 'q', label: `“${filters.q}”` });
  if (filters.group) active.push({ key: 'group', label: filters.group });
  if (filters.minAmt) active.push({ key: 'minAmt', label: `≥ ₹${filters.minAmt.toLocaleString('en-IN')}` });
  if (filters.bucket) active.push({ key: 'bucket', label: `Bucket ${filters.bucket}` });

  return (
    <div className="mb-5 rounded-xl border bg-card shadow-sm">
      <form method="GET" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <input type="hidden" name="tab" value={tab} />
        <div className="lg:col-span-2">
          <label className={labelCls} htmlFor="p-q">Supplier contains</label>
          <input id="p-q" className={inputCls} type="search" name="q" placeholder="Search…" defaultValue={filters.q ?? ''} />
        </div>
        <div>
          <label className={labelCls} htmlFor="p-group">Group</label>
          <select id="p-group" className={inputCls} name="group" defaultValue={filters.group ?? ''}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="p-from">Opened from</label>
          <input id="p-from" className={inputCls} type="date" name="from" defaultValue={filters.from ?? ''} />
        </div>
        <div>
          <label className={labelCls} htmlFor="p-minAmt">Min owed (₹)</label>
          <input id="p-minAmt" className={inputCls} type="number" name="minAmt" min="0" placeholder="0" defaultValue={filters.minAmt ?? ''} />
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Apply filters
          </button>
          {active.length > 0 && (
            <Link href={`/payables?tab=${tab}`} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Clear all
            </Link>
          )}
          {resultCount != null && (
            <span className="ml-auto text-xs text-muted-foreground">{resultCount.toLocaleString('en-IN')} open {resultCount === 1 ? 'item' : 'items'}</span>
          )}
        </div>
      </form>
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
          {active.map((a) => (
            <Link key={a.key} href={`/payables${buildQuery(sp, { [a.key]: undefined })}`}
              className="group inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              title="Remove this filter">
              {a.label}
              <span aria-hidden="true" className="opacity-50 group-hover:opacity-100">✕</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
