// The shared analytics layer contract (PLAN.md §13).
// Every dashboard number comes from a MetricDefinition. A future MCP server
// imports these same definitions and exposes one tool per metric — no rework.

export type MetricParamType = 'string' | 'number' | 'date' | 'boolean' | 'json';

export interface MetricParam {
  name: string;
  type: MetricParamType;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  description?: string;
}

export interface MetricOutputColumn {
  column: string;
  type: string;
  semantic?: string;
}

// `P extends object` rather than `Record<string, unknown>`: metrics take precise
// param interfaces (e.g. ReceivablesFilters). Requiring an index signature would
// force those interfaces to accept any key and lose typo-checking on real params.
export interface MetricDefinition<P extends object = Record<string, unknown>, R = unknown> {
  /** stable id, e.g. "receivables.aging" */
  id: string;
  title: string;
  description: string;
  params: MetricParam[];
  /** documented, typed output shape (feeds the metric dictionary) */
  output: MetricOutputColumn[];
  /** name of the Tally snapshot this reconciles against, or null */
  reconcile?: string | null;
  /** the actual query, parameterized and read-only */
  run: (params: P) => Promise<R>;
  /** ready for a future MCP tool; unused for now */
  mcp?: { toolName: string };
}
