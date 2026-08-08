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
  loading: () => <div className="p-6 font-mono text-xs text-[var(--faint)]">loading editor…</div>,
});

const SNIPPETS = snippetFile as unknown as AttackSnippetFile;

type Tab = 'contract' | 'tests' | 'deploy';

const SHORT_PRESET: Record<Preset, string> = {
  'aave-v3-flashloan-receiver': 'Flash loan receiver',
  'aave-v3-erc4626-vault': 'ERC-4626 vault',
};

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--crit)',
  high: '#d98d3f',
  medium: 'var(--accent)',
  low: '#7fa6c9',
};

export default function Home() {
  const [opts, setOpts] = useState<GenerateOptions>(PRESET_DEFAULTS['aave-v3-flashloan-receiver']);
  const [tab, setTab] = useState<Tab>('contract');
  const [edited, setEdited] = useState<string | null>(null);
  const [auditState, setAuditState] = useState<{ result: AuditResult; live: boolean } | null>(null);
  const [busy, setBusy] = useState<null | 'audit' | 'compile' | 'zip'>(null);
  const [compileState, setCompileState] = useState<CompileResult | null>(null);

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
  const path =
    tab === 'contract'
      ? `src/${opts.name}.sol`
      : tab === 'tests'
        ? `test/${opts.name}.attack.t.sol`
        : `script/${opts.name}.s.sol`;

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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-5 border-b border-[var(--line-soft)] px-4 py-2.5">
        <span className="font-mono text-[13px] font-medium tracking-tight">
          harness<span className="text-[var(--accent)]">/</span>
          <span className="text-[var(--muted)]">aave-v3</span>
        </span>
        <span className="hidden text-[11px] text-[var(--faint)] sm:block">
          Contracts that ship with the attacks on them.
        </span>
        <div className="ml-auto flex items-center gap-1">
          <GhostLink href={result.error ? undefined : remixUrl(source)}>Remix</GhostLink>
          <Ghost onClick={downloadZip} disabled={busy === 'zip' || !!result.error}>
            {busy === 'zip' ? 'packaging' : 'Download .zip'}
          </Ghost>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="scroll w-[286px] shrink-0 overflow-y-auto border-r border-[var(--line-soft)]">
          <Section title="preset">
            {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
              <Row key={p} active={opts.preset === p} onClick={() => selectPreset(p)}>
                {SHORT_PRESET[p]}
              </Row>
            ))}
          </Section>

          <Section title="name">
            <input
              value={opts.name}
              onChange={(e) => set('name', e.target.value)}
              spellCheck={false}
              className="w-full bg-transparent px-3 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none"
            />
          </Section>

          <Section title="asset">
            <input
              value={opts.asset ?? ''}
              onChange={(e) => set('asset', e.target.value as `0x${string}`)}
              spellCheck={false}
              className="w-full bg-transparent px-3 py-1.5 font-mono text-[11px] text-[var(--muted)] outline-none"
            />
          </Section>

          <Section title="access">
            <div className="flex px-3 py-1">
              {(['none', 'ownable', 'roles'] as const).map((a) => (
                <button
                  key={a}
                  disabled={vault && a === 'none'}
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
                  className={`mr-4 font-mono text-[11px] transition disabled:cursor-not-allowed disabled:opacity-25 ${
                    opts.access === a
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--faint)] hover:text-[var(--muted)]'
                  }`}
                >
                  {opts.access === a ? '▪ ' : '▫ '}
                  {a}
                </button>
              ))}
            </div>
          </Section>

          <Section title="options">
            <Check
              label="pausable"
              on={opts.pausable}
              disabled={noAccess}
              onClick={() => set('pausable', !opts.pausable)}
            />
            {!vault && (
              <Check
                label="router allowlist"
                on={opts.routerAllowlist}
                onClick={() => set('routerAllowlist', !opts.routerAllowlist)}
              />
            )}
            <Check
              label="claim rewards"
              on={opts.claimRewards}
              disabled={noAccess}
              onClick={() => set('claimRewards', !opts.claimRewards)}
            />
            <Check
              label="sweep hatch"
              on={opts.sweepEscapeHatch}
              disabled={noAccess}
              onClick={() => set('sweepEscapeHatch', !opts.sweepEscapeHatch)}
            />
            {noAccess && (
              <p className="px-3 pb-1 pt-2 text-[10.5px] leading-snug text-[var(--faint)]">
                Each of these hands tokens to a caller-chosen address. Ungated, they are the
                vulnerability.
              </p>
            )}
          </Section>

          <Section title={`hardened against ${result.applied.length}`} last>
            <div className="px-3 pb-3 pt-0.5">
              {result.applied.map((id) => (
                <div
                  key={id}
                  className="group flex items-baseline gap-2 py-[3px]"
                  title={FINDING_TITLES[id]}
                >
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-[1px]"
                    style={{ background: SEV_COLOR[SEVERITY_BY_FINDING[id]] }}
                  />
                  <span className="font-mono text-[10px] text-[var(--faint)]">{id}</span>
                  <span className="truncate text-[10.5px] text-[var(--faint)] opacity-0 transition group-hover:opacity-100">
                    {FINDING_TITLES[id]}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center border-b border-[var(--line-soft)]">
            {(
              [
                ['contract', 'contract'],
                ['tests', `attack tests · ${result.testNames.length}`],
                ['deploy', 'deploy'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative px-4 py-2 font-mono text-[11px] transition ${
                  tab === id ? 'text-[var(--text)]' : 'text-[var(--faint)] hover:text-[var(--muted)]'
                }`}
              >
                {label}
                {tab === id && (
                  <span className="absolute inset-x-3 -bottom-px h-px bg-[var(--accent)]" />
                )}
              </button>
            ))}

            <span className="ml-3 truncate font-mono text-[10px] text-[var(--faint)]">
              {result.error ? '' : path}
            </span>

            <div className="ml-auto flex items-center gap-1 pr-2">
              {edited !== null && (
                <button
                  onClick={() => setEdited(null)}
                  className="px-2 font-mono text-[10px] text-[var(--accent)] hover:underline"
                >
                  edited · revert
                </button>
              )}
              <Ghost onClick={runCompile} disabled={busy === 'compile' || !!result.error}>
                {busy === 'compile' ? 'compiling' : 'Compile'}
              </Ghost>
              <Ghost onClick={runAudit} disabled={busy === 'audit' || !!result.error} accent>
                {busy === 'audit' ? 'auditing' : 'Audit'}
              </Ghost>
            </div>
          </div>

          {compileState && (
            <div
              className="flex shrink-0 items-start gap-2.5 border-b px-4 py-2 font-mono text-[11px]"
              style={{
                borderColor: 'var(--line-soft)',
                color: compileState.ok ? 'var(--ok)' : 'var(--crit)',
                background: compileState.ok ? 'rgba(99,177,119,0.05)' : 'rgba(224,85,90,0.05)',
              }}
            >
              <span>{compileState.ok ? 'ok' : 'err'}</span>
              {compileState.ok ? (
                <span className="text-[var(--muted)]">
                  solc {SOLC_VERSION} · {compileState.sizeBytes?.toLocaleString()} bytes
                  {compileState.sizeBytes !== undefined &&
                    (compileState.sizeBytes < 24576
                      ? ' · within EIP-170'
                      : ' · EXCEEDS EIP-170 24,576')}{' '}
                  · {compileState.abi?.length} abi entries
                </span>
              ) : (
                <pre className="scroll flex-1 overflow-x-auto whitespace-pre-wrap">
                  {compileState.errors
                    .filter((e) => e.severity === 'error')
                    .map((e) => e.message)
                    .join('\n\n') || 'compilation failed'}
                </pre>
              )}
              <button
                onClick={() => setCompileState(null)}
                className="ml-auto text-[var(--faint)] hover:text-[var(--text)]"
              >
                ×
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1">
            {result.error ? (
              <p className="p-6 font-mono text-[12px] text-[var(--crit)]">{result.error}</p>
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

function Section({
  title,
  children,
  last = false,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? '' : 'border-b border-[var(--line-soft)]'}>
      <div className="label px-3 pb-1 pt-3">{title}</div>
      <div className="pb-2">{children}</div>
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition ${
        active
          ? 'bg-[var(--raised)] text-[var(--text)]'
          : 'text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]'
      }`}
    >
      <span className={active ? 'text-[var(--accent)]' : 'text-[var(--faint)]'}>
        {active ? '▪' : '▫'}
      </span>
      {children}
    </button>
  );
}

function Check({
  label,
  on,
  onClick,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-[5px] text-left font-mono text-[11px] transition disabled:cursor-not-allowed disabled:opacity-25 ${
        on ? 'text-[var(--text)]' : 'text-[var(--faint)] hover:text-[var(--muted)]'
      }`}
    >
      <span
        className="grid h-[11px] w-[11px] shrink-0 place-items-center rounded-[2px] border text-[8px] leading-none"
        style={{
          borderColor: on ? 'var(--accent)' : 'var(--line)',
          background: on ? 'var(--accent)' : 'transparent',
          color: 'var(--bg)',
        }}
      >
        {on ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}

function Ghost({
  onClick,
  disabled,
  children,
  accent = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[3px] border px-2.5 py-1 font-mono text-[11px] transition disabled:cursor-not-allowed disabled:opacity-30 ${
        accent
          ? 'border-[var(--accent-dim)] bg-[var(--accent-dim)] text-[var(--accent)] hover:brightness-125'
          : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--faint)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}

function GhostLink({ href, children }: { href?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`rounded-[3px] border border-[var(--line)] px-2.5 py-1 font-mono text-[11px] transition ${
        href
          ? 'text-[var(--muted)] hover:border-[var(--faint)] hover:text-[var(--text)]'
          : 'pointer-events-none opacity-30'
      }`}
    >
      {children}
    </a>
  );
}
