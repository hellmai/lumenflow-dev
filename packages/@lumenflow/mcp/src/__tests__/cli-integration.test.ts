// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file cli-integration.test.ts
 * @description Integration tests that execute real CLI commands (no mocks).
 *
 * WU-1453: MCP tests currently mock cli-runner.js. Flag mismatches pass tests
 * because CLI is never invoked. These tests call real CLI commands to verify that
 * the flags MCP tools pass are actually accepted by the CLI.
 *
 * Strategy:
 * - Use `runCliCommand` directly (the real function, no vi.mock)
 * - Use safe read-only commands (--help, wu:status) to verify flag acceptance
 * - Verify exit code 0 for valid flags, non-zero for invalid flags
 * - Test the same flag patterns used in tools.ts
 */

import { describe, it, expect } from 'vitest';
import { runCliCommand, type CliRunnerResult } from '../cli-runner.js';
import { buildMcpManifestParityReport, registeredTools } from '../tools.js';
import { PUBLIC_MANIFEST } from '../../../cli/src/public-manifest.js';
import { RuntimeTaskToolNames } from '../tools/runtime-task-constants.js';
import { resolve } from 'node:path';

/**
 * Project root for CLI invocations.
 * Integration tests need an absolute path to the repo root because
 * vitest may run from a different cwd.
 */
const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../..');

/**
 * Timeout for help commands.
 * Some commands (for example wu:claim and wu:done) trigger a fresh CLI dist
 * build before printing help when dist is stale under gate execution.
 */
const HELP_TIMEOUT_MS = 30000;

/**
 * Timeout for commands that read from disk (wu:status, etc).
 */
const READ_TIMEOUT_MS = 30000;

/**
 * Test-level timeout for integration tests that execute real CLI processes.
 */
const CLI_INTEGRATION_TEST_TIMEOUT_MS = 45000;

/**
 * Assert that a CLI result succeeded (exit code 0).
 */
function expectSuccess(result: CliRunnerResult, context: string): void {
  expect(result.success, `${context}: expected success but got stderr="${result.stderr}"`).toBe(
    true,
  );
  expect(result.exitCode, `${context}: expected exit code 0 but got ${result.exitCode}`).toBe(0);
}

/**
 * Assert that a CLI result failed (non-zero exit code).
 */
function expectFailure(result: CliRunnerResult, context: string): void {
  expect(result.success, `${context}: expected failure but command succeeded`).toBe(false);
}

/**
 * Extract JSON from CLI stdout, stripping pnpm script execution header lines.
 *
 * When pnpm runs a script via `execFile`, stdout includes header lines like:
 *   > hellmai-os@ wu:status /path/to/project
 *   > node packages/@lumenflow/cli/dist/wu-status.js --id WU-1453 --json
 *
 * This helper finds the first '{' or '[' character (start of JSON) and parses from there.
 */
function extractJson<T>(stdout: string): T {
  const jsonStart = stdout.search(/[{[]/);
  if (jsonStart === -1) {
    throw new Error(`No JSON found in stdout: ${stdout.substring(0, 200)}`);
  }
  return JSON.parse(stdout.substring(jsonStart)) as T;
}

describe('CLI integration (no mocks)', { timeout: CLI_INTEGRATION_TEST_TIMEOUT_MS }, () => {
  // WU-1908: pack commands are known, tracked parity gaps (see WU-1880).
  // WU-1919: Added pack:validate, pack:hash, pack:publish, pack:install to public manifest.
  // WU-1952: Added pack:author to public manifest.
  // WU-1962: Added workspace:init and lumenflow-onboard alias to public manifest.
  // WU-1980: Added cloud:connect command to public manifest.
  // WU-1983: Added MCP parity tools for cloud_connect, onboard aliases, and workspace_init.
  // Remaining gaps are explicit pack command follow-ups.
  const EXPECTED_MISSING_PARITY_TOOLS: string[] = [
    'pack_author',
    'pack_hash',
    'pack_install',
    'pack_publish',
    'pack_search',
    'pack_validate',
    'templates_sync',
  ];

  describe('wu:status flags', () => {
    it('should accept --id and --json flags (as MCP wuStatusTool passes them)', async () => {
      // MCP tools.ts builds: ['--id', wuId, '--json']
      // Use a known WU that exists in the repo
      const result = await runCliCommand('wu:status', ['--id', 'WU-1453', '--json'], {
        projectRoot: PROJECT_ROOT,
        timeout: READ_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:status --id WU-1453 --json');
      // The output should contain parseable JSON (after stripping pnpm header)
      const parsed = extractJson(result.stdout);
      expect(parsed).toBeDefined();
    });

    it('should accept --help flag', async () => {
      const result = await runCliCommand('wu:status', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:status --help');
      expect(result.stdout).toContain('--id');
      expect(result.stdout).toContain('--json');
    });
  });

  describe('wu:create flag validation', () => {
    it('should accept --help and list all flags MCP uses', async () => {
      const result = await runCliCommand('wu:create', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:create --help');

      // Verify all flags that wuCreateTool in tools.ts passes exist
      const flagsUsedByMcp = [
        '--lane',
        '--title',
        '--id',
        '--description',
        '--acceptance',
        '--code-paths',
        '--exposure',
      ];

      for (const flag of flagsUsedByMcp) {
        expect(result.stdout, `wu:create --help should list flag "${flag}"`).toContain(flag);
      }
    });
  });

  describe('wu:claim flag validation', () => {
    it('should accept --help and list --id and --lane flags', async () => {
      const result = await runCliCommand('wu:claim', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:claim --help');
      // MCP wuClaimTool passes: ['--id', wuId, '--lane', lane]
      expect(result.stdout).toContain('--id');
      expect(result.stdout).toContain('--lane');
    });
  });

  describe('wu:done flag validation', () => {
    it('should accept --help and list --id, --skip-gates, --reason, --fix-wu flags', async () => {
      const result = await runCliCommand('wu:done', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:done --help');

      // MCP wuDoneTool passes: ['--id', wuId] and optionally --skip-gates, --reason, --fix-wu
      const flagsUsedByMcp = ['--id', '--skip-gates', '--reason', '--fix-wu'];

      for (const flag of flagsUsedByMcp) {
        expect(result.stdout, `wu:done --help should list flag "${flag}"`).toContain(flag);
      }
    });
  });

  describe('gates flag validation', () => {
    it('should accept --help and list --docs-only flag', async () => {
      const result = await runCliCommand('gates', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'gates --help');
      // MCP gatesRunTool passes: ['--docs-only'] when docs_only is set
      expect(result.stdout).toContain('--docs-only');
    });
  });

  describe('wu:block flag validation', () => {
    it('should accept --help and list --id, --reason, --remove-worktree flags', async () => {
      const result = await runCliCommand('wu:block', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:block --help');

      const flagsUsedByMcp = ['--id', '--reason', '--remove-worktree'];
      for (const flag of flagsUsedByMcp) {
        expect(result.stdout, `wu:block --help should list flag "${flag}"`).toContain(flag);
      }
    });
  });

  describe('wu:edit flag validation', () => {
    it('should accept --help and list all flags MCP uses', async () => {
      const result = await runCliCommand('wu:edit', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:edit --help');

      // MCP wuEditTool passes these flags
      const flagsUsedByMcp = [
        '--id',
        '--description',
        '--acceptance',
        '--notes',
        '--code-paths',
        '--lane',
        '--priority',
        '--initiative',
        '--phase',
        '--no-strict',
      ];

      for (const flag of flagsUsedByMcp) {
        expect(result.stdout, `wu:edit --help should list flag "${flag}"`).toContain(flag);
      }
    });
  });

  describe('wu:prep flag validation', () => {
    it('should accept --help and list --id, --docs-only, and --full-tests flags', async () => {
      const result = await runCliCommand('wu:prep', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:prep --help');
      expect(result.stdout).toContain('--id');
      expect(result.stdout).toContain('--docs-only');
      expect(result.stdout).toContain('--full-tests');
    });
  });

  describe('wu:recover flag validation', () => {
    it('should accept --help and list --id, --action, --force, --json flags', async () => {
      const result = await runCliCommand('wu:recover', ['--help'], {
        projectRoot: PROJECT_ROOT,
        timeout: HELP_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:recover --help');

      const flagsUsedByMcp = ['--id', '--action', '--force', '--json'];
      for (const flag of flagsUsedByMcp) {
        expect(result.stdout, `wu:recover --help should list flag "${flag}"`).toContain(flag);
      }
    });
  });

  describe('real CLI invocation with live data', () => {
    it('should execute wu:status for a known WU and return structured output', async () => {
      // This is the key test: calling real CLI with the exact flags MCP passes
      const result = await runCliCommand('wu:status', ['--id', 'WU-1453', '--json'], {
        projectRoot: PROJECT_ROOT,
        timeout: READ_TIMEOUT_MS,
      });

      expectSuccess(result, 'wu:status --id WU-1453 --json');

      const parsed = extractJson<{ wu: { id: string; status: string } }>(result.stdout);
      expect(parsed).toHaveProperty('wu');
      expect(parsed.wu).toHaveProperty('id');
      expect(parsed.wu.id).toBe('WU-1453');
    });
  });

  describe('flag mismatch detection (regression guard)', () => {
    it('should fail if an invalid flag is passed to wu:status', async () => {
      // This test proves that the CLI actually rejects invalid flags.
      // If MCP were passing --format json to wu:status (which uses --json),
      // this test pattern would catch it.
      const result = await runCliCommand('wu:status', ['--id', 'WU-1453', '--nonexistent-flag'], {
        projectRoot: PROJECT_ROOT,
        timeout: READ_TIMEOUT_MS,
      });

      expectFailure(result, 'wu:status with invalid flag');
    });

    it('should fail if --format json is passed to wu:status instead of --json', async () => {
      // Regression test: wu:status uses --json, not --format json.
      // This is the exact kind of mismatch WU-1453 was created to catch.
      const result = await runCliCommand('wu:status', ['--id', 'WU-1453', '--format', 'json'], {
        projectRoot: PROJECT_ROOT,
        timeout: READ_TIMEOUT_MS,
      });

      // wu:status does NOT accept --format, so this should fail
      expectFailure(result, 'wu:status with --format json (wrong flag)');
    });
  });

  describe('manifest parity remediation visibility (WU-1481)', () => {
    const RUNTIME_MIGRATED_TOOL_NAMES = [
      RuntimeTaskToolNames.TASK_CLAIM,
      RuntimeTaskToolNames.TASK_CREATE,
      RuntimeTaskToolNames.TASK_COMPLETE,
      RuntimeTaskToolNames.TASK_BLOCK,
      RuntimeTaskToolNames.TASK_UNBLOCK,
      RuntimeTaskToolNames.TASK_INSPECT,
      RuntimeTaskToolNames.TOOL_EXECUTE,
    ];

    it('should expose actionable parity diffs for remediation waves', () => {
      const report = buildMcpManifestParityReport(
        PUBLIC_MANIFEST.map((command) => command.name),
        registeredTools.map((tool) => tool.name),
      );

      expect(report.missing).toEqual(EXPECTED_MISSING_PARITY_TOOLS);
      expect(report.unexpectedExtra).toEqual([]);

      for (const toolName of RUNTIME_MIGRATED_TOOL_NAMES) {
        expect(report.missing).not.toContain(toolName);
        expect(report.unexpectedExtra).not.toContain(toolName);
      }
    });
  });
});
