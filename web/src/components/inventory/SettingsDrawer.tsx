import { saveInventorySettings } from '@/lib/actions/inventorySettings';
import type { InventoryConfig } from '@/lib/analytics/inventoryConfig';
import { Chevron } from '@/components/kit';

const inputCls =
  'mt-1 w-full rounded-md border border-neutral-300 bg-card px-2.5 py-1.5 text-sm text-neutral-900 ' +
  'focus:border-primary focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';
const labelCls = 'block text-[11px] font-medium text-neutral-500 dark:text-neutral-400';

export default function InventorySettingsDrawer({ cfg }: { cfg: InventoryConfig }) {
  return (
    <details className="mb-5 rounded-xl border border-neutral-200 bg-card shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
        <Chevron />
        Thresholds &amp; flags
        <span className="ml-auto text-[11px] font-normal text-neutral-400 dark:text-neutral-500">Applies to every tab</span>
      </summary>

      <form action={saveInventorySettings} className="grid gap-4 border-t border-neutral-100 p-5 sm:grid-cols-3 dark:border-neutral-800">
        <label className={labelCls}>
          Slow / dead threshold (days)
          <input name="slowDays" type="number" min="1" defaultValue={cfg.slowDays} className={inputCls} />
        </label>
        <label className={labelCls}>
          Plausible margin — low %
          <input name="marginLow" type="number" step="1" defaultValue={cfg.marginBand[0]} className={inputCls} />
        </label>
        <label className={labelCls}>
          Plausible margin — high %
          <input name="marginHigh" type="number" step="1" defaultValue={cfg.marginBand[1]} className={inputCls} />
        </label>
        <div className="sm:col-span-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary"
          >
            Save thresholds
          </button>
          <span className="ml-3 text-xs text-neutral-400">
            Items with a margin outside the band are flagged as data artifacts (stock rename/transfer).
          </span>
        </div>
      </form>
    </details>
  );
}
