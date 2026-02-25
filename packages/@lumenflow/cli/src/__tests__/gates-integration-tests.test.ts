// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file gates-integration-tests.test.ts
 * @description Tests for gates infrastructure fixes (WU-1415)
 *
 * Bug 1: vitest --include is not a valid CLI option
 * Bug 2: docs-only turbo filter uses directory names instead of package names
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractPackagesFromCodePaths,
  resolveDocsOnlyTestPlan,
  syncGatesTelemetryToCloud,
} from '../gates.js';

describe('WU-1415: Gates infrastructure fixes', () => {
  describe('Bug 1: vitest integration test command', () => {
    it('should NOT use --include flag (vitest does not support it)', async () => {
      // Import the module to inspect the command construction
      // We need to verify that runIntegrationTests uses valid vitest syntax
      //
      // vitest run accepts positional glob patterns, NOT --include flags:
      //   WRONG: vitest run --include='**/*.integration.*'
      //   RIGHT: vitest run '**/*.integration.*'
      //
      // This test ensures we're using the correct vitest CLI syntax
      const gatesModule = await import('../gates.js');

      // The command construction happens in runIntegrationTests
      // We can't directly test the internal function, but we can verify
      // via the module's exported constants or by checking the implementation
      // doesn't contain --include

      // Read the source to verify no --include in vitest commands
      const fs = await import('fs');
      const path = await import('path');
      const gatesPath = path.join(import.meta.dirname, '..', 'gates.ts');
      const source = fs.readFileSync(gatesPath, 'utf-8');

      // Find the runIntegrationTests function and check it doesn't use --include
      const integrationTestMatch = source.match(/function runIntegrationTests[\s\S]*?^}/m);

      if (integrationTestMatch) {
        const functionBody = integrationTestMatch[0];
        // vitest run should NOT have --include flags
        expect(functionBody).not.toMatch(/vitest.*--include/);
        // Instead, glob patterns should be positional args or via proper config
        // The fix should pass patterns directly: vitest run 'pattern1' 'pattern2'
      }
    });
  });

  describe('Bug 2: docs-only turbo filter', () => {
    describe('extractPackagesFromCodePaths', () => {
      it('should extract scoped package names from packages/ paths', () => {
        const codePaths = [
          'packages/@lumenflow/cli/src/gates.ts',
          'packages/@lumenflow/core/src/index.ts',
        ];
        const packages = extractPackagesFromCodePaths(codePaths);
        expect(packages).toContain('@lumenflow/cli');
        expect(packages).toContain('@lumenflow/core');
      });

      it('should return empty array for apps/ paths that are not real turbo packages', () => {
        // apps/docs/ directory name is 'docs' but the turbo package might be
        // named differently (e.g., '@lumenflow/docs' or not exist at all)
        //
        // The current implementation returns 'docs' which causes turbo to fail:
        //   "No package found with name 'docs' in workspace"
        //
        // Fix: Either lookup actual package.json name or skip apps
        const codePaths = ['apps/docs/src/content/docs/', 'apps/github-app/'];
        const packages = extractPackagesFromCodePaths(codePaths);

        // Current buggy behavior returns ['docs', 'github-app']
        // Fixed behavior should either:
        // - Return actual package names from package.json
        // - Or return empty array (apps don't have turbo test tasks)
        //
        // For now, the fix should skip apps that aren't valid turbo packages
        // because apps/docs has no test script and apps/github-app was deleted
        expect(packages).not.toContain('docs');
        expect(packages).not.toContain('github-app');
      });

      it('should handle mixed code_paths (packages + apps + docs)', () => {
        const codePaths = [
          'packages/@lumenflow/cli/src/file.ts',
          'apps/docs/astro.config.mjs',
          'docs/DISTRIBUTION.md',
        ];
        const packages = extractPackagesFromCodePaths(codePaths);

        // Should include the real package
        expect(packages).toContain('@lumenflow/cli');
        // Should NOT include apps (no valid turbo package)
        expect(packages).not.toContain('docs');
        // Should NOT include docs/ (not a package)
        expect(packages.length).toBe(1);
      });

      it('should return empty array for pure docs paths', () => {
        const codePaths = ['docs/01-product/product-lines.md', 'docs/DISTRIBUTION.md'];
        const packages = extractPackagesFromCodePaths(codePaths);
        expect(packages).toEqual([]);
      });
    });

    describe('resolveDocsOnlyTestPlan', () => {
      it('should return skip mode for pure documentation WUs', () => {
        const plan = resolveDocsOnlyTestPlan({
          codePaths: ['docs/README.md', 'apps/docs/content/'],
        });
        expect(plan.mode).toBe('skip');
        expect(plan.packages).toEqual([]);
      });

      it('should return filtered mode only for valid package paths', () => {
        const plan = resolveDocsOnlyTestPlan({
          codePaths: ['packages/@lumenflow/cli/src/gates.ts', 'apps/docs/content/'],
        });
        expect(plan.mode).toBe('filtered');
        expect(plan.packages).toContain('@lumenflow/cli');
        // apps/docs should not be included
        expect(plan.packages).not.toContain('docs');
      });
    });
  });
});

describe('WU-2160: gates NDJSON cloud sync', () => {
  const TEST_TOKEN_ENV = 'LUMENFLOW_CLOUD_TOKEN_TEST';
  const TEST_ENDPOINT = 'https://cloud.example.com';
  const tempDirs: string[] = [];

  function createWorkspaceRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'gates-cloud-sync-'));
    tempDirs.push(root);
    return root;
  }

  function writeWorkspaceYaml(
    root: string,
    input: {
      workspaceId?: string;
      includeControlPlane?: boolean;
      syncInterval?: number;
      batchSize?: number;
    } = {},
  ): void {
    const workspaceDoc: Record<string, unknown> = {
      id: input.workspaceId ?? 'workspace-test',
    };

    if (input.includeControlPlane ?? true) {
      workspaceDoc.control_plane = {
        endpoint: TEST_ENDPOINT,
        org_id: 'org-test',
        project_id: 'project-test',
        sync_interval: input.syncInterval ?? 1,
        batch_size: input.batchSize ?? 2,
        policy_mode: 'tighten-only',
        auth: {
          token_env: TEST_TOKEN_ENV,
        },
      };
    }

    writeFileSync(path.join(root, 'workspace.yaml'), YAML.stringify(workspaceDoc), 'utf-8');
  }

  function writeTelemetryFiles(root: string, gatesLines: string[], flowLines: string[]): void {
    const telemetryDir = path.join(root, '.lumenflow', 'telemetry');
    mkdirSync(telemetryDir, { recursive: true });
    writeFileSync(path.join(telemetryDir, 'gates.ndjson'), `${gatesLines.join('\n')}\n`, 'utf-8');
    writeFileSync(path.join(root, '.lumenflow', 'flow.log'), `${flowLines.join('\n')}\n`, 'utf-8');
  }

  function createJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ships new gates + flow NDJSON records in batches and persists cursor offsets', async () => {
    const root = createWorkspaceRoot();
    writeWorkspaceYaml(root, { syncInterval: 1, batchSize: 2 });
    writeTelemetryFiles(
      root,
      [
        JSON.stringify({
          timestamp: '2026-02-25T00:00:00.000Z',
          gate_name: 'format:check',
          passed: true,
          duration_ms: 123,
          wu_id: 'WU-2160',
          lane: 'Operations',
        }),
        JSON.stringify({
          timestamp: '2026-02-25T00:00:01.000Z',
          gate_name: 'lint',
          passed: true,
          duration_ms: 456,
          wu_id: 'WU-2160',
          lane: 'Operations',
        }),
      ],
      [
        JSON.stringify({
          timestamp: '2026-02-25T00:00:02.000Z',
          script: 'wu:prep',
          step: 'start',
          wu_id: 'WU-2160',
          lane: 'Operations',
        }),
      ],
    );

    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse({ accepted: 2 }));
    const result = await syncGatesTelemetryToCloud({
      cwd: root,
      fetchFn,
      now: () => 20_000,
      environment: {
        [TEST_TOKEN_ENV]: 'token-value',
      },
    });

    expect(result.recordsSent).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://cloud.example.com/api/v1/telemetry');

    const firstRequestInit = fetchFn.mock.calls[0]?.[1];
    const firstHeaders = new Headers(firstRequestInit?.headers as HeadersInit);
    expect(firstHeaders.get('authorization')).toBe('Bearer token-value');
    expect(firstHeaders.get('content-type')).toBe('application/json');

    const firstPayload = JSON.parse(String(firstRequestInit?.body)) as {
      workspace_id: string;
      records: unknown[];
    };
    expect(firstPayload.workspace_id).toBe('workspace-test');
    expect(firstPayload.records).toHaveLength(2);

    const statePath = path.join(root, '.lumenflow', 'telemetry', 'cloud-sync-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as {
      files: {
        gates: { offset: number };
        flow: { offset: number };
      };
    };

    const gatesSize = Buffer.byteLength(
      readFileSync(path.join(root, '.lumenflow', 'telemetry', 'gates.ndjson'), 'utf-8'),
      'utf8',
    );
    const flowSize = Buffer.byteLength(
      readFileSync(path.join(root, '.lumenflow', 'flow.log'), 'utf-8'),
      'utf8',
    );
    expect(state.files.gates.offset).toBe(gatesSize);
    expect(state.files.flow.offset).toBe(flowSize);
  });

  it('keeps cursor on network failure and retries on next invocation', async () => {
    const root = createWorkspaceRoot();
    writeWorkspaceYaml(root, { syncInterval: 60, batchSize: 10 });
    writeTelemetryFiles(
      root,
      [
        JSON.stringify({
          timestamp: '2026-02-25T00:00:00.000Z',
          gate_name: 'format:check',
          passed: true,
          duration_ms: 10,
        }),
      ],
      [],
    );

    const firstAttempt = await syncGatesTelemetryToCloud({
      cwd: root,
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new Error('network down')),
      now: () => 30_000,
      environment: {
        [TEST_TOKEN_ENV]: 'token-value',
      },
    });

    expect(firstAttempt.recordsSent).toBe(0);

    const secondFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse({ accepted: 1 }));
    const secondAttempt = await syncGatesTelemetryToCloud({
      cwd: root,
      fetchFn: secondFetch,
      now: () => 30_001,
      environment: {
        [TEST_TOKEN_ENV]: 'token-value',
      },
    });

    expect(secondAttempt.recordsSent).toBe(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it('skips malformed NDJSON lines and still advances cursor after successful sync', async () => {
    const root = createWorkspaceRoot();
    writeWorkspaceYaml(root, { syncInterval: 1, batchSize: 10 });
    writeTelemetryFiles(
      root,
      [
        '{this-is-not-valid-json',
        JSON.stringify({
          timestamp: '2026-02-25T00:00:00.000Z',
          gate_name: 'lint',
          passed: false,
          duration_ms: 42,
        }),
      ],
      [],
    );

    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse({ accepted: 1 }));
    const logger = { warn: vi.fn() };
    const firstAttempt = await syncGatesTelemetryToCloud({
      cwd: root,
      fetchFn,
      logger,
      now: () => 50_000,
      environment: {
        [TEST_TOKEN_ENV]: 'token-value',
      },
    });

    expect(firstAttempt.recordsSent).toBe(1);
    expect(firstAttempt.malformedLines).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed NDJSON'));

    const secondFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse({ accepted: 1 }));
    const secondAttempt = await syncGatesTelemetryToCloud({
      cwd: root,
      fetchFn: secondFetch,
      now: () => 52_000,
      environment: {
        [TEST_TOKEN_ENV]: 'token-value',
      },
    });

    expect(secondAttempt.recordsRead).toBe(0);
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('does not ship when control_plane config is missing', async () => {
    const root = createWorkspaceRoot();
    writeWorkspaceYaml(root, { includeControlPlane: false });
    writeTelemetryFiles(
      root,
      [
        JSON.stringify({
          timestamp: '2026-02-25T00:00:00.000Z',
          gate_name: 'format:check',
          passed: true,
          duration_ms: 10,
        }),
      ],
      [],
    );

    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(createJsonResponse({ accepted: 1 }));
    const result = await syncGatesTelemetryToCloud({
      cwd: root,
      fetchFn,
      now: () => 70_000,
      environment: {
        [TEST_TOKEN_ENV]: 'token-value',
      },
    });

    expect(result.skippedReason).toBe('control-plane-unavailable');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
