import { mockAudit } from '@/mocks/auditFindings';
import { printPreset, PRESET_DEFAULTS } from '@/generator';

/**
 * Mutation test for the Morpho audit rules.
 *
 * A detect rule that never fires is indistinguishable from a rule that works,
 * because the generated contract is supposed to be clean. So: assert the clean
 * contract triggers nothing, then remove one mitigation at a time and assert
 * that exactly the matching finding appears. A rule that fires on every mutation
 * is not a rule, so the count is checked too.
 */

const P = 'morpho-blue-vault' as const;
const src = printPreset({ ...PRESET_DEFAULTS[P], preset: P, name: 'MyMorphoVault' });

const fired = (s: string) =>
  mockAudit(s, P).findings.filter((f) => f.status === 'triggered').map((f) => f.id).sort();

console.log('clean generated vault ->', JSON.stringify(fired(src)));

// Each mutation removes exactly one mitigation. The matching finding must appear,
// and nothing else may change — a rule that fires on every mutation is not a rule.
const mutations: [string, string, string][] = [
  ['MRPH-CB-017', 'NO_CALLBACK', 'strip the named empty-callback constant'],
  ['MRPH-VLT-016', 'SHARES_UNSET', 'strip the named zero-shares constant'],
  ['MRPH-MKT-018', 'immutable LLTV', 'unpin the market parameters'],
  ['AAVE-DEP-015', 'using SafeERC20', 'drop SafeERC20'],
  ['AAVE-VLT-004', 'MORPHO.withdraw', 'ignore the withdraw return'],
  ['AAVE-VLT-009', 'function sweep', 'remove the escape hatch'],
  ['AAVE-RISK-010', 'whenNotPaused', 'remove the pause guard'],
  ['AAVE-VLT-003', '_decimalsOffset', 'remove virtual shares'],
  ['AAVE-VLT-011', '(caller, receiver, owner', 'conflate receiver and owner'],
];

let bad = 0;
for (const [id, needle, what] of mutations) {
  const mutated = src.split(needle).join('XXX_REMOVED');
  if (mutated === src) { console.log(`SETUP-FAIL ${id}: '${needle}' not in source`); bad++; continue; }
  const f = fired(mutated);
  const ok = f.includes(id) && f.length === 1;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}  ${what.padEnd(34)} -> ${JSON.stringify(f)}`);
}
process.exit(bad === 0 && fired(src).length === 0 ? 0 : 1);
