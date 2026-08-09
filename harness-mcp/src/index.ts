#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * HARNESS as an MCP server.
 *
 * The point is `harness_audit`. An LLM asked for an Aave flash-loan receiver
 * reliably writes the tutorial pattern — a callback gated only on
 * `msg.sender == POOL` — which is the Critical that drained DODO and Mimo. An
 * agent can call this and be told, deterministically, which documented findings
 * its own code has, with the incident and a runnable PoC for each.
 *
 * Generation is deliberately the *second* tool: OpenZeppelin already ships
 * `@openzeppelin/wizard-mcp`, so a generate-only server would be a me-too.
 *
 * Thin by design — it calls the deployed HTTP API rather than embedding the
 * generator, so an agent never needs a local build and the server can't drift
 * from what the site serves.
 */

const API_BASE = (process.env.HARNESS_API_BASE ?? 'https://harness-web-livid.vercel.app').replace(
  /\/$/,
  '',
);

// Kept in step with PRESET_LIST in harness-web/src/types.ts. This package does not
// share that module, so the API validates the preset too — a stale copy here is a
// bad error message, never an accepted request for a preset the server rejects.
const PRESETS = [
  'aave-v3-flashloan-receiver',
  'aave-v3-erc4626-vault',
  'morpho-blue-vault',
] as const;

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (parsed as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(`${path} failed: ${message}`);
  }
  return parsed as T;
}

/** MCP tool results are content blocks; every tool here returns one text block. */
const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

const server = new McpServer({ name: 'harness', version: '0.1.0' });

server.registerTool(
  'harness_audit',
  {
    title: 'Audit Aave v3 Solidity',
    description:
      'Audit Solidity that integrates with Aave v3 against a corpus of documented ' +
      'integration findings. Returns each finding as mitigated or triggered, with the ' +
      'historical incident it derives from and a link to a runnable exploit PoC. ' +
      'Call this on any contract that touches Aave — flash-loan receivers and ERC-4626 ' +
      'vaults especially — before presenting it as finished.',
    inputSchema: {
      source: z.string().describe('The full Solidity source to audit.'),
      preset: z
        .enum(PRESETS)
        .describe(
          'Which integration shape the code is: a flash-loan receiver or an ERC-4626 vault.',
        ),
    },
  },
  async ({ source, preset }) => {
    type Finding = {
      id: string;
      title: string;
      severity: string;
      status: string;
      summary: string;
      remediation: string;
      incidents: { name: string; url: string; pocFolder?: string }[];
    };
    const r = await callApi<{ findings: Finding[]; score: { mitigated: number; triggered: number } }>(
      '/api/audit',
      { source, preset },
    );

    const triggered = r.findings.filter((f) => f.status === 'triggered');
    const lines = [
      `${r.score.mitigated} mitigated, ${r.score.triggered} triggered.`,
      '',
    ];

    if (triggered.length === 0) {
      lines.push('No findings triggered against this corpus.');
    } else {
      for (const f of triggered) {
        lines.push(`[${f.severity.toUpperCase()}] ${f.id} — ${f.title}`);
        lines.push(`  ${f.summary}`);
        lines.push(`  Fix: ${f.remediation}`);
        for (const i of f.incidents) {
          lines.push(`  Incident: ${i.name} — ${i.url}`);
          if (i.pocFolder) {
            lines.push(
              `  Runnable PoC: https://github.com/sanbir/evm-hack-registry/tree/main/${i.pocFolder}`,
            );
          }
        }
        lines.push('');
      }
    }

    const mitigated = r.findings.filter((f) => f.status === 'mitigated').map((f) => f.id);
    if (mitigated.length) lines.push(`Mitigated: ${mitigated.join(', ')}`);

    return text(lines.join('\n'));
  },
);

server.registerTool(
  'harness_generate',
  {
    title: 'Generate a hardened Aave v3 contract',
    description:
      'Generate an Aave v3 integration contract that is already hardened against the ' +
      'documented findings, together with a Foundry attack suite that proves it. ' +
      'Deterministic template composition — the same options always produce the same ' +
      'code. Prefer this over writing an Aave integration from scratch.',
    inputSchema: {
      preset: z.enum(PRESETS).describe('Which contract to generate.'),
      name: z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
        .optional()
        .describe('Contract name. Must be a valid Solidity identifier.'),
      asset: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .optional()
        .describe('Underlying ERC20 address. Defaults to mainnet USDC.'),
      access: z.enum(['none', 'ownable', 'roles']).optional(),
      pausable: z.boolean().optional(),
      routerAllowlist: z.boolean().optional().describe('Flash-loan preset only.'),
      claimRewards: z.boolean().optional(),
      sweepEscapeHatch: z.boolean().optional(),
      depositCap: z.string().optional().describe('Vault only. Raw token units, decimal string.'),
      feeBps: z.number().int().min(0).max(1000).optional().describe('Vault only.'),
      decimalsOffset: z
        .number()
        .int()
        .min(0)
        .max(12)
        .optional()
        .describe('Vault only. Virtual-share exponent defending the inflation attack.'),
    },
  },
  async (args) => {
    const r = await callApi<{
      contractName: string;
      contractSource: string;
      attackTestSource: string;
      deployScriptSource: string;
      appliedFindingIds: string[];
      testNames: string[];
    }>('/api/generate', args);

    return text(
      [
        `Generated ${r.contractName}, hardened against ${r.appliedFindingIds.length} findings: ${r.appliedFindingIds.join(', ')}`,
        '',
        `// src/${r.contractName}.sol`,
        r.contractSource,
        '',
        `// test/${r.contractName}.attack.t.sol — ${r.testNames.length} tests: ${r.testNames.join(', ')}`,
        r.attackTestSource,
        '',
        `// script/${r.contractName}.s.sol`,
        r.deployScriptSource,
      ].join('\n'),
    );
  },
);

server.registerTool(
  'harness_vault_settings',
  {
    title: 'Check vault settings against live Aave',
    description:
      "Judge an ERC-4626 vault's deposit cap, performance fee and virtual-share offset " +
      "against Aave's live reserve state, and sweep neighbouring values to show where " +
      'each verdict flips. Use this before committing to vault parameters — the correct ' +
      'values depend on current market headroom, liquidity and APY, not on taste.',
    inputSchema: {
      asset: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .describe('Underlying ERC20 address, e.g. mainnet USDC.'),
      depositCap: z.string().optional().describe('Raw token units, decimal string.'),
      feeBps: z.number().int().min(0).max(1000).optional(),
      decimalsOffset: z.number().int().min(0).max(12).optional(),
    },
  },
  async (args) => {
    type Advice = {
      label: string;
      verdict: string;
      current: string;
      recommended?: string;
      finding?: string;
      detail: string;
    };
    type Sweep = {
      label: string;
      frontier: string;
      points: { label: string; verdict: string; current?: boolean }[];
    };
    const r = await callApi<{
      market: Record<string, string | number | boolean>;
      advice: Advice[];
      sweeps: Sweep[];
    }>('/api/vault-analysis', { preset: 'aave-v3-erc4626-vault', ...args });

    const m = r.market;
    const lines = [
      `Aave right now — supply cap ${m.supplyCap}, supplied ${m.supplied}, headroom ${m.headroom}, ` +
        `available liquidity ${m.availableLiquidity}, supply APY ${Number(m.supplyApyPct).toFixed(2)}%, ` +
        `reserve factor ${m.reserveFactorPct}%.`,
      '',
    ];
    for (const a of r.advice) {
      lines.push(
        `[${a.verdict.toUpperCase()}] ${a.label}: ${a.current}` +
          (a.recommended ? ` → recommended ${a.recommended}` : '') +
          (a.finding ? ` (${a.finding})` : ''),
      );
      lines.push(`  ${a.detail}`);
    }
    lines.push('', 'Where each verdict flips:');
    for (const s of r.sweeps) lines.push(`  ${s.label}: ${s.frontier}`);

    return text(lines.join('\n'));
  },
);

await server.connect(new StdioServerTransport());
