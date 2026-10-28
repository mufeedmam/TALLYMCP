#!/usr/bin/env node
// Tally Cloud Analytics — MCP server.
//
// A deliberately thin stdio bridge between an MCP client (Claude Desktop, etc.)
// and the analytics web app's machine-readable metric API. It introspects
// GET /api/metrics once, then exposes:
//   • one typed get_* tool per metric (named from each metric's mcp.toolName)
//   • list_metrics — discovery (the full catalog)
//   • run_metric   — generic escape hatch (run any metric by id)
// Every call forwards to POST /api/metrics/{id}, which runs the SAME metric code
// the dashboard uses — so the AI and the UI can never disagree. Because it goes
// through HTTP, this process needs no database credentials; it only needs the
// web app reachable at ANALYTICS_BASE_URL (default http://localhost:3000).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = (process.env.ANALYTICS_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const CATALOG_URL = `${BASE_URL}/api/metrics`;
const CATALOG_TTL_MS = 30_000;

let catalogCache = null; // { fetchedAt, metrics, byTool }

const log = (msg) => process.stderr.write(`[tally-mcp] ${msg}\n`);
const sanitize = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

async function fetchCatalog() {
  const res = await fetch(CATALOG_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
  const json = await res.json();
  const metrics = Array.isArray(json.metrics) ? json.metrics : [];
  const byTool = new Map();
  for (const m of metrics) byTool.set(m.mcpTool || sanitize(m.id), m);
  catalogCache = { fetchedAt: Date.now(), metrics, byTool };
  return catalogCache;
}

/** Cached catalog with a short TTL so a client reconnect picks up new metrics
 *  without re-fetching on every single request. */
async function getCatalog() {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) return catalogCache;
  return fetchCatalog();
}

/* ---------------- JSON Schema from a metric's declared params ---------------- */

function paramToSchema(p) {
  const type =
    p.type === 'number' ? 'number'
      : p.type === 'boolean' ? 'boolean'
        : p.type === 'json' ? 'object'
          : 'string'; // string | date
  const s = { type };
  if (p.description) s.description = p.description;
  if (Array.isArray(p.enum)) s.enum = p.enum;
  if (p.default !== undefined) s.default = p.default;
  return s;
}

function inputSchemaFor(params) {
  const properties = {};
  const required = [];
  for (const p of params ?? []) {
    properties[p.name] = paramToSchema(p);
    if (p.required) required.push(p.name);
  }
  const schema = { type: 'object', properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

/* ---------------- tool definitions ---------------- */

const STATIC_TOOLS = [
  {
    name: 'list_metrics',
    description:
      'List every Tally analytics metric with its id, parameters, output columns and reconciliation source. Call this first to discover what you can query.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_metric',
    description:
      'Run any analytics metric by its id (e.g. "receivables.aging"). Generic fallback — prefer the specific get_* tool when one is listed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Metric id from list_metrics, e.g. "receivables.snapshot"' },
        params: { type: 'object', description: 'Metric parameters as an object', additionalProperties: true },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

async function listTools() {
  const tools = [...STATIC_TOOLS];
  try {
    const { metrics } = await getCatalog();
    for (const m of metrics) {
      tools.push({
        name: m.mcpTool || sanitize(m.id),
        description: `${m.title} — ${m.description}${m.reconcile ? ` (reconciles to Tally via ${m.reconcile})` : ''}`,
        inputSchema: inputSchemaFor(m.params),
      });
    }
  } catch (e) {
    // Web app not reachable yet: expose only the generic tools. They start
    // working as soon as ANALYTICS_BASE_URL is up; clients re-list on reconnect.
    log(`catalog unavailable (${e.message}); exposing generic tools only`);
  }
  return { tools };
}

/* ---------------- running a metric ---------------- */

async function runMetricHttp(id, params) {
  const res = await fetch(`${CATALOG_URL}/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json; // { id, params, reconcile, data }
}

const okResult = (text) => ({ content: [{ type: 'text', text }] });
const errResult = (text) => ({ isError: true, content: [{ type: 'text', text }] });

async function callTool(name, args) {
  try {
    if (name === 'list_metrics') {
      const { metrics } = await getCatalog();
      return okResult(JSON.stringify({ count: metrics.length, metrics }, null, 2));
    }

    let id;
    let params;
    if (name === 'run_metric') {
      id = args?.id;
      if (!id) return errResult('run_metric requires an "id" (see list_metrics).');
      params = args?.params ?? {};
    } else {
      const { byTool } = await getCatalog();
      const m = byTool.get(name);
      if (!m) return errResult(`Unknown tool: ${name}. Call list_metrics to see what's available.`);
      id = m.id;
      params = args ?? {};
    }

    const result = await runMetricHttp(id, params);
    const header = `// metric ${id}${result.reconcile ? ` · reconciles to Tally via ${result.reconcile}` : ''}\n`;
    return okResult(header + JSON.stringify(result.data, null, 2));
  } catch (e) {
    return errResult(
      `${e.message}. Is the analytics web app running at ${BASE_URL}? Start it with:  npm --prefix web run dev`,
    );
  }
}

/* ---------------- wire up stdio transport ---------------- */

const server = new Server(
  { name: 'tally-cloud-analytics', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, listTools);
server.setRequestHandler(CallToolRequestSchema, (req) => callTool(req.params.name, req.params.arguments ?? {}));

const transport = new StdioServerTransport();
await server.connect(transport);
log(`connected · base ${BASE_URL}`);
