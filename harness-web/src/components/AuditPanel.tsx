'use client';

import { useState } from 'react';
import type { AuditResult } from '@/types';

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--crit)',
  high: '#d98d3f',
  medium: 'var(--accent)',
  low: '#7fa6c9',
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
    <aside className="flex w-[356px] shrink-0 flex-col border-l border-[var(--line-soft)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--line-soft)] px-4 py-2">
        <span className="font-mono text-[11px] text-[var(--muted)]">
          <span style={{ color: 'var(--ok)' }}>{result.score.mitigated}</span> mitigated
          <span className="mx-1.5 text-[var(--line)]">/</span>
          <span style={{ color: result.score.triggered ? 'var(--crit)' : 'var(--faint)' }}>
            {result.score.triggered}
          </span>{' '}
          triggered
        </span>
        {!live && (
          <span
            title="Agent B's /audit is not wired up; these come from a local mock of the same rule shape."
            className="rounded-[2px] border border-[var(--accent-dim)] px-1 py-px font-mono text-[9px] text-[var(--accent)]"
          >
            mock
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto text-[var(--faint)] transition hover:text-[var(--text)]"
        >
          ×
        </button>
      </div>

      <div className="scroll flex-1 overflow-y-auto">
        {result.findings.map((f) => {
          const expanded = open === f.id;
          const triggered = f.status === 'triggered';
          return (
            <div key={f.id} className="border-b border-[var(--line-soft)]">
              <button
                onClick={() => setOpen(expanded ? null : f.id)}
                className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition hover:bg-[var(--panel)]"
              >
                <span
                  className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-[1px]"
                  style={{
                    background: triggered ? SEV_COLOR[f.severity] : 'transparent',
                    border: triggered ? 'none' : '1px solid var(--line)',
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-[var(--faint)]">{f.id}</span>
                    <span
                      className="font-mono text-[9px] uppercase"
                      style={{ color: triggered ? SEV_COLOR[f.severity] : 'var(--faint)' }}
                    >
                      {triggered ? f.severity : 'ok'}
                    </span>
                  </span>
                  <span
                    className="mt-1 block text-[12px] leading-snug"
                    style={{ color: triggered ? 'var(--text)' : 'var(--muted)' }}
                  >
                    {f.title}
                  </span>
                </span>
              </button>

              {expanded && (
                <div className="space-y-3 bg-[var(--panel)] px-4 pb-4 pt-1 text-[11.5px] leading-relaxed">
                  <p className="text-[var(--muted)]">{f.summary}</p>
                  <p className="text-[var(--faint)]">{f.detail}</p>

                  <div>
                    <p className="label pb-1">incidents</p>
                    {f.incidents.map((i) => (
                      <p key={i.url} className="py-px">
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--muted)] underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--text)] hover:decoration-[var(--faint)]"
                        >
                          {i.name}
                        </a>
                        {i.loss && <span className="text-[var(--faint)]"> · {i.loss}</span>}
                        {i.pocFolder && (
                          <a
                            href={`https://github.com/sanbir/evm-hack-registry/tree/main/${i.pocFolder}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1.5 font-mono text-[9.5px] text-[var(--accent)] hover:underline"
                          >
                            run poc →
                          </a>
                        )}
                      </p>
                    ))}
                  </div>

                  <div>
                    <p className="label pb-1">{triggered ? 'remediation' : 'how this is mitigated'}</p>
                    <p className="text-[var(--muted)]">{f.remediation}</p>
                    {f.line && (
                      <p className="mt-1 font-mono text-[10px] text-[var(--faint)]">
                        matched line {f.line}
                      </p>
                    )}
                  </div>

                  <p className="font-mono text-[9.5px] text-[var(--faint)]">
                    {f.vulnClasses.join('  ')}
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
