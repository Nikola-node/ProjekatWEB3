import { FINDING_IDS, type AuditResult, type Finding, type Preset } from '@/types';

/**
 * ██ MOCK OF AGENT B's /audit ██
 *
 * Agent B owns the real corpus (`harness-api/knowledge/findings.json`, task B3) and
 * the rule engine (task B5). This file exists so Agent A's UI is not blocked on
 * either, per §5.6 — it is deleted at h10 when API_BASE points at the real service.
 *
 * The detect rules use the same `Finding.detect` shape as the real corpus, so the
 * UI is exercising the production data model rather than a convenient fake.
 */

const FLASHLOAN: Preset[] = ['aave-v3-flashloan-receiver'];
const VAULT: Preset[] = ['aave-v3-erc4626-vault'];
const BOTH: Preset[] = ['aave-v3-flashloan-receiver', 'aave-v3-erc4626-vault'];
const MORPHO: Preset[] = ['morpho-blue-vault'];
/** Both vaults. Separate from BOTH because a vault finding is not a flash-loan finding. */
const ANY_VAULT: Preset[] = ['aave-v3-erc4626-vault', 'morpho-blue-vault'];
/** Every preset. Only for findings that are about Solidity, not about a protocol. */
const ALL: Preset[] = [...BOTH, 'morpho-blue-vault'];

export const MOCK_FINDINGS: Finding[] = [
  {
    id: FINDING_IDS.FLASHLOAN_CALLBACK_UNGATED,
    title: 'Flash-loan callback not gated to Pool + initiator',
    severity: 'critical',
    vulnClasses: ['vuln/access-control/missing-auth', 'vuln/logic/missing-check'],
    summary:
      'Anyone can call Pool.flashLoan naming your contract as receiver, so Aave invokes your callback for them.',
    detail:
      'Checking msg.sender == Pool is not sufficient, because the Pool genuinely is the caller. The loan must additionally be one this contract initiated, which means asserting initiator == address(this). Without that second gate an attacker drives your callback with parameters of their choosing.',
    incidents: [
      {
        name: 'DODO MarginTrading (Sherlock #150)',
        url: 'https://github.com/sherlock-audit/2023-01-derby-judging/issues/150',
        pocFolder: '2021-03-dodo_flashloan_exp',
      },
      {
        name: 'Mimo SuperVault (Code4rena H-02)',
        url: 'https://code4rena.com/reports/2022-08-mimo',
      },
    ],
    detect: [{ kind: 'absence', pattern: 'revert NotSelfInitiated', appliesTo: FLASHLOAN }],
    remediation:
      'Revert unless msg.sender == address(POOL) AND initiator == address(this).',
  },
  {
    id: FINDING_IDS.FLASHLOAN_ATTACKER_PARAMS,
    title: 'Attacker-controlled calldata executed from callback params',
    severity: 'critical',
    vulnClasses: ['vuln/dependency/unsafe-external-call', 'vuln/input-validation/missing-validation'],
    summary:
      'Decoding `params` into a call target turns an ungated callback from a revert into a drain.',
    detail:
      'The common tutorial pattern decodes params as (address target, bytes data) and calls it, often after approving the target for the full balance. Decoding into a fixed struct with no bytes payload and no address-to-call removes the primitive entirely.',
    incidents: [
      {
        name: 'Mimo SuperVault aggregatorSwap(dexTxData)',
        url: 'https://code4rena.com/reports/2022-08-mimo',
      },
    ],
    detect: [{ kind: 'regex', pattern: '\\.call\\{?[^}]*\\}?\\(', appliesTo: FLASHLOAN }],
    remediation: 'Decode params into a strictly typed struct. Never derive a call target from it.',
  },
  {
    id: FINDING_IDS.UNCHECKED_EXTERNAL_CALL,
    title: 'Unchecked external call return value',
    severity: 'medium',
    vulnClasses: ['vuln/dependency/unchecked-return-value'],
    summary:
      'Non-standard ERC20s return false rather than reverting, so a bare transfer can silently do nothing.',
    detail:
      'USDT and others do not return a bool at all. SafeERC20 normalises both cases; a raw transfer or approve does not, and the failure is silent.',
    incidents: [
      {
        name: 'vuln/dependency/unchecked-return-value — 74 tagged PoCs',
        url: 'https://github.com/sanbir/evm-hack-registry',
      },
    ],
    detect: [{ kind: 'absence', pattern: 'using SafeERC20', appliesTo: ALL }],
    remediation: 'Route every token interaction through SafeERC20.',
  },
  {
    id: FINDING_IDS.VAULT_ATOKEN_BALANCE_DENOMINATOR,
    title: 'aToken.balanceOf used as share-price denominator',
    severity: 'critical',
    vulnClasses: ['vuln/arithmetic/rounding', 'vuln/defi/fee-manipulation'],
    summary:
      'aTokens are freely transferable, so a donation moves the share price without touching Aave.',
    detail:
      'A vault whose totalAssets() reads its own aToken balance can be inflated by anyone willing to send it aTokens. Because no protocol interaction is required, the usual "attacker must first deposit" reasoning does not apply. Internal accounting plus a decimals offset closes both the donation and the empty-vault rounding attack.',
    incidents: [
      {
        name: 'PoolTogether AaveV3YieldSource (Code4rena H-01)',
        url: 'https://code4rena.com/reports/2022-06-poolTogether',
      },
      {
        name: 'Thetanuts vault share rounding',
        url: 'https://github.com/sanbir/evm-hack-registry',
        pocFolder: '2026-04-ThetanutsVaultShareRounding_exp',
      },
    ],
    detect: [
      {
        kind: 'regex',
        pattern: 'return ATOKEN\\.balanceOf\\(address\\(this\\)\\)',
        appliesTo: VAULT,
      },
      { kind: 'absence', pattern: '_decimalsOffset', appliesTo: ANY_VAULT },
    ],
    remediation:
      'Track assets internally and override _decimalsOffset() to a non-zero value.',
  },
  {
    id: FINDING_IDS.VAULT_WITHDRAW_RETURN_IGNORED,
    title: 'Aave withdraw() return value ignored',
    severity: 'high',
    vulnClasses: ['vuln/logic/state-update', 'vuln/dependency/unchecked-return-value'],
    summary:
      'Aave returns the amount actually withdrawn, which is less than requested when the reserve is constrained.',
    detail:
      'A capped, frozen, paused or simply illiquid reserve pays out less than asked. Booking the requested figure credits assets that were never received, and the shortfall is discovered by whoever exits last.',
    incidents: [
      { name: 'Connext Amarok (Code4rena M-15)', url: 'https://code4rena.com/reports/2022-06-connext' },
    ],
    detect: [
      { kind: 'absence', pattern: 'POOL\.withdraw', appliesTo: VAULT },
      // Morpho's withdraw returns (assetsWithdrawn, sharesWithdrawn) for the same reason.
      { kind: 'absence', pattern: 'MORPHO\.withdraw', appliesTo: MORPHO },
    ],
    remediation: 'Use the uint256 that withdraw() returns, never the amount requested.',
  },
  {
    id: FINDING_IDS.VAULT_RECEIVER_OWNER_CONFLATED,
    title: 'ERC-4626 receiver and owner conflated',
    severity: 'medium',
    vulnClasses: ['vuln/access-control/missing-auth', 'vuln/logic/state-update'],
    summary: 'redeem(shares, receiver, owner) burns from owner and pays receiver; mixing them steals.',
    detail:
      'Overriding the public entry points rather than the internal _deposit/_withdraw hooks is the usual way this gets broken, because the caller/receiver/owner split is re-implemented by hand.',
    incidents: [
      { name: 'Taichi ERC-4626 series, Pt.5', url: 'https://docs.openzeppelin.com/contracts/5.x/erc4626' },
    ],
    detect: [
      {
        kind: 'absence',
        pattern: 'super\\._withdraw\\(caller, receiver, owner',
        appliesTo: ANY_VAULT,
      },
    ],
    remediation: 'Override _deposit/_withdraw and delegate to super with the arguments unchanged.',
  },
  {
    id: FINDING_IDS.FLASHLOAN_IDLE_FUNDS,
    title: 'Idle funds held on the flash-loan receiver',
    severity: 'medium',
    vulnClasses: ['vuln/logic/missing-check'],
    summary:
      "A balance left on the receiver is repayment for somebody else's flash loan.",
    detail:
      "An attacker initiates a loan naming your contract as receiver and simply lets your balance cover principal and premium. Aave's own documentation warns about this directly. Gating initiation and holding no balance between calls are the mitigations.",
    incidents: [
      {
        name: 'Aave flash-loan documentation; ESE 92391',
        url: 'https://aave.com/docs/developers/smart-contracts/flash-loans',
      },
    ],
    // Both detect kinds are compiled with `new RegExp`, so a literal that contains
    // regex metacharacters has to be escaped. Unescaped, `address(this)` matches
    // "addressthis" and the finding fires on a contract that does mitigate it.
    detect: [
      { kind: 'absence', pattern: 'initiator != address\\(this\\)', appliesTo: FLASHLOAN },
    ],
    remediation:
      'Restrict initiation and do not leave the underlying on the receiver between loans.',
  },
  {
    id: FINDING_IDS.SWAP_MISSING_MIN_AMOUNT_OUT,
    title: 'Missing minAmountOut on the swap leg',
    severity: 'high',
    vulnClasses: ['vuln/defi/slippage', 'vuln/defi/sandwich'],
    summary: 'A swap with no floor on output is a free sandwich for any searcher.',
    detail:
      'Slippage is the single most tagged DeFi class in the exploit corpus at 120 instances. A caller-supplied minAmountOut that is never checked against zero is equivalent to having none at all.',
    incidents: [
      {
        name: 'vuln/defi/slippage — 120 tagged PoCs',
        url: 'https://github.com/sanbir/evm-hack-registry',
      },
    ],
    detect: [{ kind: 'absence', pattern: 'MissingSlippageBound', appliesTo: FLASHLOAN }],
    remediation: 'Require a non-zero minAmountOut and enforce it against the amount received.',
  },
  {
    id: FINDING_IDS.RISK_CAPS_AND_PAUSE_REVERTS,
    title: 'Supply/borrow cap and pause reverts unhandled',
    severity: 'medium',
    vulnClasses: ['vuln/logic/missing-check', 'vuln/dos/frozen-funds'],
    summary:
      'Aave reverts when a reserve is capped, frozen or paused, and callers that assume otherwise brick.',
    detail:
      'Supply and borrow caps, freeze and pause flags all cause the Pool to revert mid-flow. A leverage loop that does not anticipate this leaves partial state behind. A local pause lets an operator stop cleanly rather than discover the condition inside a loan.',
    incidents: [
      {
        name: 'Sherlock Index #267',
        url: 'https://github.com/sherlock-audit/2023-01-index-judging/issues/267',
      },
    ],
    detect: [{ kind: 'absence', pattern: 'whenNotPaused', appliesTo: ALL }],
    remediation: 'Add a local pause and handle Aave reverts as an expected condition.',
  },
  {
    id: FINDING_IDS.VAULT_NO_ESCAPE_HATCH,
    title: 'No ERC20 escape hatch for airdrops / stuck tokens',
    severity: 'medium',
    vulnClasses: ['vuln/dos/frozen-funds'],
    summary: 'Merkl rewards, airdrops and dust arrive unannounced and are stuck without a hatch.',
    detail:
      'The hatch itself must be access-controlled and, on a vault, must exclude the principal — otherwise the recovery function is the vulnerability.',
    incidents: [
      {
        name: 'Morpho integration checklist',
        url: 'https://docs.morpho.org/overview/resources/audits/',
      },
    ],
    detect: [{ kind: 'absence', pattern: 'function sweep', appliesTo: ALL }],
    remediation: 'Add a gated sweep that cannot touch principal.',
  },
  {
    id: FINDING_IDS.VAULT_REWARDS_UNCLAIMABLE,
    title: 'RewardsController rewards permanently unclaimable',
    severity: 'high',
    vulnClasses: ['vuln/logic/missing-check'],
    summary: 'Aave base yield is not incentives; without a claim path emissions are lost forever.',
    detail:
      'Rewards accrue to whoever holds the aToken. The claim call must be passed aToken and debtToken addresses, not the underlyings — a mistake that silently claims nothing.',
    incidents: [
      { name: 'Float Capital (Code4rena M-05)', url: 'https://code4rena.com/reports/2022-05-backd' },
      { name: 'Alchemix V3 (Immunefi #57812)', url: 'https://immunefi.com/bug-bounty/alchemix/' },
    ],
    detect: [{ kind: 'absence', pattern: 'claimAllRewards', appliesTo: BOTH }],
    remediation: 'Expose a gated claim that forwards aToken addresses to the RewardsController.',
  },
  {
    id: FINDING_IDS.MORPHO_CALLBACK_UNGATED,
    title: 'Morpho callback not gated to the Morpho singleton',
    severity: 'critical',
    vulnClasses: ['vuln/access-control/missing-auth', 'vuln/logic/reentrancy'],
    summary:
      'A non-empty `data` argument makes Morpho call back into your contract mid-transaction.',
    detail:
      'Morpho supply/repay/supplyCollateral/flashLoan re-enter the caller when data is non-empty. An implemented-but-ungated callback is the same Critical that drained DODO on Aave: the attacker drives it with parameters of their choosing while the position is half-updated. Passing empty bytes and implementing no callback removes the entry point rather than guarding it.',
    incidents: [
      {
        name: 'DODO MarginTrading (Sherlock #150) - same shape, Aave flashLoan',
        url: 'https://github.com/sherlock-audit/2023-01-derby-judging/issues/150',
        pocFolder: '2021-03-dodo_flashloan_exp',
      },
    ],
    detect: [{ kind: 'absence', pattern: 'NO_CALLBACK', appliesTo: MORPHO }],
    remediation:
      'Pass empty bytes. If you must implement a callback, require msg.sender == address(MORPHO) and assert the transaction was self-initiated.',
  },
  {
    id: FINDING_IDS.MORPHO_ASSETS_SHARES_EXCLUSIVE,
    title: 'Morpho assets/shares not mutually exclusive',
    severity: 'high',
    vulnClasses: ['vuln/input-validation/missing-validation', 'vuln/logic/rounding'],
    summary:
      'supply/withdraw take BOTH an assets and a shares argument, and exactly one must be zero.',
    detail:
      'Setting both, or neither, reverts with "inconsistent input" - verified against Morpho ErrorsLib. Which one you pass also decides the rounding direction: supplying by assets converts to shares rounding DOWN, so withdrawing that same asset figure converts back rounding UP and asks for more shares than the position holds. That underflows inside Morpho rather than in your contract, which is why it survives a unit-test suite built on mocks.',
    incidents: [
      { name: 'Morpho Blue ErrorsLib.INCONSISTENT_INPUT', url: 'https://docs.morpho.org/' },
    ],
    detect: [{ kind: 'absence', pattern: 'SHARES_UNSET', appliesTo: MORPHO }],
    remediation:
      'Name the zero argument (a SHARES_UNSET constant) so the intent is visible at every call site, and credit the position delta you measure rather than the amount you requested.',
  },
  {
    id: FINDING_IDS.MORPHO_MARKET_PARAMS_UNPINNED,
    title: 'Market parameters not pinned at construction',
    severity: 'high',
    vulnClasses: ['vuln/access-control/missing-auth', 'vuln/input-validation/missing-validation'],
    summary:
      'A Morpho market IS the hash of its five parameters, so accepting them per call lets a caller repoint the vault.',
    detail:
      'Morpho identifies a market by keccak(loanToken, collateralToken, oracle, irm, lltv). A vault that takes those per call can be aimed at a market with a different oracle or a different LLTV while every function signature stays identical - the depositor sees no change. Pinning them as immutables makes the market fixed for the vault lifetime.',
    incidents: [{ name: 'Morpho Blue MarketParamsLib', url: 'https://docs.morpho.org/' }],
    detect: [{ kind: 'absence', pattern: 'immutable LLTV', appliesTo: MORPHO }],
    remediation:
      'Take the five fields as constructor arguments, store them as immutables, and expose marketParams() as a view that rebuilds the struct.',
  },
];

/**
 * Stand-in for Agent B's rule engine (B5). `absence` means the mitigation is missing;
 * `regex` means a vulnerable pattern is present. Either way the finding is triggered.
 */
export function mockAudit(source: string, preset: Preset): AuditResult {
  const findings = MOCK_FINDINGS.filter((f) =>
    f.detect.some((d) => d.appliesTo.includes(preset)),
  ).map((f) => {
    const triggered = f.detect.some((d) => {
      if (!d.appliesTo.includes(preset)) return false;
      const present = new RegExp(d.pattern).test(source);
      return d.kind === 'absence' ? !present : present;
    });
    const line = triggered ? undefined : lineOf(source, f.detect[0].pattern);
    return { ...f, status: triggered ? ('triggered' as const) : ('mitigated' as const), line };
  });

  return {
    findings: findings.sort((a, b) => rank(b) - rank(a)),
    score: {
      mitigated: findings.filter((f) => f.status === 'mitigated').length,
      triggered: findings.filter((f) => f.status === 'triggered').length,
    },
  };
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const rank = (f: { status: string; severity: keyof typeof SEVERITY_RANK }) =>
  (f.status === 'triggered' ? 10 : 0) + SEVERITY_RANK[f.severity];

function lineOf(source: string, pattern: string): number | undefined {
  const lines = source.split('\n');
  const re = new RegExp(pattern);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return undefined;
}
