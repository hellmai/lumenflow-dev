import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

interface ShelloutBudgetBaseline {
  mcp_shellout_budget?: {
    run_cli_command_call_sites?: number;
  };
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../../../..');
const MCP_SRC_DIR = path.join(REPO_ROOT, 'packages/@lumenflow/mcp/src');
const BASELINE_PATH = path.join(REPO_ROOT, 'tools/baselines/strict-progress-baseline.json');

function listTypeScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test directories to avoid counting test-only call sites
      if (entry.name === '__tests__' || entry.name === 'node_modules') {
        continue;
      }
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function countRunCliCommandCallSites(sourceText: string): number {
  const sourceFile = ts.createSourceFile(
    'tools.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let count = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'runCliCommand') {
        count += 1;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return count;
}

function getCurrentShelloutCallSiteCount(): number {
  const files = listTypeScriptFiles(MCP_SRC_DIR);
  return files.reduce((total, file) => {
    const content = readFileSync(file, 'utf-8');
    return total + countRunCliCommandCallSites(content);
  }, 0);
}

function getShelloutBaseline(): number {
  const raw = readFileSync(BASELINE_PATH, 'utf-8');
  const baseline = JSON.parse(raw) as ShelloutBudgetBaseline;
  const value = baseline.mcp_shellout_budget?.run_cli_command_call_sites;

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      [
        `Invalid or missing MCP shell-out baseline in ${BASELINE_PATH}.`,
        'Expected JSON path: mcp_shellout_budget.run_cli_command_call_sites (non-negative integer).',
      ].join(' '),
    );
  }

  return value;
}

describe('MCP shell-out budget guardrail (WU-1795)', () => {
  /**
   * Baseline update process (approved migration planning only):
   * 1) Run this test to capture the current count.
   * 2) Update tools/baselines/strict-progress-baseline.json at
   *    mcp_shellout_budget.run_cli_command_call_sites.
   * 3) Include explicit approval and rationale in the WU notes/PR.
   */
  it('enforces non-increasing runCliCommand call-site budget across MCP tool modules', () => {
    const baseline = getShelloutBaseline();
    const current = getCurrentShelloutCallSiteCount();

    expect(
      current,
      [
        `MCP shell-out budget regression detected: ${current} call sites > baseline ${baseline}.`,
        'If this increase is intentional and approved, update tools/baselines/strict-progress-baseline.json',
        'at mcp_shellout_budget.run_cli_command_call_sites and document the approval in the WU.',
      ].join(' '),
    ).toBeLessThanOrEqual(baseline);
  });
});
