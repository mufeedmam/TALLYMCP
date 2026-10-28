import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chevron, EmptyState, MiniBar } from '@/components/kit';

export interface GroupReportGroup {
  group: string;
  itemCount: number;
  summary: ReactNode;          // shown on the collapsed group row (right side)
  bar?: { value: number; max: number };
  items: { item: string; cells: ReactNode[] }[];
}

/**
 * Group → Item expandable report. Groups expand inline via <details> (no JS); each
 * item row links to that item's drill-down page. The caller pre-formats every cell,
 * so this component stays layout-only and each report controls its own columns.
 */
export default function GroupReport({
  headers,
  groups,
  firstColLabel = 'Item',
  itemHref = (item) => `/inventory/item/${encodeURIComponent(item)}`,
}: {
  headers: { label: string; align?: 'right' }[];
  groups: GroupReportGroup[];
  /** Header for the first (name) column. */
  firstColLabel?: string;
  /** Link target for a row's name. Defaults to the inventory item page. */
  itemHref?: (item: string) => string;
}) {
  if (groups.length === 0) {
    return <EmptyState message="Nothing matches these filters." hint="Try clearing a filter above." />;
  }
  const maxBar = Math.max(...groups.map((g) => g.bar?.value ?? 0), 1);

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {groups.map((g) => (
        <details key={g.group} className="group">
          <summary className="flex cursor-pointer items-center gap-3 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
            <Chevron />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{g.group}</span>
                <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                  {g.itemCount} {g.itemCount === 1 ? 'item' : 'items'}
                </span>
              </div>
              {g.bar && (
                <div className="mt-1.5 max-w-xs">
                  <MiniBar value={g.bar.value} max={maxBar} />
                </div>
              )}
            </div>
            <div className="shrink-0 text-right text-sm">{g.summary}</div>
          </summary>

          <div className="overflow-x-auto pb-3 pl-3 sm:pl-6">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
                  <th className="border-b border-neutral-200 pb-1.5 font-medium dark:border-neutral-800">{firstColLabel}</th>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className={`border-b border-neutral-200 pb-1.5 font-medium dark:border-neutral-800 ${h.align === 'right' ? 'text-right' : ''}`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.item} className="align-top">
                    <td className="max-w-[20rem] truncate border-b border-neutral-100 py-2 dark:border-neutral-800/60">
                      <Link
                        href={itemHref(it.item)}
                        className="text-neutral-800 transition-colors hover:text-primary hover:underline dark:text-neutral-200 dark:hover:text-primary"
                      >
                        {it.item}
                      </Link>
                    </td>
                    {it.cells.map((c, i) => (
                      <td
                        key={i}
                        className={`border-b border-neutral-100 py-2 dark:border-neutral-800/60 ${headers[i]?.align === 'right' ? 'text-right' : ''}`}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
