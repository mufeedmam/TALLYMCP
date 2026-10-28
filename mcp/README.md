# Tally Cloud Analytics — MCP server

A thin [Model Context Protocol](https://modelcontextprotocol.io) **stdio** server that lets an
AI client (Claude Desktop, etc.) query the analytics dashboard's metrics directly.

It is a wrapper over the web app's machine-readable API (`/api/metrics`): it reads the metric
**catalog** at runtime and exposes **one typed tool per metric**, forwarding each call to
`POST /api/metrics/{id}`. That endpoint runs the *same* metric code the dashboard renders, so the AI
and the UI can never disagree about a number. Because it talks HTTP, this process holds **no database
credentials** — it only needs the web app reachable.

## Tools

| Tool | Purpose |
|---|---|
| `list_metrics` | Discovery — the full catalog (ids, params, output columns, reconciliation source). |
| `run_metric` | Generic fallback — run any metric by `id` with a `params` object. |
| `get_*` (one per metric) | Typed tool per metric, named from each metric's `mcp.toolName` (e.g. `get_receivables_snapshot`, `get_inventory_slow_movers`). |

New metrics added to the registry appear automatically — the catalog is read live (30s cache), so no
code change here is needed when the dashboard grows.

## Prerequisites

The analytics web app must be running **and** its database reachable:

```bash
npm --prefix web run dev     # serves http://localhost:3000
```

> If the web app's Supabase DB is paused/unreachable, every metric returns **empty/zero** rather than
> an error (the web layer swallows DB errors by design). A dashboard showing `Last synced: never` and
> all-zeros is the tell. Revive the DB, don't debug the MCP.

## Install

```bash
npm --prefix mcp install
```

## Configure your MCP client

Point the client at `server.mjs` with `node`. Example `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tally-analytics": {
      "command": "node",
      "args": ["C:/Users/mufee/Desktop/AI/TALLY CLOUD MCP/tally-cloud-analytics/mcp/server.mjs"],
      "env": { "ANALYTICS_BASE_URL": "http://localhost:3000" }
    }
  }
}
```

`ANALYTICS_BASE_URL` is optional (defaults to `http://localhost:3000`). Set it to point at a deployed
instance instead of the local dev server.

## Notes

- **Read-only.** Every tool runs a read query through the metrics API; nothing writes.
- **No auth yet.** Same posture as `/api/metrics` — add auth before exposing either publicly.
- **Run it manually** to sanity-check: `npm --prefix mcp start` (it speaks JSON-RPC over stdio, so it
  will appear to hang waiting for a client — that's expected).
