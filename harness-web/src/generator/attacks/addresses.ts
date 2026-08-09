/**
 * Aave v3 Ethereum mainnet, taken from @bgd-labs/aave-address-book rather than
 * recalled. §9.1 says never hardcode the Pool — it is resolved from the provider
 * at runtime, which is why only the provider appears here.
 */
export const MAINNET = {
  POOL_ADDRESSES_PROVIDER: '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e',
  REWARDS_CONTROLLER: '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  aUSDC: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  aWETH: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',
} as const;

/**
 * Morpho Blue on Ethereum mainnet, plus one real market.
 *
 * A Morpho market is identified by the hash of its five parameters, so a test
 * cannot invent them — these were read off chain by scanning `CreateMarket` logs
 * and ranking by free liquidity, not recalled. This is the WBTC/USDC market at
 * 86% LLTV: ~126M USDC supplied with ~19M unborrowed at the time of writing.
 */
export const MORPHO_MAINNET = {
  MORPHO: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  COLLATERAL: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ORACLE: '0xDddd770BADd886dF3864029e4B377B5F6a2B6b83',
  IRM: '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC',
  LLTV: '860000000000000000', // 86%
  MARKET_ID: '0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49',
} as const;
