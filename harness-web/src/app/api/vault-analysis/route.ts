import { createPublicClient, http, formatUnits } from 'viem';

import { ADDRESS_RE, type GenerateOptions } from '@/types';
import type { SettingAdvice, SettingSweep, SweepPoint, VaultAnalysis, Verdict } from '@/lib/vaultAdvice';

/**
 * Vault settings advisor.
 *
 * A deposit cap, a fee and a virtual-share offset all have defensible answers
 * that depend on Aave's live state rather than on taste, so this reads that state
 * and turns each setting into a verdict instead of leaving the developer to guess.
 *
 * Read-only: it uses the Virtual Environment's public RPC and holds no keys.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const RPC =
  process.env.TENDERLY_PUBLIC_RPC ??
  'https://virtual.mainnet.eu.rpc.tenderly.co/petnica2026/project/harness-mainnet-1786200683168';

const DATA_PROVIDER = '0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD' as const;

const dataProviderAbi = [
  {
    name: 'getReserveCaps',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'borrowCap', type: 'uint256' },
      { name: 'supplyCap', type: 'uint256' },
    ],
  },
  {
    name: 'getReserveConfigurationData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'decimals', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'liquidationThreshold', type: 'uint256' },
      { name: 'liquidationBonus', type: 'uint256' },
      { name: 'reserveFactor', type: 'uint256' },
      { name: 'usageAsCollateralEnabled', type: 'bool' },
      { name: 'borrowingEnabled', type: 'bool' },
      { name: 'stableBorrowRateEnabled', type: 'bool' },
      { name: 'isActive', type: 'bool' },
      { name: 'isFrozen', type: 'bool' },
    ],
  },
  {
    name: 'getReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'unbacked', type: 'uint256' },
      { name: 'accruedToTreasuryScaled', type: 'uint256' },
      { name: 'totalAToken', type: 'uint256' },
      { name: 'totalStableDebt', type: 'uint256' },
      { name: 'totalVariableDebt', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'variableBorrowRate', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'averageStableBorrowRate', type: 'uint256' },
      { name: 'liquidityIndex', type: 'uint256' },
      { name: 'variableBorrowIndex', type: 'uint256' },
      { name: 'lastUpdateTimestamp', type: 'uint40' },
    ],
  },
  {
    name: 'getPaused',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{ name: 'isPaused', type: 'bool' }],
  },
] as const;

const fmt = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export async function POST(req: Request): Promise<Response> {
  let opts: GenerateOptions;
  try {
    opts = (await req.json()) as GenerateOptions;
  } catch {
    return json({ error: 'Malformed JSON body' }, 400);
  }

  const asset = opts.asset;
  if (!asset || !ADDRESS_RE.test(asset)) {
    return json({ error: 'A valid underlying asset address is required' }, 400);
  }

  const client = createPublicClient({ transport: http(RPC) });
  const base = { address: DATA_PROVIDER, abi: dataProviderAbi, args: [asset] } as const;

  let caps, cfg, rd, paused;
  try {
    [caps, cfg, rd, paused] = await Promise.all([
      client.readContract({ ...base, functionName: 'getReserveCaps' }),
      client.readContract({ ...base, functionName: 'getReserveConfigurationData' }),
      client.readContract({ ...base, functionName: 'getReserveData' }),
      client.readContract({ ...base, functionName: 'getPaused' }),
    ]);
  } catch (e) {
    return json(
      { error: `Could not read Aave state for ${asset}. Is it listed on this market? (${(e as Error).message.slice(0, 120)})` },
      502,
    );
  }

  const decimals = Number(cfg[0]);
  const reserveFactorPct = Number(cfg[4]) / 100;
  const frozen = cfg[9];
  // Caps are denominated in whole tokens; balances are not.
  const supplyCap = Number(caps[1]);
  const supplied = Number(formatUnits(rd[2], decimals));
  const variableDebt = Number(formatUnits(rd[4], decimals));
  const availableLiquidity = Math.max(supplied - variableDebt, 0);
  const headroom = Math.max(supplyCap - supplied, 0);
  const supplyApyPct = (Number(rd[5]) / 1e27) * 100;

  const advice: SettingAdvice[] = [
    adviseDepositCap(opts, decimals, headroom, availableLiquidity),
    adviseFee(opts, supplyApyPct, reserveFactorPct),
    adviseOffset(opts, decimals),
  ];

  // The advise* functions are pure given the market snapshot, so the same market
  // read supports evaluating neighbouring values — one RPC round trip, many
  // verdicts. That turns a point judgement into a frontier: not just "this is
  // wrong" but "it is fine up to here".
  const sweeps: SettingSweep[] = [
    sweepDepositCap(opts, decimals, headroom, availableLiquidity),
    sweepFee(opts, supplyApyPct, reserveFactorPct),
    sweepOffset(opts, decimals),
  ];

  const analysis: VaultAnalysis = {
    asset: { address: asset, symbol: symbolFor(asset), decimals },
    market: {
      supplyCap: fmt(supplyCap),
      supplied: fmt(supplied),
      headroom: fmt(headroom),
      availableLiquidity: fmt(availableLiquidity),
      supplyApyPct,
      reserveFactorPct,
      frozen,
      paused,
    },
    advice,
    sweeps,
  };

  return json(analysis, 200);
}

/**
 * Describes the band of sensible values. Direction-agnostic on purpose: a deposit
 * cap gets worse as it rises, a virtual-share offset gets worse as it falls, so
 * anything that assumes "higher is worse" is wrong for half the settings.
 */
function frontierOf(points: SweepPoint[], fmtValue: (n: number) => string): string {
  const okIdx = points.map((p, i) => (p.verdict === 'ok' ? i : -1)).filter((i) => i >= 0);
  if (okIdx.length === 0) return 'No value in this range is sensible against the current market.';
  if (okIdx.length === points.length) return 'Every value in this range is sensible.';

  const lo = points[okIdx[0]];
  const hi = points[okIdx[okIdx.length - 1]];
  const badBelow = okIdx[0] > 0;
  const badAbove = okIdx[okIdx.length - 1] < points.length - 1;

  if (badBelow && badAbove) {
    return `Sensible between ${fmtValue(lo.value)} and ${fmtValue(hi.value)}; outside that, reconsider.`;
  }
  if (badAbove) return `Sensible up to ${fmtValue(hi.value)}; above that, reconsider.`;
  return `Sensible from ${fmtValue(lo.value)} upward; below that, reconsider.`;
}

function sweepDepositCap(
  opts: GenerateOptions,
  decimals: number,
  headroom: number,
  availableLiquidity: number,
): SettingSweep {
  const current = opts.depositCap ? Number(opts.depositCap) / 10 ** decimals : null;
  const top = Math.max(headroom * 1.5, 1);
  const points: SweepPoint[] = Array.from({ length: 13 }, (_, i) => {
    const value = Math.round((top / 12) * i);
    const probe = { ...opts, depositCap: `${value}${'0'.repeat(decimals)}` };
    return {
      value,
      label: fmt(value),
      verdict: adviseDepositCap(probe, decimals, headroom, availableLiquidity).verdict,
    };
  });
  if (current !== null) markNearest(points, current);
  return {
    setting: 'depositCap',
    label: 'Deposit cap',
    points,
    frontier: frontierOf(points, (n) => fmt(n)),
  };
}

function sweepFee(opts: GenerateOptions, apy: number, rf: number): SettingSweep {
  const points: SweepPoint[] = Array.from({ length: 11 }, (_, i) => {
    const value = i * 100;
    return {
      value,
      label: `${value}`,
      verdict: adviseFee({ ...opts, feeBps: value }, apy, rf).verdict,
    };
  });
  markNearest(points, opts.feeBps ?? 0);
  return {
    setting: 'feeBps',
    label: 'Performance fee (bps)',
    points,
    frontier: frontierOf(points, (n) => `${n} bps`),
  };
}

function sweepOffset(opts: GenerateOptions, decimals: number): SettingSweep {
  const points: SweepPoint[] = Array.from({ length: 13 }, (_, i) => ({
    value: i,
    label: `${i}`,
    verdict: adviseOffset({ ...opts, decimalsOffset: i }, decimals).verdict,
  }));
  markNearest(points, opts.decimalsOffset ?? 6);
  return {
    setting: 'decimalsOffset',
    label: 'Virtual share offset',
    points,
    frontier: frontierOf(points, (n) => `offset ${n}`),
  };
}

/** Flags the swept point closest to what the user actually set. */
function markNearest(points: SweepPoint[], current: number): void {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].value - current) < Math.abs(points[best].value - current)) best = i;
  }
  points[best].current = true;
}

/**
 * A deposit cap above Aave's own remaining headroom is a promise the vault cannot
 * keep: deposits revert once the market fills, which is AAVE-RISK-010.
 */
function adviseDepositCap(
  opts: GenerateOptions,
  decimals: number,
  headroom: number,
  availableLiquidity: number,
): SettingAdvice {
  const raw = opts.depositCap;
  const capTokens = raw ? Number(raw) / 10 ** decimals : null;
  // Half the headroom leaves room for the rest of the market to keep depositing.
  const suggested = Math.max(Math.floor(headroom / 2), 0);
  // String maths rather than BigInt literals: the compile target predates ES2020.
  const suggestedRaw = suggested > 0 ? `${suggested}${'0'.repeat(decimals)}` : '0';

  if (capTokens === null) {
    return {
      setting: 'depositCap',
      label: 'Deposit cap',
      verdict: 'warn',
      current: 'unset',
      recommended: `${fmt(suggested)} (${suggestedRaw})`,
      finding: 'AAVE-RISK-010',
      detail:
        'With no cap the vault will keep accepting deposits after Aave stops accepting supply, and every deposit reverts from that point on.',
    };
  }

  if (capTokens > headroom) {
    return {
      setting: 'depositCap',
      label: 'Deposit cap',
      verdict: 'bad',
      current: `${fmt(capTokens)}`,
      recommended: `${fmt(suggested)} (${suggestedRaw})`,
      finding: 'AAVE-RISK-010',
      detail: `Your cap exceeds Aave's remaining headroom of ${fmt(headroom)}. Deposits revert once the market cap is reached, and the vault has no way to signal that in advance.`,
    };
  }

  if (capTokens > availableLiquidity) {
    return {
      setting: 'depositCap',
      label: 'Deposit cap',
      verdict: 'warn',
      current: `${fmt(capTokens)}`,
      recommended: `${fmt(Math.floor(availableLiquidity / 2))}`,
      finding: 'AAVE-VLT-004',
      detail: `Your cap fits under the supply cap but exceeds available liquidity of ${fmt(availableLiquidity)}. If depositors exit together, Aave cannot pay out in full and withdrawals revert until borrowers repay.`,
    };
  }

  return {
    setting: 'depositCap',
    label: 'Deposit cap',
    verdict: 'ok',
    current: `${fmt(capTokens)}`,
    detail: `Fits under Aave's headroom of ${fmt(headroom)} and current liquidity of ${fmt(availableLiquidity)}. Both move, so re-check before mainnet.`,
  };
}

/** The fee is taken on yield, and yield is already net of Aave's reserve factor. */
function adviseFee(
  opts: GenerateOptions,
  supplyApyPct: number,
  reserveFactorPct: number,
): SettingAdvice {
  const bps = opts.feeBps ?? 0;
  const takes = (supplyApyPct * bps) / 10000;
  const depositorsGet = supplyApyPct - takes;

  const verdict: Verdict = bps > 500 ? 'warn' : 'ok';
  return {
    setting: 'feeBps',
    label: 'Performance fee',
    verdict,
    current: `${bps} bps`,
    recommended: verdict === 'warn' ? '≤ 500 bps' : undefined,
    detail:
      `At the current ${supplyApyPct.toFixed(2)}% supply APY, ${bps} bps takes ${takes.toFixed(3)}% and leaves depositors ${depositorsGet.toFixed(3)}%. ` +
      `Aave has already taken a ${reserveFactorPct.toFixed(0)}% reserve factor before this point, so the fee compounds on an already-reduced yield.` +
      (verdict === 'warn'
        ? ' Above 500 bps the vault is hard to justify against holding the aToken directly.'
        : ''),
  };
}

/**
 * AAVE-VLT-003. The offset is the exponent on virtual shares: it multiplies what an
 * attacker must risk to win the empty-vault rounding attack.
 */
function adviseOffset(opts: GenerateOptions, decimals: number): SettingAdvice {
  const offset = opts.decimalsOffset ?? 6;
  const multiplier = 10 ** offset;

  if (offset === 0) {
    return {
      setting: 'decimalsOffset',
      label: 'Virtual share offset',
      verdict: 'bad',
      current: '0',
      recommended: decimals <= 8 ? '6' : '3',
      finding: 'AAVE-VLT-003',
      detail:
        'With no offset there are no virtual shares, and the first depositor into an empty vault can be front-run and have their deposit rounded away entirely. This is the PoolTogether bug.',
    };
  }

  if (offset < 3) {
    return {
      setting: 'decimalsOffset',
      label: 'Virtual share offset',
      verdict: 'warn',
      current: String(offset),
      recommended: decimals <= 8 ? '6' : '3',
      finding: 'AAVE-VLT-003',
      detail: `An attacker must donate roughly ${fmt(multiplier)}× the deposit they want to capture. That is affordable for a small first deposit. Raise the offset until the attack costs more than it can win.`,
    };
  }

  return {
    setting: 'decimalsOffset',
    label: 'Virtual share offset',
    verdict: 'ok',
    current: String(offset),
    detail: `Capturing a first deposit requires donating roughly ${fmt(multiplier)}× its size, which makes the rounding attack uneconomic. Share precision is ${decimals} + ${offset} = ${decimals + offset} decimals.`,
  };
}

const KNOWN: Record<string, string> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
};
const symbolFor = (a: string) => KNOWN[a.toLowerCase()] ?? 'token';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
