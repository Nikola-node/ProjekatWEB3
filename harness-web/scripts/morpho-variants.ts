import { writeFileSync, mkdirSync } from 'node:fs';
import { printPreset } from '../src/generator';
import type { GenerateOptions } from '../src/types';

const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
let n = 0;
for (const access of ['ownable', 'roles'] as const)
  for (const pausable of [false, true])
    for (const sweepEscapeHatch of [false, true])
      for (const extra of [{}, { depositCap: '10000000000000', feeBps: 200, decimalsOffset: 0 }]) {
        const name = `M${n++}`;
        const opts = {
          preset: 'morpho-blue-vault', name, access, pausable, sweepEscapeHatch,
          routerAllowlist: false, claimRewards: false,
          asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', ...extra,
        } as GenerateOptions;
        writeFileSync(`${dir}/${name}.sol`, printPreset(opts));
      }
console.log(`wrote ${n} Morpho variants`);
