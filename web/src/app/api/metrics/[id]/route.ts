import type { NextRequest } from 'next/server';
import { getMetric, runMetric } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/** Coerce a raw string param to the type the metric declares. */
function coerce(value: string, type: string): unknown {
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'boolean') return value === 'true' || value === '1';
  return value;
}

async function handle(req: NextRequest, id: string, bodyParams: Record<string, unknown>) {
  const metric = getMetric(id);
  if (!metric) {
    return Response.json({ error: `Unknown metric: ${id}` }, { status: 404 });
  }

  // Build params from the querystring (typed per the metric's declared params),
  // then let a JSON body override. Only declared params are accepted.
  const params: Record<string, unknown> = {};
  const sp = req.nextUrl.searchParams;
  for (const p of metric.params) {
    if (sp.has(p.name)) params[p.name] = coerce(sp.get(p.name)!, p.type);
    else if (p.name in bodyParams) params[p.name] = bodyParams[p.name];
    else if (p.default !== undefined) params[p.name] = p.default;
  }

  const missing = metric.params.filter((p) => p.required && params[p.name] === undefined).map((p) => p.name);
  if (missing.length) {
    return Response.json({ error: `Missing required param(s): ${missing.join(', ')}` }, { status: 400 });
  }

  try {
    const data = await runMetric(id, params);
    return Response.json(
      { id, params, reconcile: metric.reconcile ?? null, data },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id, {});
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return handle(req, id, typeof body === 'object' && body ? body : {});
}
