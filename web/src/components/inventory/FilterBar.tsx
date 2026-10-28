import Link from 'next/link';
import type { InventoryFilters } from '@/lib/analytics/inventoryData';
import { buildQuery } from '@/lib/analytics/receivablesData'; // generic sp→querystring helper

const inputCls =
  'w-full rounded-md border border-neutral-300 bg-card px-2.5 py-1.5 text-sm text-neutral-900 ' +
  'placeholder:text-neutral-400 focus:border-primary focus:outline-none ' +
  'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500';
const labelCls = 'block text-[11px] font-medium text-neutral-500 dark:text-neutral-400';

/**
 * Inventory filters — plain GET <form> (no client JS), shareable URLs, back-button
 * works. The date range applies to the Movement report; q/group/min-value/in-stock
 * apply everywhere.
 */
export default function InventoryFilterBar({
  tab,
  filters,
  groups,
  sp,
  resultCount,
  showDates,
}: {
  tab: string;
  filters: InventoryFilters;
  groups: string[];
  sp: Record<string, string | string[] | undefined>;
  resultCount?: number;
  showDates?: boolean;
}) {
  const active: { key: string; label: string }[] = [];
  if (filters.q) active.push({ key: 'q', label: `“${filters.q}”` });
  if (filters.group) active.push({ key: 'group', label: filters.group });
  if (filters.minValue) active.push({ key: 'minValue', label: `≥ ₹${filters.minValue.toLocaleString('en-IN')}` });
  if (filters.from) active.push({ key: 'from', label: `From ${filters.from}` });
  if (filters.to) active.push({ key: 'to', label: `To ${filters.to}` });
  if (filters.inStockOnly) active.push({ key: 'inStock', label: 'In stock only' });

  return (
    <div className="mb-5 rounded-xl border border-neutral-200 bg-card shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <form method="GET" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input type="hidden" name="tab" value={tab} />

        <div className={showDates ? '' : 'lg:col-span-2'}>
          <label className={labelCls} htmlFor="f-q">Item contains</label>
          <input id="f-q" className={`mt-1 ${inputCls}`} type="search" name="q" placeholder="Search items…" defaultValue={filters.q ?? ''} />
        </div>
        <div className={showDates ? '' : 'lg:col-span-2'}>
          <label className={labelCls} htmlFor="f-group">Group</label>
          <select id="f-group" className={`mt-1 ${inputCls}`} name="group" defaultValue={filters.group ?? ''}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="f-minValue">Min value (₹)</label>
          <input id="f-minValue" className={`mt-1 ${inputCls}`} type="number" name="minValue" min="0" placeholder="0" defaultValue={filters.minValue ?? ''} />
        </div>

        {showDates && (
          <>
            <div>
              <label className={labelCls} htmlFor="f-from">Movement from</label>
              <input id="f-from" className={`mt-1 ${inputCls}`} type="date" name="from" defaultValue={filters.from ?? ''} />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-to">Movement to</label>
              <input id="f-to" className={`mt-1 ${inputCls}`} type="date" name="to" defaultValue={filters.to ?? ''} />
            </div>
          </>
        )}

        <label className="flex items-end gap-2 pb-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" name="inStock" value="1" defaultChecked={filters.inStockOnly} className="h-4 w-4 rounded border-neutral-300" />
          In stock only
        </label>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary"
          >
            Apply filters
          </button>
          {active.length > 0 && (
            <Link
              href={`/inventory?tab=${tab}`}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              Clear all
            </Link>
          )}
          {resultCount != null && (
            <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
              {resultCount.toLocaleString('en-IN')} {resultCount === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
      </form>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
          {active.map((a) => (
            <Link
              key={a.key}
              href={`/inventory${buildQuery(sp, { [a.key]: undefined })}`}
              className="group inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/20"
              title="Remove this filter"
            >
              {a.label}
              <span aria-hidden="true" className="opacity-50 group-hover:opacity-100">✕</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
