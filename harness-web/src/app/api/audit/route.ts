import { mockAudit } from '@/mocks/auditFindings';
import { PRESET_LIST } from '@/types';
import type { AuditRequest, Preset } from '@/types';

/**
 * Audit over HTTP.
 *
 * Mirrors what the page does client-side so anything that speaks HTTP — the MCP
 * server, CI, a script — can audit Solidity without a browser.
 *
 * Still Agent B's rule engine in the long run: when API_BASE points at
 * harness-api, the page prefers that and this becomes the fallback.
 */

export const runtime = 'nodejs';


export async function POST(req: Request): Promise<Response> {
  let body: Partial<AuditRequest>;
  try {
    body = (await req.json()) as Partial<AuditRequest>;
  } catch {
    return json({ error: 'Malformed JSON body' }, 400);
  }

  if (typeof body.source !== 'string' || !body.source.trim()) {
    return json({ error: 'source is required' }, 400);
  }
  if (!body.preset || !PRESET_LIST.includes(body.preset)) {
    return json({ error: `preset must be one of: ${PRESET_LIST.join(', ')}` }, 400);
  }

  return json(mockAudit(body.source, body.preset), 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}
