import type { MetricDefinition } from '../types';
import { query, isDbConfigured } from '@/lib/db';

export interface LastSyncResult {
  configured: boolean;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: string | null;
}

export const lastSyncMetric: MetricDefinition<Record<string, never>, LastSyncResult> = {
  id: 'meta.last_sync',
  title: 'Last sync',
  description: 'Most recent data sync from Tally into the cloud database.',
  params: [],
  output: [
    { column: 'last_success_at', type: 'timestamptz', semantic: 'time of last successful sync' },
    { column: 'last_attempt_at', type: 'timestamptz', semantic: 'time of most recent sync attempt' },
    { column: 'last_status', type: 'text', semantic: 'status of most recent attempt' },
  ],
  reconcile: null,
  mcp: { toolName: 'get_last_sync' },
  run: async () => {
    if (!isDbConfigured()) {
      return { configured: false, last_success_at: null, last_attempt_at: null, last_status: null };
    }
    const rows = await query<{
      last_success_at: string | null;
      last_attempt_at: string | null;
      last_status: string | null;
    }>('select last_success_at, last_attempt_at, last_status from meta.last_sync');
    const r = rows[0] ?? { last_success_at: null, last_attempt_at: null, last_status: null };
    return { configured: true, ...r };
  },
};
