import { buildPreset, printPreset, PRESET_DEFAULTS } from '@/generator';
import { printDeployScript } from '@/generator/aave/deployScript';
import {
  assembleAttackTests,
  type AttackSnippetFile,
} from '@/generator/attacks/assembleAttackTests';
import snippets from '@/generated/attack-snippets.json';
import {
  PRESET_LIST,
  REMAPPINGS,
  type GenerateOptions,
  type GeneratedProject,
} from '@/types';

/**
 * Generation over HTTP.
 *
 * The generator was browser-only, which meant nothing outside the page could use
 * it — no MCP server, no CI, no script. It is a pure function, so exposing it is
 * just a matter of giving it a route.
 */

export const runtime = 'nodejs';

const SNIPPETS = snippets as unknown as AttackSnippetFile;

export async function POST(req: Request): Promise<Response> {
  let body: Partial<GenerateOptions>;
  try {
    body = (await req.json()) as Partial<GenerateOptions>;
  } catch {
    return json({ error: 'Malformed JSON body' }, 400);
  }

  if (!body.preset || !PRESET_LIST.includes(body.preset)) {
    return json({ error: `preset must be one of: ${PRESET_LIST.join(', ')}` }, 400);
  }

  // Defaults fill the gaps so a caller can send just {preset} and get something
  // that compiles, rather than having to know every option up front.
  const opts: GenerateOptions = { ...PRESET_DEFAULTS[body.preset], ...body };

  try {
    const tests = assembleAttackTests(opts, SNIPPETS);
    const project: GeneratedProject & { testNames: string[] } = {
      preset: opts.preset,
      contractName: opts.name,
      contractSource: printPreset(opts),
      attackTestSource: tests.source,
      deployScriptSource: printDeployScript(opts),
      remappings: REMAPPINGS,
      appliedFindingIds: buildPreset(opts).appliedFindingIds,
      testNames: tests.testNames,
    };
    return json(project, 200);
  } catch (e) {
    // OptionsError carries per-field messages; surface them rather than a bare 500.
    const err = e as Error & { messages?: Record<string, string> };
    return json({ error: err.message, fields: err.messages }, 400);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}
