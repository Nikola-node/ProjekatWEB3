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
  loading: () => <div className="p-6 text-[var(--gray-4)]">Loading editor…</div>,
});

const SNIPPETS = snippetFile as unknown as AttackSnippetFile;

type Tab = 'contract' | 'tests' | 'deploy';

const TAB_LABEL: Record<Preset, string> = {
  'aave-v3-flashloan-receiver': 'Flash Loan Receiver',
  'aave-v3-erc4626-vault': 'ERC-4626 Vault',
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
  const [busy, setBusy] = useState<null | 'audit' | 'compile' | 'zip'>(null);
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
  }

  const noAccess = opts.access === 'none';
  const vault = opts.preset === 'aave-v3-erc4626-vault';

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
        <div className="flex gap-1">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <button
              key={p}
              className="pill font-medium"
              data-selected={opts.preset === p}
              onClick={() => selectPreset(p)}
            >
              {TAB_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button className="action-button" onClick={copyCode}>
            {copied ? 'Copied' : 'Copy to Clipboard'}
          </button>
          <a
            className="action-button no-underline"
            href={result.error ? undefined : remixUrl(source)}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!!result.error}
          >
            Open in Remix
          </a>
          <button className="action-button" onClick={downloadZip} disabled={busy === 'zip' || !!result.error}>
            {busy === 'zip' ? 'Packaging…' : 'Download'}
          </button>
          <button
            className="action-button"
            onClick={runCompile}
            disabled={busy === 'compile' || !!result.error}
          >
            {busy === 'compile' ? 'Compiling…' : 'Compile'}
          </button>
          <button
            className="action-button primary"
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
          className="scroll w-[310px] shrink-0 overflow-y-auto rounded-lg bg-white p-5"
          style={{ boxShadow: 'var(--shadow)' }}
        >
          <Group title="Settings">
            <Field label="Name">
              <input
                value={opts.name}
                onChange={(e) => set('name', e.target.value)}
                spellCheck={false}
                className="w-full rounded border border-[var(--gray-3)] px-2.5 py-1.5 font-mono text-[14px] outline-none focus:border-[var(--blue-2)]"
              />
            </Field>
            <Field label="Underlying asset">
              <input
                value={opts.asset ?? ''}
                onChange={(e) => set('asset', e.target.value as `0x${string}`)}
                spellCheck={false}
                className="w-full rounded border border-[var(--gray-3)] px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-[var(--blue-2)]"
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
              <p className="pt-1.5 text-[13px] leading-snug text-[var(--gray-4)]">
                Each of these sends tokens to a caller-chosen address. Without access control
                they are the vulnerability, so they cannot be enabled.
              </p>
            )}
          </Group>

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
                <span className="text-[13.5px] leading-snug text-[var(--gray-5)]">
                  <span className="font-mono text-[12px] text-[var(--gray-4)]">{id}</span>{' '}
                  {FINDING_TITLES[id]}
                </span>
              </div>
            ))}
          </Group>
        </aside>

        {/* Code */}
        <main
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-white"
          style={{ boxShadow: 'var(--shadow)' }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gray-2)] px-3 py-2.5">
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
                className="file-tab"
                data-selected={tab === id}
              >
                {label}
              </button>
            ))}
            {edited !== null && (
              <button
                onClick={() => setEdited(null)}
                className="ml-auto text-[14px] text-[var(--blue-2)] hover:underline"
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
              <p className="p-6 font-mono text-[13px] text-[var(--red-3)]">{result.error}</p>
            ) : (
              <CodeEditor
                value={shown}
                readOnly={tab !== 'contract'}
                onChange={tab === 'contract' ? setEdited : undefined}
              />
            )}
          </div>
        </main>

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
    <section className={last ? '' : 'mb-5 border-b border-[var(--gray-2)] pb-5'}>
      <h2 className="section-title mb-2.5">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block last:mb-0">
      <span className="mb-1 block text-[14px] text-[var(--gray-5)]">{label}</span>
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
      className={`flex items-center gap-2.5 py-[5px] text-[15px] ${
        disabled ? 'cursor-not-allowed text-[var(--gray-4)]' : 'cursor-pointer'
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
      className="flex shrink-0 items-start gap-2 border-b px-4 py-2.5 text-[14px]"
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
