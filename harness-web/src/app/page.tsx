'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

import { buildPreset, printPreset, PRESET_DEFAULTS, PRESET_LABELS } from '@/generator';
import { printDeployScript } from '@/generator/aave/deployScript';
import {
  assembleAttackTests,
  type AttackSnippetFile,
} from '@/generator/attacks/assembleAttackTests';
import snippetFile from '@/generated/attack-snippets.json';
import AuditPanel from '@/components/AuditPanel';
import ThemeToggle from '@/components/ThemeToggle';
import VaultAdvicePanel from '@/components/VaultAdvicePanel';
import { analyzeVault, type SettingAdvice, type VaultAnalysis } from '@/lib/vaultAdvice';
import { audit, compile } from '@/lib/api';
import { buildProjectZip, downloadBlob, remixUrl } from '@/lib/exportProject';
import {
  FINDING_TITLES,
  SEVERITY_BY_FINDING,
  SOLC_VERSION,
  type AuditResult,
  type CompileResult,
  type FindingId,
  type GenerateOptions,
  type Preset,
} from '@/types';

// EditorView touches `document` in its constructor, so the editor may never be
// prerendered. `ssr: false` is only legal inside a Client Component.
const CodeEditor = dynamic(() => import('@/components/CodeEditor'), {
  ssr: false,
  loading: () => <div className="p-6 text-[var(--text-faint)]">Loading editor…</div>,
});

const SNIPPETS = snippetFile as unknown as AttackSnippetFile;

type Tab = 'contract' | 'tests' | 'deploy';

const TAB_LABEL: Record<Preset, string> = {
  'aave-v3-flashloan-receiver': 'Aave V3 Flash Loan Receiver',
  'aave-v3-erc4626-vault': 'Aave V3 ERC-4626 Vault',
  'morpho-blue-vault': 'Morpho Blue Vault',
};

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--red-2)',
  high: '#d2691e',
  medium: '#b25e09',
  low: 'var(--blue-2)',
};

export default function Home() {
  const [opts, setOpts] = useState<GenerateOptions>(PRESET_DEFAULTS['aave-v3-flashloan-receiver']);
  const [tab, setTab] = useState<Tab>('contract');
  const [edited, setEdited] = useState<string | null>(null);
  const [auditState, setAuditState] = useState<{ result: AuditResult; live: boolean } | null>(null);
  const [compileState, setCompileState] = useState<CompileResult | null>(null);
  const [busy, setBusy] = useState<null | 'audit' | 'compile' | 'zip' | 'advice'>(null);
  const [advice, setAdvice] = useState<VaultAnalysis | null>(null);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = <K extends keyof GenerateOptions>(k: K, v: GenerateOptions[K]) => {
    setOpts((o) => ({ ...o, [k]: v }));
    setEdited(null);
    setCompileState(null);
  };

  function selectPreset(p: Preset) {
    setOpts(PRESET_DEFAULTS[p]);
    setEdited(null);
    setAuditState(null);
    setCompileState(null);
    setAdvice(null);
    setAdviceError(null);
  }

  /** Reads Aave's live state and judges the vault settings against it. */
  async function runAdvice() {
    setBusy('advice');
    setAdviceError(null);
    try {
      setAdvice(await analyzeVault(opts));
      setAuditState(null);
    } catch (e) {
      setAdvice(null);
      setAdviceError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Takes the recommended value straight into the options. */
  function applyAdvice(a: SettingAdvice) {
    const num = a.recommended?.match(/\(([0-9]+)\)/)?.[1] ?? a.recommended?.match(/[0-9]+/)?.[0];
    if (!num) return;
    if (a.setting === 'depositCap') set('depositCap', num);
    if (a.setting === 'feeBps') set('feeBps', Number(num));
    if (a.setting === 'decimalsOffset') set('decimalsOffset', Number(num));
  }

  const noAccess = opts.access === 'none';
  const vault = opts.preset === 'aave-v3-erc4626-vault' || opts.preset === 'morpho-blue-vault';

  const result = useMemo(() => {
    try {
      const tests = assembleAttackTests(opts, SNIPPETS);
      return {
        contract: printPreset(opts),
        tests: tests.source,
        testNames: tests.testNames,
        deploy: printDeployScript(opts),
        applied: buildPreset(opts).appliedFindingIds,
        error: null as string | null,
      };
    } catch (e) {
      return {
        contract: '',
        tests: '',
        testNames: [] as string[],
        deploy: '',
        applied: [] as FindingId[],
        error: (e as Error).message,
      };
    }
  }, [opts]);

  const source = edited ?? result.contract;
  const shown = tab === 'contract' ? source : tab === 'tests' ? result.tests : result.deploy;

  async function runAudit() {
    setBusy('audit');
    try {
      setAuditState(await audit({ preset: opts.preset, source }));
    } catch {
      setAuditState(null);
    } finally {
      setBusy(null);
    }
  }

  async function runCompile() {
    setBusy('compile');
    setCompileState(null);
    try {
      const { result: r } = await compile({ contractName: opts.name, source });
      setCompileState(r);
    } catch (e) {
      setCompileState({ ok: false, errors: [{ severity: 'error', message: (e as Error).message }] });
    } finally {
      setBusy(null);
    }
  }

  async function downloadZip() {
    setBusy('zip');
    try {
      downloadBlob(await buildProjectZip(opts, SNIPPETS, result.applied), `${opts.name}.zip`);
    } finally {
      setBusy(null);
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden p-4">
      {/* Preset tabs + actions, mirroring the wizard's top row. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-4">
        <div className="flex gap-2">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <button
              key={p}
              className="btn lg"
              data-selected={opts.preset === p}
              onClick={() => selectPreset(p)}
            >
              {TAB_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button className="btn" onClick={copyCode}>
            {copied ? 'Copied' : 'Copy to Clipboard'}
          </button>
          <a
            className="btn no-underline"
            href={result.error ? undefined : remixUrl(source)}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!!result.error}
          >
            Open in Remix
          </a>
          <button className="btn" onClick={downloadZip} disabled={busy === 'zip' || !!result.error}>
            {busy === 'zip' ? 'Packaging…' : 'Download'}
          </button>
          <button
            className="btn"
            onClick={runCompile}
            disabled={busy === 'compile' || !!result.error}
          >
            {busy === 'compile' ? 'Compiling…' : 'Compile'}
          </button>
          <button
            className="btn primary"
            onClick={runAudit}
            disabled={busy === 'audit' || !!result.error}
          >
            {busy === 'audit' ? 'Auditing…' : 'Audit'}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Controls */}
        <aside
          className="card w-[336px] shrink-0 overflow-y-auto p-5"
        >
          <Group title="Settings">
            <Field label="Name">
              <input
                value={opts.name}
                onChange={(e) => set('name', e.target.value)}
                spellCheck={false}
                className="text-input text-[14.5px]"
              />
            </Field>
            <Field label="Underlying asset">
              <input
                value={opts.asset ?? ''}
                onChange={(e) => set('asset', e.target.value as `0x${string}`)}
                spellCheck={false}
                className="text-input text-[13px]"
              />
            </Field>
          </Group>

          <Group title="Features">
            <Toggle
              label="Pausable"
              checked={opts.pausable}
              disabled={noAccess}
              onChange={() => set('pausable', !opts.pausable)}
            />
            {!vault && (
              <Toggle
                label="Router allowlist"
                checked={opts.routerAllowlist}
                onChange={() => set('routerAllowlist', !opts.routerAllowlist)}
              />
            )}
            <Toggle
              label="Claim rewards"
              checked={opts.claimRewards}
              disabled={noAccess}
              onChange={() => set('claimRewards', !opts.claimRewards)}
            />
            <Toggle
              label="Sweep escape hatch"
              checked={opts.sweepEscapeHatch}
              disabled={noAccess}
              onChange={() => set('sweepEscapeHatch', !opts.sweepEscapeHatch)}
            />
            {noAccess && (
              <p className="pt-2 text-[14px] leading-snug text-[var(--text-faint)]">
                Each of these sends tokens to a caller-chosen address. Without access control
                they are the vulnerability, so they cannot be enabled.
              </p>
            )}
          </Group>

          {vault && (
            <Group title="Vault settings">
              <Field label="Deposit cap (raw units)">
                <input
                  value={opts.depositCap ?? ''}
                  onChange={(e) => set('depositCap', e.target.value || undefined)}
                  spellCheck={false}
                  className="text-input text-[13px]"
                />
              </Field>
              <Field label={`Performance fee — ${opts.feeBps ?? 0} bps`}>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={25}
                  value={opts.feeBps ?? 0}
                  onChange={(e) => set('feeBps', Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: 'var(--blue-2)' }}
                />
              </Field>
              <Field label={`Virtual share offset — ${opts.decimalsOffset ?? 6}`}>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={opts.decimalsOffset ?? 6}
                  onChange={(e) => set('decimalsOffset', Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: 'var(--blue-2)' }}
                />
              </Field>
              <button
                className="btn mt-1 w-full justify-center"
                onClick={runAdvice}
                disabled={busy === 'advice'}
              >
                {busy === 'advice' ? 'Reading Aave…' : 'Check against live Aave'}
              </button>
              {adviceError && (
                <p className="mt-2 text-[13px] leading-snug" style={{ color: 'var(--red-3)' }}>
                  {adviceError}
                </p>
              )}
            </Group>
          )}

          <Group title="Access Control">
            <div className="segmented">
              {(['none', 'ownable', 'roles'] as const).map((a) => (
                <button
                  key={a}
                  data-selected={opts.access === a}
                  disabled={vault && a === 'none'}
                  title={
                    vault && a === 'none'
                      ? 'A vault holds principal, so it always needs an owner.'
                      : undefined
                  }
                  onClick={() => {
                    setOpts((o) =>
                      a === 'none'
                        ? {
                            ...o,
                            access: a,
                            pausable: false,
                            claimRewards: false,
                            sweepEscapeHatch: false,
                          }
                        : { ...o, access: a },
                    );
                    setEdited(null);
                    setCompileState(null);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          </Group>

          <Group title={`Hardened against ${result.applied.length}`} last>
            {result.applied.map((id) => (
              <div key={id} className="flex items-start gap-2 py-[3px]" title={FINDING_TITLES[id]}>
                <span
                  className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: SEV_COLOR[SEVERITY_BY_FINDING[id]] }}
                />
                <span className="text-[14.5px] leading-snug text-[var(--text-muted)]">
                  <span className="font-mono text-[12px] text-[var(--text-faint)]">{id}</span>{' '}
                  {FINDING_TITLES[id]}
                </span>
              </div>
            ))}
          </Group>
        </aside>

        {/* Code */}
        <main
          className="card flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-soft)] p-3">
            {(
              [
                ['contract', `src/${opts.name}.sol`],
                ['tests', `Attack tests · ${result.testNames.length}`],
                ['deploy', 'Deploy script'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="btn"
                data-selected={tab === id}
              >
                {label}
              </button>
            ))}
            {edited !== null && (
              <button
                onClick={() => setEdited(null)}
                className="ml-auto text-[15px] text-[var(--blue-2)] hover:underline"
              >
                Edited · revert
              </button>
            )}
          </div>

          {compileState && (
            <Banner
              tone={compileState.ok ? 'ok' : 'bad'}
              onClose={() => setCompileState(null)}
            >
              {compileState.ok ? (
                <>
                  Compiled with solc {SOLC_VERSION} — {compileState.sizeBytes?.toLocaleString()}{' '}
                  bytes
                  {compileState.sizeBytes !== undefined &&
                    (compileState.sizeBytes < 24576
                      ? ' (within the 24,576 EIP-170 limit)'
                      : ' — over the 24,576 EIP-170 limit')}
                  , {compileState.abi?.length} ABI entries.
                </>
              ) : (
                <pre className="scroll overflow-x-auto whitespace-pre-wrap font-mono text-[12px]">
                  {compileState.errors
                    .filter((e) => e.severity === 'error')
                    .map((e) => e.message)
                    .join('\n\n') || 'Compilation failed.'}
                </pre>
              )}
            </Banner>
          )}

          <div className="min-h-0 flex-1">
            {result.error ? (
              <p className="p-6 font-mono text-[14px] text-[var(--red-3)]">{result.error}</p>
            ) : (
              <CodeEditor
                value={shown}
                readOnly={tab !== 'contract'}
                onChange={tab === 'contract' ? setEdited : undefined}
              />
            )}
          </div>
        </main>

        {advice && !auditState && (
          <VaultAdvicePanel
            analysis={advice}
            onApply={applyAdvice}
            onClose={() => setAdvice(null)}
          />
        )}

        {auditState && (
          <AuditPanel
            result={auditState.result}
            live={auditState.live}
            onClose={() => setAuditState(null)}
          />
        )}
      </div>
    </div>
  );
}

function Group({
  title,
  children,
  last = false,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? '' : 'mb-5 border-b border-[var(--border-soft)] pb-5'}>
      <h2 className="section-title mb-2.5">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block last:mb-0">
      <span className="mb-1.5 block text-[15px] text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 py-[5px] text-[16px] ${
        disabled ? 'cursor-not-allowed text-[var(--text-faint)]' : 'cursor-pointer'
      }`}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}

function Banner({
  tone,
  children,
  onClose,
}: {
  tone: 'ok' | 'bad';
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ok = tone === 'ok';
  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b px-4 py-3 text-[15px]"
      style={{
        background: ok ? 'var(--green-1)' : 'var(--red-1)',
        borderColor: ok ? '#c3e9d4' : '#f7caca',
        color: ok ? 'var(--green-2)' : 'var(--red-3)',
      }}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button onClick={onClose} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
        ×
      </button>
    </div>
  );
}
