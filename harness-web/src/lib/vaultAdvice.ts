import type { GenerateOptions } from '@/types';

/** Shared between the analyser route and the panel that renders it. */

export type Verdict = 'ok' | 'warn' | 'bad';

export interface SettingAdvice {
  setting: 'depositCap' | 'feeBps' | 'decimalsOffset';
  label: string;
  verdict: Verdict;
  current: string;
  recommended?: string;
  finding?: string;
  detail: string;
}

/** One point on a setting's sweep: what the verdict would be at this value. */
export interface SweepPoint {
  value: number;
  label: string;
  verdict: Verdict;
  current?: boolean;
}

export interface SettingSweep {
  setting: SettingAdvice['setting'];
  label: string;
  points: SweepPoint[];
  /** Prose describing where the verdict flips — the frontier, not a point judgement. */
  frontier: string;
}

export interface VaultAnalysis {
  asset: { address: string; symbol: string; decimals: number };
  market: {
    /** Which protocol the numbers were read from, e.g. 'Aave v3' or 'Morpho Blue'. */
    protocol: string;
    /** Rendered, not numeric: Morpho Blue markets have no supply cap at all. */
    supplyCap: string;
    supplied: string;
    headroom: string;
    availableLiquidity: string;
    supplyApyPct: number;
    /** What the protocol itself takes off the top, before the vault's own fee. */
    protocolFeePct: number;
    /** Names that cut: Aave calls it a reserve factor, Morpho calls it a market fee. */
    protocolFeeLabel: string;
    frozen: boolean;
    paused: boolean;
    /** Facts that only one protocol has — LLTV and utilization for Morpho. */
    extra: { label: string; value: string }[];
  };
  advice: SettingAdvice[];
  sweeps: SettingSweep[];
}

export async function analyzeVault(opts: GenerateOptions): Promise<VaultAnalysis> {
  const res = await fetch('/api/vault-analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Analysis failed (${res.status})`);
  return body as VaultAnalysis;
}
