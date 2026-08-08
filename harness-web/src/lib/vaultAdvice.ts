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

export interface VaultAnalysis {
  asset: { address: string; symbol: string; decimals: number };
  market: {
    supplyCap: string;
    supplied: string;
    headroom: string;
    availableLiquidity: string;
    supplyApyPct: number;
    reserveFactorPct: number;
    frozen: boolean;
    paused: boolean;
  };
  advice: SettingAdvice[];
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
