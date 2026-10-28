import Link from 'next/link';
import { formatCompact, formatFull } from './kit';

export interface AgingBucketRow {
  bucket: string;
  amount: number;
  layer_count: number;
}

// Ordinal severity ramp (sequential blue, within the validated ordinal band —
// light no-lighter-than step 250). Bucket count is user-configurable, so color
// is assigned by POSITION across however many buckets exist rather than by a
// fixed bucket-name lookup, which goes stale the moment the edges change.
const RAMP = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];

function rampColor(index: number, count: number): string {
  if (count <= 1) return RAMP[Math.floor(RAMP.length / 2)];
  return RAMP[Math.round((index * (RAMP.length - 1)) / (count - 1))];
}

function label(bucket: string): string {
  return bucket.endsWith('+') ? `${bucket} days` : `${bucket.replace('-', '–')} days`;
}

export default function AgingBarChart({
  data,
  hrefFor,
  activeBucket,
}: {
  data: AgingBucketRow[];
  /** When provided, each bar links to the filtered view for that bucket. */
  hrefFor?: (bucket: string) => string;
  activeBucket?: string;
}) {
  const max = Math.max(...data.map((d) => d.amount), 1);
  const total = data.reduce((s, d) => s + d.amount, 0);

  return (
    <figure>
      <div className="space-y-2.5">
        {data.map((d, i) => {
          const pct = Math.max((d.amount / max) * 100, d.amount > 0 ? 1.5 : 0);
          const share = total > 0 ? Math.round((d.amount / total) * 100) : 0;
          const isActive = activeBucket === d.bucket;
          const row = (
            <div
              className={`flex items-center gap-3 rounded-md px-2 py-1 transition-colors ${
                hrefFor ? 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50' : ''
              } ${isActive ? 'bg-primary/10 dark:bg-primary/10' : ''}`}
            >
              <div className="w-24 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{label(d.bucket)}</div>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full"
                  style={{ width: `${pct}%`, backgroundColor: rampColor(i, data.length), borderRadius: '0 4px 4px 0' }}
                />
              </div>
              <div className="tnum w-11 shrink-0 text-right text-xs text-neutral-400 dark:text-neutral-500">
                {share}%
              </div>
              <div className="tnum w-20 shrink-0 text-right text-xs font-medium text-neutral-800 dark:text-neutral-200">
                {formatCompact(d.amount)}
              </div>
            </div>
          );
          return hrefFor ? (
            <Link
              key={d.bucket}
              href={hrefFor(d.bucket)}
              className="block"
              title={`${label(d.bucket)}: ${formatFull(d.amount)} across ${d.layer_count} open item(s) — click to filter`}
            >
              {row}
            </Link>
          ) : (
            <div key={d.bucket} title={`${label(d.bucket)}: ${formatFull(d.amount)} across ${d.layer_count} open item(s)`}>
              {row}
            </div>
          );
        })}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300">
          Show as table
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th className="py-1 font-medium">Bucket</th>
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="py-1 text-right font-medium">Share</th>
              <th className="py-1 text-right font-medium">Open items</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.bucket} className="border-b border-neutral-100 dark:border-neutral-800/60">
                <td className="py-1 text-neutral-700 dark:text-neutral-300">{label(d.bucket)}</td>
                <td className="tnum py-1 text-right text-neutral-800 dark:text-neutral-200">{formatFull(d.amount)}</td>
                <td className="tnum py-1 text-right text-neutral-500 dark:text-neutral-400">
                  {total > 0 ? Math.round((d.amount / total) * 100) : 0}%
                </td>
                <td className="tnum py-1 text-right text-neutral-500 dark:text-neutral-400">{d.layer_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
