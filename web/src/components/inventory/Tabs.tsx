import Link from 'next/link';

const TABS = [
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'movement', label: 'Movement' },
  { key: 'profitability', label: 'Profitability' },
  { key: 'slow', label: 'Slow / Dead' },
] as const;

export default function InventoryTabs({ active }: { active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === 'snapshot' ? '/inventory' : `/inventory?tab=${t.key}`}
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
