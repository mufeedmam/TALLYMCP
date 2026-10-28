import { runMetric } from '@/lib/analytics';
import type { LastSyncResult } from '@/lib/analytics/metrics/last-sync';

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

export default async function LastSynced() {
  const s = await runMetric<LastSyncResult>('meta.last_sync');

  if (!s.configured) {
    return (
      <span className="flex items-center gap-2 text-xs text-amber-600">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Not connected
      </span>
    );
  }

  const ok = s.last_status === 'success' || !!s.last_success_at;
  return (
    <span className="flex items-center gap-2 text-xs text-neutral-500">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      Last synced: {relative(s.last_success_at)}
    </span>
  );
}
