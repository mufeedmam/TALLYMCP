import { NextRequest } from 'next/server';
import { runMetric } from '@/lib/analytics';
import { parseFilters } from '@/lib/analytics/receivablesData';

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

const METRIC_FOR_TAB: Record<string, string> = {
  groupwise: 'receivables.groupwise',
  risk: 'receivables.risk',
  noactivity: 'receivables.noActivity',
  aging: 'receivables.agingBuckets',
  topExposures: 'receivables.topExposures',
  snapshot: 'receivables.topExposures',
};

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const tab = sp.tab ?? 'topExposures';
  // The CSV must match what the user is looking at, so it runs through the same
  // filters the page applied.
  const filters = parseFilters(sp);
  const metricId = METRIC_FOR_TAB[tab] ?? 'receivables.topExposures';
  const params = metricId === 'receivables.topExposures' ? { ...filters, limit: 5000 } : filters;

  const result = await runMetric(metricId, params as Record<string, unknown>);
  const rows = (Array.isArray(result) ? result : [result]) as unknown as Record<string, unknown>[];

  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="receivables-${tab}.csv"`,
    },
  });
}
