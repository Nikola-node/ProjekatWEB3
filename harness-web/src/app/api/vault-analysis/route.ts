import { createPublicClient, http, formatUnits } from 'viem';

import { MORPHO_MAINNET } from '@/generator/attacks/addresses';
import { ADDRESS_RE, type GenerateOptions } from '@/types';
import type { SettingAdvice, SettingSweep, SweepPoint, VaultAnalysis, Verdict } from '@/lib/vaultAdvice';

/**
 * Vault settings advisor.
 *
 * A deposit cap, a fee and a virtual-share offset all have defensible answers
 * that depend on the lending market's live state rather than on taste, so this
 * reads that state and turns each setting into a verdict instead of leaving the
 * developer to guess.
 *
 * Two protocols, one set of advisors. Everything protocol-specific is confined to
 * reading a MarketSnapshot; the advice and the sweeps then work off that snapshot
 * and do not know which lending market produced it. The one place the difference
 * genuinely leaks is the deposit cap: Aave has a supply cap to fit under, and
 * Morpho Blue has no cap at all, so the advice there branches explicitly rather
 * than pretending Morpho has a headroom of infinity.
 *
 * Read-only: it uses the Virtual Environment's public RPC and holds no keys.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const RPC =
  process.env.TENDERLY_PUBLIC_RPC ??
  'https://virtual.mainnet.eu.rpc.tenderly.co/petnica2026/project/harness-mainnet-1786200683168';

const DATA_PROVIDER = '0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD' as const;
const SECONDS_PER_YEAR = 31_536_000;

/**
 * What every advisor needs, with nothing protocol-specific left in it.
 *
 * `supplyCap` and `headroom` are nullable because Morpho Blue markets are
 * uncapped — the only ceiling is liquidity. Making them `number` and passing
 * Infinity would have compiled, and would have quietly told every Morpho user
 * their deposit cap was fine.
 */
interface MarketSnapshot {
  protocol: string;
  decimals: number;
  supplied: number;
  availableLiquidity: number;
  supplyCap: number | null;
  headroom: number | null;
  supplyApyPct: number;
  protocolFeePct: number;
  protocolFeeLabel: string;
  frozen: boolean;
  paused: boolean;
  extra: { label: string; value: string }[];
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

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

  let snap: MarketSnapshot;
  try {
    snap =
      opts.preset === 'morpho-blue-vault'
        ? await readMorphoMarket(client, asset)
        : await readAaveMarket(client, asset);
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg.startsWith('ADVISOR:') ? msg.slice(8).trim() : `Could not read market state for ${asset}. (${msg.slice(0, 140)})` }, 502);
  }

  const advice: SettingAdvice[] = [
    adviseDepositCap(opts, snap),
    adviseFee(opts, snap),
    adviseOffset(opts, snap),
  ];

  // The advise* functions are pure given the market snapshot, so the same market
  // read supports evaluating neighbouring values — one RPC round trip, many
  // verdicts. That turns a point judgement into a frontier: not just "this is
  // wrong" but "it is fine up to here".
  const sweeps: SettingSweep[] = [
    sweepDepositCap(opts, snap),
    sweepFee(opts, snap),
    sweepOffset(opts, snap),
  ];

  const analysis: VaultAnalysis = {
    asset: { address: asset, symbol: symbolFor(asset), decimals: snap.decimals },
    market: {
      protocol: snap.protocol,
      supplyCap: snap.supplyCap === null ? 'no cap' : fmt(snap.supplyCap),
      supplied: fmt(snap.supplied),
      headroom: snap.headroom === null ? 'uncapped' : fmt(snap.headroom),
      availableLiquidity: fmt(snap.availableLiquidity),
      supplyApyPct: snap.supplyApyPct,
      protocolFeePct: snap.protocolFeePct,
      protocolFeeLabel: snap.protocolFeeLabel,
      frozen: snap.frozen,
      paused: snap.paused,
      extra: snap.extra,
    },
    advice,
    sweeps,
  };

  return json(analysis, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const KNOWN: Record<string, string> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
};
const symbolFor = (a: string) => KNOWN[a.toLowerCase()] ?? 'token';

// ---------------------------------------------------------------------------
// Protocol readers. The only code that knows which lending market it is talking to.
// ---------------------------------------------------------------------------

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

type Client = ReturnType<typeof createPublicClient>;

async function readAaveMarket(client: Client, asset: `0x${string}`): Promise<MarketSnapshot> {
  const base = { address: DATA_PROVIDER, abi: dataProviderAbi, args: [asset] } as const;
  const [caps, cfg, rd, paused] = await Promise.all([
    client.readContract({ ...base, functionName: 'getReserveCaps' }),
    client.readContract({ ...base, functionName: 'getReserveConfigurationData' }),
    client.readContract({ ...base, functionName: 'getReserveData' }),
    client.readContract({ ...base, functionName: 'getPaused' }),
  ]);

  const decimals = Number(cfg[0]);
  // Caps are denominated in whole tokens; balances are not.
  const supplyCap = Number(caps[1]);
  const supplied = Number(formatUnits(rd[2], decimals));
  const variableDebt = Number(formatUnits(rd[4], decimals));

  return {
    protocol: 'Aave v3',
    decimals,
    supplied,
    availableLiquidity: Math.max(supplied - variableDebt, 0),
    supplyCap,
    headroom: Math.max(supplyCap - supplied, 0),
    supplyApyPct: (Number(rd[5]) / 1e27) * 100,
    protocolFeePct: Number(cfg[4]) / 100,
    protocolFeeLabel: 'Reserve factor',
    frozen: cfg[9],
    paused,
    extra: [],
  };
}

const morphoAbi = [
  {
    name: 'market',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' },
    ],
  },
  {
    name: 'idToMarketParams',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ],
  },
] as const;

const irmAbi = [
  {
    name: 'borrowRateView',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'marketParams',
        type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
      {
        name: 'market',
        type: 'tuple',
        components: [
          { name: 'totalSupplyAssets', type: 'uint128' },
          { name: 'totalSupplyShares', type: 'uint128' },
          { name: 'totalBorrowAssets', type: 'uint128' },
          { name: 'totalBorrowShares', type: 'uint128' },
          { name: 'lastUpdate', type: 'uint128' },
          { name: 'fee', type: 'uint128' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const erc20Abi = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

/**
 * Morpho Blue. Three things differ from Aave and each one changes the advice:
 *
 *   - there is no supply cap, so the only ceiling on a deposit is liquidity;
 *   - the market is the hash of its parameters, so the vault's asset MUST be the
 *     pinned market's loan token — otherwise we would be advising on a market the
 *     generated contract never touches (MRPH-MKT-018);
 *   - the supply rate is not stored. It is derived: borrow rate from the IRM,
 *     scaled by utilisation, less the market fee.
 */
async function readMorphoMarket(client: Client, asset: `0x${string}`): Promise<MarketSnapshot> {
  const id = MORPHO_MAINNET.MARKET_ID as `0x${string}`;
  const base = { address: MORPHO_MAINNET.MORPHO as `0x${string}`, abi: morphoAbi, args: [id] } as const;

  const [mkt, params] = await Promise.all([
    client.readContract({ ...base, functionName: 'market' }),
    client.readContract({ ...base, functionName: 'idToMarketParams' }),
  ]);

  const [loanToken, collateralToken, , irm, lltv] = params;
  if (loanToken.toLowerCase() !== asset.toLowerCase()) {
    throw new Error(
      `ADVISOR: This vault's asset is ${symbolFor(asset)}, but the pinned Morpho market lends ${symbolFor(loanToken)}. ` +
        'A Morpho market is the hash of its five parameters (MRPH-MKT-018), so a different asset is a different market — ' +
        'there is nothing to advise on until the market is repinned.',
    );
  }

  const decimals = Number(
    await client.readContract({ address: loanToken, abi: erc20Abi, functionName: 'decimals' }),
  );

  const borrowRatePerSecond = await client.readContract({
    address: irm,
    abi: irmAbi,
    functionName: 'borrowRateView',
    args: [
      { loanToken, collateralToken, oracle: params[2], irm, lltv },
      {
        totalSupplyAssets: mkt[0],
        totalSupplyShares: mkt[1],
        totalBorrowAssets: mkt[2],
        totalBorrowShares: mkt[3],
        lastUpdate: mkt[4],
        fee: mkt[5],
      },
    ],
  });

  const supplied = Number(formatUnits(mkt[0], decimals));
  const borrowed = Number(formatUnits(mkt[2], decimals));
  const utilization = supplied === 0 ? 0 : borrowed / supplied;
  const feePct = Number(mkt[5]) / 1e18;

  // Morpho compounds continuously (wTaylorCompounded), so expm1 of the annualised
  // per-second rate is the APY rather than an approximation of it.
  const borrowApy = Math.expm1((Number(borrowRatePerSecond) / 1e18) * SECONDS_PER_YEAR);
  const supplyApyPct = borrowApy * utilization * (1 - feePct) * 100;

  return {
    protocol: 'Morpho Blue',
    decimals,
    supplied,
    availableLiquidity: Math.max(supplied - borrowed, 0),
    // Not a large cap — no cap. Morpho Blue markets are uncapped by design.
    supplyCap: null,
    headroom: null,
    supplyApyPct,
    protocolFeePct: feePct * 100,
    protocolFeeLabel: 'Market fee',
    // Morpho markets cannot be frozen or paused: there is no admin that can do it.
    frozen: false,
    paused: false,
    extra: [
      { label: 'Utilisation', value: `${(utilization * 100).toFixed(1)}%` },
      { label: 'LLTV', value: `${(Number(lltv) / 1e16).toFixed(0)}%` },
      { label: 'Collateral', value: symbolFor(collateralToken) },
      { label: 'Borrowed', value: fmt(borrowed) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Advisors. Protocol-agnostic: everything they need is on the snapshot.
// ---------------------------------------------------------------------------

/**
 * A deposit cap the market cannot honour is a promise the vault cannot keep.
 *
 * On Aave that means fitting under the supply cap (AAVE-RISK-010): deposits
 * revert outright once the market fills. Morpho has no cap, so the binding
 * constraint is liquidity instead — the vault will accept the deposit and only
 * fail on the way out, which is the quieter and later failure of the two.
 */
function adviseDepositCap(opts: GenerateOptions, snap: MarketSnapshot): SettingAdvice {
  const { decimals, headroom, availableLiquidity } = snap;
  const capTokens = opts.depositCap ? Number(opts.depositCap) / 10 ** decimals : null;
  const label = 'Deposit cap';
  const setting = 'depositCap' as const;

  // Aave: half the headroom leaves room for the rest of the market to keep
  // depositing. Morpho: half the free liquidity, for the same reason applied to
  // the only ceiling that exists.
  const ceiling = headroom ?? availableLiquidity;
  const suggested = Math.max(Math.floor(ceiling / 2), 0);
  const suggestedRaw = suggested > 0 ? `${suggested}${'0'.repeat(decimals)}` : '0';
  const recommended = `${fmt(suggested)} (${suggestedRaw})`;

  if (capTokens === null) {
    return {
      setting,
      label,
      verdict: 'warn',
      current: 'unset',
      recommended,
      finding: headroom === null ? 'AAVE-VLT-004' : 'AAVE-RISK-010',
      detail:
        headroom === null
          ? `Morpho Blue has no supply cap, so an uncapped vault will keep taking deposits into a single market with ${fmt(availableLiquidity)} of free liquidity. Nothing reverts on the way in; the concentration only shows up when depositors try to leave together.`
          : 'With no cap the vault will keep accepting deposits after Aave stops accepting supply, and every deposit reverts from that point on.',
    };
  }

  if (headroom !== null && capTokens > headroom) {
    return {
      setting,
      label,
      verdict: 'bad',
      current: fmt(capTokens),
      recommended,
      finding: 'AAVE-RISK-010',
      detail: `Your cap exceeds Aave's remaining headroom of ${fmt(headroom)}. Deposits revert once the market cap is reached, and the vault has no way to signal that in advance.`,
    };
  }

  if (capTokens > availableLiquidity) {
    return {
      setting,
      label,
      verdict: headroom === null ? 'bad' : 'warn',
      current: fmt(capTokens),
      recommended: fmt(Math.floor(availableLiquidity / 2)),
      finding: 'AAVE-VLT-004',
      detail:
        headroom === null
          ? `Your cap exceeds the market's free liquidity of ${fmt(availableLiquidity)} — and Morpho has no cap to stop you reaching it. Once the vault holds more than the market can release, withdrawals revert until borrowers repay, and the vault has no second market to fall back on.`
          : `Your cap fits under the supply cap but exceeds available liquidity of ${fmt(availableLiquidity)}. If depositors exit together, Aave cannot pay out in full and withdrawals revert until borrowers repay.`,
    };
  }

  return {
    setting,
    label,
    verdict: 'ok',
    current: fmt(capTokens),
    detail:
      headroom === null
        ? `Fits inside the market's free liquidity of ${fmt(availableLiquidity)}. Morpho has no supply cap, so liquidity is the only ceiling — and it moves, so re-check before mainnet.`
        : `Fits under Aave's headroom of ${fmt(headroom)} and current liquidity of ${fmt(availableLiquidity)}. Both move, so re-check before mainnet.`,
  };
}

/** The fee is taken on yield, and yield is already net of the protocol's own cut. */
function adviseFee(opts: GenerateOptions, snap: MarketSnapshot): SettingAdvice {
  const bps = opts.feeBps ?? 0;
  const takes = (snap.supplyApyPct * bps) / 10000;
  const depositorsGet = snap.supplyApyPct - takes;
  const verdict: Verdict = bps > 500 ? 'warn' : 'ok';

  const alreadyTaken =
    snap.protocolFeePct > 0
      ? `${snap.protocol} has already taken a ${snap.protocolFeePct.toFixed(0)}% ${snap.protocolFeeLabel.toLowerCase()} before this point, so the fee compounds on an already-reduced yield.`
      : `${snap.protocol} currently takes no ${snap.protocolFeeLabel.toLowerCase()} on this market, so your fee is the only one depositors pay — but the market fee is governable and can be turned on without asking you.`;

  return {
    setting: 'feeBps',
    label: 'Performance fee',
    verdict,
    current: `${bps} bps`,
    recommended: verdict === 'warn' ? '≤ 500 bps' : undefined,
    detail:
      `At the current ${snap.supplyApyPct.toFixed(2)}% supply APY, ${bps} bps takes ${takes.toFixed(3)}% and leaves depositors ${depositorsGet.toFixed(3)}%. ` +
      alreadyTaken +
      (verdict === 'warn'
        ? ' Above 500 bps the vault is hard to justify against supplying to the market directly.'
        : ''),
  };
}

/**
 * AAVE-VLT-003. The offset is the exponent on virtual shares: it multiplies what an
 * attacker must risk to win the empty-vault rounding attack. Protocol-independent —
 * this is an ERC-4626 property, not a lending-market one.
 */
function adviseOffset(opts: GenerateOptions, snap: MarketSnapshot): SettingAdvice {
  const offset = opts.decimalsOffset ?? 6;
  const multiplier = 10 ** offset;
  const setting = 'decimalsOffset' as const;
  const label = 'Virtual share offset';
  const recommended = snap.decimals <= 8 ? '6' : '3';

  if (offset === 0) {
    return {
      setting,
      label,
      verdict: 'bad',
      current: '0',
      recommended,
      finding: 'AAVE-VLT-003',
      detail:
        'With no offset there are no virtual shares, and the first depositor into an empty vault can be front-run and have their deposit rounded away entirely. This is the PoolTogether bug.',
    };
  }

  if (offset < 3) {
    return {
      setting,
      label,
      verdict: 'warn',
      current: String(offset),
      recommended,
      finding: 'AAVE-VLT-003',
      detail: `An attacker must donate roughly ${fmt(multiplier)}× the deposit they want to capture. That is affordable for a small first deposit. Raise the offset until the attack costs more than it can win.`,
    };
  }

  return {
    setting,
    label,
    verdict: 'ok',
    current: String(offset),
    detail: `Capturing a first deposit requires donating roughly ${fmt(multiplier)}× its size, which makes the rounding attack uneconomic. Share precision is ${snap.decimals} + ${offset} = ${snap.decimals + offset} decimals.`,
  };
}

// ---------------------------------------------------------------------------
// Sweeps. Same advisors, evaluated across a range, off the one market read.
// ---------------------------------------------------------------------------

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

function sweepDepositCap(opts: GenerateOptions, snap: MarketSnapshot): SettingSweep {
  const { decimals } = snap;
  const current = opts.depositCap ? Number(opts.depositCap) / 10 ** decimals : null;
  // Sweep past whichever ceiling actually binds, so the frontier is visible rather
  // than sitting off the right-hand edge of the strip.
  const ceiling = snap.headroom ?? snap.availableLiquidity;
  const top = Math.max(ceiling * 1.5, 1);

  const points: SweepPoint[] = Array.from({ length: 13 }, (_, i) => {
    const value = Math.round((top / 12) * i);
    const probe = { ...opts, depositCap: `${value}${'0'.repeat(decimals)}` };
    return { value, label: fmt(value), verdict: adviseDepositCap(probe, snap).verdict };
  });
  if (current !== null) markNearest(points, current);

  return {
    setting: 'depositCap',
    label: 'Deposit cap',
    points,
    frontier: frontierOf(points, (n) => fmt(n)),
  };
}

function sweepFee(opts: GenerateOptions, snap: MarketSnapshot): SettingSweep {
  const points: SweepPoint[] = Array.from({ length: 11 }, (_, i) => {
    const value = i * 100;
    return { value, label: `${value}`, verdict: adviseFee({ ...opts, feeBps: value }, snap).verdict };
  });
  markNearest(points, opts.feeBps ?? 0);

  return {
    setting: 'feeBps',
    label: 'Performance fee (bps)',
    points,
    frontier: frontierOf(points, (n) => `${n} bps`),
  };
}

function sweepOffset(opts: GenerateOptions, snap: MarketSnapshot): SettingSweep {
  const points: SweepPoint[] = Array.from({ length: 13 }, (_, i) => ({
    value: i,
    label: `${i}`,
    verdict: adviseOffset({ ...opts, decimalsOffset: i }, snap).verdict,
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
