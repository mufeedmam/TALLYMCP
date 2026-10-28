import { listMetrics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

// GET /api/metrics — the machine-readable metric catalog. This is the contract an
// MCP server (or any AI client) introspects: one entry per metric, with its params,
// output columns, reconciliation source, and suggested MCP tool name. Run a metric
// via GET /api/metrics/{id}?param=value. (Read-only; add auth before public hosting.)
export async function GET() {
  const metrics = listMetrics().map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    params: m.params,
    output: m.output,
    reconcile: m.reconcile ?? null,
    mcpTool: m.mcp?.toolName ?? null,
    run: { method: 'GET', path: `/api/metrics/${m.id}` },
  }));

  return Response.json(
    { count: metrics.length, metrics },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
