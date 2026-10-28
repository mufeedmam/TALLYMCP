import Link from 'next/link';
import { buildQuery } from '@/lib/analytics/receivablesData';

const TABS = [
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'aging', label: 'Aging' },
  { key: 'groupwise', label: 'Groupwise' },
  { key: 'profitability', label: 'Profitability' },
] as const;

export default function PayablesTabs({ active, sp }: { active: string; sp: Record<string, string | string[] | undefined> }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/payables${buildQuery(sp, { tab: t.key })}`}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            active === t.key
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
