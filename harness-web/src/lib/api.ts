import { mockAudit } from '@/mocks/auditFindings';
import { API_ROUTES, type AuditRequest, type AuditResult } from '@/types';

/**
 * The single place API_BASE is read (§5.6 item 4). While Agent B's service is not
 * reachable, every call falls back to a local mock so the UI is demonstrable end to
 * end. At h10 this env var is set and nothing else changes.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') ?? '';

export const usingMocks = () => API_BASE === '';

export async function audit(req: AuditRequest): Promise<{ result: AuditResult; live: boolean }> {
  if (!API_BASE) {
    return { result: mockAudit(req.source, req.preset), live: false };
  }

  const res = await fetch(`${API_BASE}${API_ROUTES.audit}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`Audit failed: ${res.status} ${res.statusText}`);
  }
  return { result: (await res.json()) as AuditResult, live: true };
}
