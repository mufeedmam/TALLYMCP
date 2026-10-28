import { saveReceivablesSettings } from '@/lib/actions/receivablesSettings';
import type { ReceivablesConfig } from '@/lib/analytics/receivablesConfig';
import { Chevron } from '@/components/kit';

const inputCls =
  'mt-1 w-full rounded-md border border-neutral-300 bg-card px-2.5 py-1.5 text-sm text-neutral-900 ' +
  'focus:border-primary focus:outline-none ' +
  'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';
const labelCls = 'block text-[11px] font-medium text-neutral-500 dark:text-neutral-400';

export default function SettingsDrawer({ cfg }: { cfg: ReceivablesConfig }) {
  return (
    <details className="rounded-xl border border-neutral-200 bg-card shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
        <Chevron />
        Thresholds &amp; scoring settings
        <span className="ml-auto text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
          Applies to every tab
        </span>
      </summary>

      <form action={saveReceivablesSettings} className="grid gap-4 border-t border-neutral-100 p-5 sm:grid-cols-2 lg:grid-cols-3 dark:border-neutral-800">
        <label className={labelCls}>
          Aging edges (days, comma-separated)
          <input name="agingEdges" defaultValue={cfg.agingEdges.join(',')} className={inputCls} />
        </label>
        <label className={labelCls}>
          Dormant threshold (days)
          <input name="dormantDays" type="number" defaultValue={cfg.dormantDays} className={inputCls} />
        </label>
        <label className={labelCls}>
          Spike multiple (× 90-day avg)
          <input name="spikeX" type="number" step="0.1" defaultValue={cfg.spikeX} className={inputCls} />
        </label>
        <label className={labelCls}>
          Long-open threshold (days)
          <input name="tinyDays" type="number" defaultValue={cfg.tinyDays} className={inputCls} />
        </label>
        <label className={labelCls}>
          &quot;Tiny&quot; balance ceiling (₹)
          <input name="tinyAmount" type="number" defaultValue={cfg.tinyAmount} className={inputCls} />
        </label>
        <div className="hidden lg:block" />

        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Risk weights (should sum to ~1.0)
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className={labelCls}>
              Overdue %
              <input name="wOverdue" type="number" step="0.05" defaultValue={cfg.riskWeights.overdue} className={inputCls} />
            </label>
            <label className={labelCls}>
              Age
              <input name="wAge" type="number" step="0.05" defaultValue={cfg.riskWeights.age} className={inputCls} />
            </label>
            <label className={labelCls}>
              Concentration
              <input name="wConcentration" type="number" step="0.05" defaultValue={cfg.riskWeights.concentration} className={inputCls} />
            </label>
            <label className={labelCls}>
              Dormancy
              <input name="wDormancy" type="number" step="0.05" defaultValue={cfg.riskWeights.dormancy} className={inputCls} />
            </label>
          </div>
        </fieldset>

        <div className="sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary"
          >
            Save thresholds
          </button>
        </div>
      </form>
    </details>
  );
}
