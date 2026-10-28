import Link from 'next/link';
import { buildQuery } from '@/lib/analytics/receivablesData';

const TABS = [
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'aging', label: 'Aging' },
  { key: 'groupwise', label: 'Groupwise' },
  { key: 'profitability', label: 'Profitability' },
  { key: 'risk', label: 'Risk' },
  { key: 'noactivity', label: 'No Activity' },
  { key: 'unusual', label: 'Unusual' },
] as const;

/** Switching tabs preserves the active filters — losing them on every tab click
 *  is the classic dashboard annoyance. */
export default function Tabs({
  active,
  sp,
}: {
  active: string;
  sp: Record<string, string | string[] | undefined>;
}) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/receivables${buildQuery(sp, { tab: t.key })}`}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            active === t.key
              ? 'border-primary text-neutral-900 dark:border-primary dark:text-neutral-50'
              : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
