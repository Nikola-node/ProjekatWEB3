'use client';

import type { SettingAdvice, VaultAnalysis, Verdict } from '@/lib/vaultAdvice';

const TONE: Record<Verdict, { fg: string; bg: string; word: string }> = {
  ok: { fg: 'var(--green-2)', bg: 'var(--green-1)', word: 'Sensible' },
  warn: { fg: '#9a4a06', bg: 'var(--amber-1)', word: 'Reconsider' },
  bad: { fg: 'var(--red-3)', bg: 'var(--red-1)', word: 'Change this' },
};

export default function VaultAdvicePanel({
  analysis,
  onApply,
  onClose,
}: {
  analysis: VaultAnalysis;
  onApply: (a: SettingAdvice) => void;
  onClose: () => void;
}) {
  const m = analysis.market;

  return (
    <aside className="card flex w-[380px] shrink-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-soft)] px-4 py-2.5">
        <h2 className="section-title">Vault settings</h2>
        <span className="text-[14px] text-[var(--text-muted)]">
          against live Aave {analysis.asset.symbol}
        </span>
        <button
          onClick={onClose}
          aria-label="Close settings advice"
          className="ml-auto text-[var(--text-faint)] hover:text-[var(--text-color)]"
        >
          ×
        </button>
      </div>

      {/* What the recommendations are derived from. Shown so the numbers are
          auditable rather than asserted. */}
      <div className="shrink-0 border-b border-[var(--border-soft)] bg-[var(--card-2)] px-4 py-3">
        <p className="section-title mb-2">Market right now</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13.5px]">
          <Stat k="Supply cap" v={m.supplyCap} />
          <Stat k="Supplied" v={m.supplied} />
          <Stat k="Headroom" v={m.headroom} />
          <Stat k="Available liquidity" v={m.availableLiquidity} />
          <Stat k="Supply APY" v={`${m.supplyApyPct.toFixed(2)}%`} />
          <Stat k="Reserve factor" v={`${m.reserveFactorPct.toFixed(0)}%`} />
        </dl>
        {(m.frozen || m.paused) && (
          <p className="mt-2 text-[13px]" style={{ color: 'var(--red-3)' }}>
            This reserve is {m.frozen ? 'frozen' : ''}
            {m.frozen && m.paused ? ' and ' : ''}
            {m.paused ? 'paused' : ''}. Deposits will revert.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {analysis.advice.map((a) => {
          const tone = TONE[a.verdict];
          return (
            <div key={a.setting} className="border-b border-[var(--border-soft)] px-4 py-3 last:border-0">
              <div className="flex items-baseline gap-2">
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium"
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  {tone.word}
                </span>
                <span className="text-[15px]">{a.label}</span>
                {a.finding && (
                  <span className="ml-auto font-mono text-[12px] text-[var(--text-faint)]">
                    {a.finding}
                  </span>
                )}
              </div>

              <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">{a.detail}</p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-[var(--text-faint)]">now</span>
                <code className="rounded bg-[var(--card-2)] px-1.5 py-0.5 font-mono">
                  {a.current}
                </code>
                {a.recommended && (
                  <>
                    <span className="text-[var(--text-faint)]">→</span>
                    <code className="rounded bg-[var(--card-2)] px-1.5 py-0.5 font-mono">
                      {a.recommended}
                    </code>
                    <button className="btn ml-1 !py-1 !text-[13px]" onClick={() => onApply(a)}>
                      Apply
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-[var(--text-faint)]">{k}</dt>
      <dd className="text-right font-mono">{v}</dd>
    </>
  );
}
