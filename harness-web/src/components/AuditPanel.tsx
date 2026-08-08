'use client';

import { useState } from 'react';
import type { AuditResult } from '@/types';

const SEV: Record<string, { fg: string; bg: string }> = {
  critical: { fg: 'var(--red-3)', bg: 'var(--red-1)' },
  high: { fg: '#9a4a06', bg: 'var(--amber-1)' },
  medium: { fg: '#8a5a12', bg: 'var(--amber-1)' },
  low: { fg: 'var(--blue-3)', bg: 'var(--blue-1)' },
};

export default function AuditPanel({
  result,
  live,
  onClose,
}: {
  result: AuditResult;
  live: boolean;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(
    result.findings.find((f) => f.status === 'triggered')?.id ?? null,
  );

  return (
    <aside
      className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-lg bg-white"
      style={{ boxShadow: 'var(--shadow)' }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gray-2)] px-3 py-2">
        <h2 className="section-title">Audit</h2>
        <span className="text-[12px] text-[var(--gray-5)]">
          {result.score.mitigated} mitigated, {result.score.triggered} triggered
        </span>
        {!live && (
          <span
            title="Agent B's /audit is not wired up yet; these come from a local mock using the same rule shape."
            className="rounded-full bg-[var(--gray-2)] px-1.5 py-px text-[11px] text-[var(--gray-5)]"
          >
            mock
          </span>
        )}
        <button
          onClick={onClose}
          aria-label="Close audit"
          className="ml-auto text-[var(--gray-4)] hover:text-[var(--gray-6)]"
        >
          ×
        </button>
      </div>

      <div className="scroll flex-1 overflow-y-auto">
        {result.findings.map((f) => {
          const expanded = open === f.id;
          const triggered = f.status === 'triggered';
          const sev = SEV[f.severity];
          return (
            <div key={f.id} className="border-b border-[var(--gray-2)] last:border-0">
              <button
                onClick={() => setOpen(expanded ? null : f.id)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-[var(--gray-1)]"
              >
                <span
                  className="mt-[2px] shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium capitalize"
                  style={
                    triggered
                      ? { background: sev.bg, color: sev.fg }
                      : { background: 'var(--gray-2)', color: 'var(--gray-5)' }
                  }
                >
                  {triggered ? f.severity : 'ok'}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-[13px] leading-snug"
                    style={{ color: triggered ? 'var(--text-color)' : 'var(--gray-5)' }}
                  >
                    {f.title}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-[var(--gray-4)]">
                    {f.id}
                  </span>
                </span>
              </button>

              {expanded && (
                <div className="space-y-3 bg-[var(--gray-1)] px-3 pb-3 pt-1 text-[12.5px] leading-relaxed">
                  <p>{f.summary}</p>
                  <p className="text-[var(--gray-5)]">{f.detail}</p>

                  <div>
                    <h3 className="section-title mb-1">Incidents</h3>
                    {f.incidents.map((i) => (
                      <p key={i.url} className="py-px">
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--blue-2)] hover:underline"
                        >
                          {i.name}
                        </a>
                        {i.loss && <span className="text-[var(--gray-4)]"> — {i.loss}</span>}
                        {i.pocFolder && (
                          <a
                            href={`https://github.com/sanbir/evm-hack-registry/tree/main/${i.pocFolder}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 rounded-full bg-[var(--gray-2)] px-1.5 py-px text-[11px] text-[var(--gray-6)] hover:bg-[var(--gray-3)]"
                          >
                            Run the PoC
                          </a>
                        )}
                      </p>
                    ))}
                  </div>

                  <div>
                    <h3 className="section-title mb-1">
                      {triggered ? 'Remediation' : 'How this is mitigated'}
                    </h3>
                    <p className="text-[var(--gray-5)]">{f.remediation}</p>
                    {f.line && (
                      <p className="mt-1 font-mono text-[11px] text-[var(--gray-4)]">
                        Matched line {f.line}
                      </p>
                    )}
                  </div>

                  <p className="font-mono text-[11px] text-[var(--gray-4)]">
                    {f.vulnClasses.join('  ·  ')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
