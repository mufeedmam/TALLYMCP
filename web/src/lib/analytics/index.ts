// Analytics registry — the single entry point the app (and later the MCP server) uses.
import type { MetricDefinition } from './types';
import { lastSyncMetric } from './metrics/last-sync';
import {
  receivablesSnapshotMetric,
  receivablesAgingBucketsMetric,
  receivablesTopExposuresMetric,
  receivablesGroupwiseMetric,
  receivablesRiskMetric,
  receivablesNoActivityMetric,
  receivablesUnusualMetric,
  receivablesPartyDetailMetric,
} from './metrics/receivables';
import {
  expensesSnapshotMetric,
  expensesAccountsMetric,
  expensesCategoryMetric,
  expensesTrendMetric,
} from './metrics/expenses';
import {
  inventorySnapshotMetric,
  inventoryItemsMetric,
  inventoryGroupsMetric,
  inventorySlowMoversMetric,
  inventoryProfitabilityMetric,
  inventoryMovementMetric,
  inventoryItemDetailMetric,
} from './metrics/inventory';

const metrics: MetricDefinition[] = [
  lastSyncMetric as MetricDefinition,
  receivablesSnapshotMetric as MetricDefinition,
  receivablesAgingBucketsMetric as MetricDefinition,
  receivablesTopExposuresMetric as MetricDefinition,
  receivablesGroupwiseMetric as MetricDefinition,
  receivablesRiskMetric as MetricDefinition,
  receivablesNoActivityMetric as MetricDefinition,
  receivablesUnusualMetric as MetricDefinition,
  receivablesPartyDetailMetric as MetricDefinition,
  expensesSnapshotMetric as MetricDefinition,
  expensesAccountsMetric as MetricDefinition,
  expensesCategoryMetric as MetricDefinition,
  expensesTrendMetric as MetricDefinition,
  inventorySnapshotMetric as MetricDefinition,
  inventoryItemsMetric as MetricDefinition,
  inventoryGroupsMetric as MetricDefinition,
  inventorySlowMoversMetric as MetricDefinition,
  inventoryProfitabilityMetric as MetricDefinition,
  inventoryMovementMetric as MetricDefinition,
  inventoryItemDetailMetric as MetricDefinition,
];

const registry = new Map<string, MetricDefinition>(metrics.map((m) => [m.id, m]));

export function listMetrics(): MetricDefinition[] {
  return [...registry.values()];
}

export function getMetric(id: string): MetricDefinition | undefined {
  return registry.get(id);
}

export async function runMetric<R = unknown>(
  id: string,
  params: Record<string, unknown> = {},
): Promise<R> {
  const m = registry.get(id);
  if (!m) throw new Error(`Unknown metric: ${id}`);
  return m.run(params) as Promise<R>;
}

export type { MetricDefinition } from './types';
