// Remote MCP endpoint (Streamable HTTP, stateless) so claude.ai / Claude mobile
// can add this dashboard as a custom connector. Speaks JSON-RPC over POST and
// reuses the SAME in-process metric registry the dashboard renders from — so the
// AI and the UI can't disagree, and there's no second network hop.
//
// ⚠️ TESTING POSTURE: this endpoint is intentionally UNAUTHENTICATED (Option A),
// matching the already-public /api/metrics. claude.ai custom connectors expect
// OAuth or a fully-open server — a path token tripped their OAuth registration.
// Before any real/production exposure, put auth (OAuth) in front of BOTH this
// route and /api/metrics.
import type { NextRequest } from 'next/server';
import { listMetrics, getMetric, runMetric } from '@/lib/analytics';
import type { MetricDefinition, MetricParam } from '@/lib/analytics/types';

export const runtime = 'nodejs'; // pg needs the Node runtime, not edge
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SERVER_INFO = { name: 'tally-cloud-analytics', version: '0.1.0' };
const FALLBACK_PROTOCOL = '2025-06-18';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, mcp-session-id, mcp-protocol-version',
};

/* ---------------- tool catalog (mirrors the stdio MCP server) ---------------- */

function toolName(m: MetricDefinition): string {
  return m.mcp?.toolName || m.id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function paramSchema(p: MetricParam): Record<string, unknown> {
  const type =
    p.type === 'number' ? 'number'
      : p.type === 'boolean' ? 'boolean'
        : p.type === 'json' ? 'object'
          : 'string';
  const s: Record<string, unknown> = { type };
  if (p.description) s.description = p.description;
  if (Array.isArray(p.enum)) s.enum = p.enum;
  if (p.default !== undefined) s.default = p.default;
  return s;
}

function inputSchema(params: MetricParam[] = []): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = paramSchema(p);
    if (p.required) required.push(p.name);
  }
  const schema: Record<string, unknown> = { type: 'object', properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

function listTools() {
  return [
    {
      name: 'list_metrics',
      description: 'List every Tally analytics metric with its id, parameters, output columns and reconciliation source.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'run_metric',
      description: 'Run any analytics metric by its id (e.g. "receivables.aging"). Generic fallback — prefer the specific get_* tool when one is listed.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, params: { type: 'object', additionalProperties: true } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    ...listMetrics().map((m) => ({
      name: toolName(m),
      description: `${m.title} — ${m.description}${m.reconcile ? ` (reconciles to Tally via ${m.reconcile})` : ''}`,
      inputSchema: inputSchema(m.params),
    })),
  ];
}

/* ---------------- running a metric ---------------- */

function buildParams(metric: MetricDefinition, args: Record<string, unknown> = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of metric.params) {
    if (p.name in args && args[p.name] !== undefined) params[p.name] = args[p.name];
    else if (p.default !== undefined) params[p.name] = p.default;
  }
  const missing = metric.params.filter((p) => p.required && params[p.name] === undefined).map((p) => p.name);
  if (missing.length) throw new Error(`Missing required param(s): ${missing.join(', ')}`);
  return params;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === 'list_metrics') {
    const metrics = listMetrics().map((m) => ({
      id: m.id, tool: toolName(m), title: m.title, description: m.description, params: m.params, reconcile: m.reconcile ?? null,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ count: metrics.length, metrics }, null, 2) }] };
  }

  let metric: MetricDefinition | undefined;
  let metricArgs = args;
  if (name === 'run_metric') {
    const id = typeof args.id === 'string' ? args.id : undefined;
    if (!id) return { isError: true, content: [{ type: 'text', text: 'run_metric requires an "id" (see list_metrics).' }] };
    metric = getMetric(id);
    metricArgs = (args.params as Record<string, unknown>) ?? {};
  } else {
    metric = listMetrics().find((m) => toolName(m) === name);
  }
  if (!metric) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}. Call list_metrics to see what's available.` }] };

  const params = buildParams(metric, metricArgs ?? {});
  const data = await runMetric(metric.id, params);
  const header = `// metric ${metric.id}${metric.reconcile ? ` · reconciles to Tally via ${metric.reconcile}` : ''}\n`;
  return { content: [{ type: 'text', text: header + JSON.stringify(data, null, 2) }] };
}

/* ---------------- JSON-RPC plumbing ---------------- */

type RpcId = string | number | null | undefined;
interface RpcMessage {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: RpcId, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handleMessage(msg: RpcMessage): Promise<object | null> {
  const { id, method, params } = msg ?? {};
  if (!method) return fail(id, -32600, 'Invalid Request');
  if (method.startsWith('notifications/')) return null; // notifications get no response
  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: (params?.protocolVersion as string) || FALLBACK_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: listTools() });
      case 'tools/call':
        return ok(id, await callTool(params?.name as string, (params?.arguments as Record<string, unknown>) ?? {}));
      default:
        return fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return fail(id, -32603, (e as Error).message);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

/* ---------------- HTTP handlers (no auth — testing posture) ---------------- */

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(fail(null, -32700, 'Parse error'), 400);
  }

  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handleMessage(m as RpcMessage)))).filter(Boolean);
    return responses.length ? json(responses) : new Response(null, { status: 202, headers: CORS });
  }
  const res = await handleMessage(body as RpcMessage);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
}

// Request/response only (stateless) — no server->client SSE stream, so GET isn't
// supported. Clients fall back to POST.
export async function GET() {
  return new Response('Tally MCP endpoint — connect an MCP client via POST (JSON-RPC over HTTP).', {
    status: 405,
    headers: CORS,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
