import { printFlashLoanReceiver } from '../src/generator/aave/flashLoanReceiver';
import type { GenerateOptions } from '../src/types';

const out: Record<string, { content: string }> = {};
let n = 0, rejected = 0;
for (const access of ['none', 'ownable', 'roles'] as const)
  for (const pausable of [false, true])
    for (const routerAllowlist of [false, true])
      for (const claimRewards of [false, true])
        for (const sweepEscapeHatch of [false, true]) {
          const name = `Gen${n++}`;
          const opts: GenerateOptions = {
            preset: 'aave-v3-flashloan-receiver',
            name, access, pausable, routerAllowlist, claimRewards, sweepEscapeHatch,
            asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          };
          try { out[`${name}.sol`] = { content: printFlashLoanReceiver(opts) }; }
          catch { rejected++; }
        }
console.error(`accepted ${Object.keys(out).length}, rejected ${rejected} of ${n}`);
console.log(JSON.stringify(out));
