// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-escalate.test.ts
 * Tests for the wu:escalate CLI command (WU-2225, WU-2227)
 *
 * Covers acceptance criteria:
 * - --resolve sets escalation_resolved_by and escalation_resolved_at
 * - Without --resolve shows current escalation status
 * - Missing WU errors
 * - Already-resolved path
 * - WU-2227: Worktree-aware mode for in_progress WUs
 * - WU-2227: Micro-worktree fallback for non-in_progress WUs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';

// Mock withMicroWorktree BEFORE importing the module under test
// The mock captures the execute callback so we can verify YAML writes
let capturedExecuteFn: ((ctx: { worktreePath: string }) => Promise<unknown>) | null = null;

vi.mock('@lumenflow/core/micro-worktree', () => ({
  withMicroWorktree: vi.fn(
    async (options: {
      execute: (ctx: {
        worktreePath: string;
      }) => Promise<{ commitMessage: string; files: string[] }>;
    }) => {
      capturedExecuteFn = options.execute;
      // Execute the callback with a placeholder path
      // The test sets up the file at this path before calling resolveEscalation
      const result = await options.execute({ worktreePath: '/tmp/mock-micro-wt' });
      return { ...result, ref: 'main' };
    },
  ),
}));

// Mock ensureOnMain (not needed for unit tests)
vi.mock('@lumenflow/core/wu-helpers', async () => {
  const actual = await vi.importActual<typeof import('@lumenflow/core/wu-helpers')>(
    '@lumenflow/core/wu-helpers',
  );
  return {
    ...actual,
    ensureOnMain: vi.fn().mockResolvedValue(undefined),
  };
});

// WU-2227: Mock wu-edit-validators for worktree validation functions
const mockValidateWorktreeExists = vi.fn();
const mockValidateWorktreeClean = vi.fn().mockResolvedValue(undefined);
const mockValidateWorktreeBranch = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/wu-edit-validators.js', () => ({
  validateWorktreeExists: (...args: unknown[]) => mockValidateWorktreeExists(...args),
  validateWorktreeClean: (...args: unknown[]) => mockValidateWorktreeClean(...args),
  validateWorktreeBranch: (...args: unknown[]) => mockValidateWorktreeBranch(...args),
}));

// WU-2227: Mock defaultWorktreeFrom from wu-paths
vi.mock('@lumenflow/core/wu-paths', async () => {
  const actual = await vi.importActual<typeof import('@lumenflow/core/wu-paths')>(
    '@lumenflow/core/wu-paths',
  );
  return {
    ...actual,
    defaultWorktreeFrom: vi.fn((doc: { lane?: string; id?: string }) => {
      if (!doc?.lane || !doc?.id) return null;
      const lanePart = doc.lane
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+$/, '');
      return `worktrees/${lanePart}-${doc.id.toLowerCase()}`;
    }),
  };
});

// WU-2227: Mock detectCurrentWorktree from wu-done-validators
vi.mock('@lumenflow/core/wu-done-validators', () => ({
  detectCurrentWorktree: vi.fn().mockReturnValue(null),
}));

// WU-2227: Mock createGitForPath for worktree git operations
const mockWorktreeGit = {
  raw: vi.fn().mockResolvedValue(''),
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: () => ({
    getConfigValue: vi.fn().mockResolvedValue('agent@example.com'),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getStatus: vi.fn().mockResolvedValue(''),
  }),
  createGitForPath: vi.fn(() => mockWorktreeGit),
}));

// (git-adapter mock moved above with createGitForPath support)

// Test constants
const WU_ID = 'WU-14';
const WU_DIR = 'docs/04-operations/tasks/wu';
const RESOLVER_EMAIL = 'admin@example.com';
const TEMP_PREFIX = 'wu-escalate-test-';
const MKDIR_OPTS = { recursive: true } as const;
const RM_OPTS = { recursive: true, force: true } as const;

// Import module under test AFTER mocks are set up
import { showEscalationStatus, resolveEscalation } from '../src/wu-escalate.js';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { detectCurrentWorktree } from '@lumenflow/core/wu-done-validators';

describe('wu:escalate', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    capturedExecuteFn = null;
  });

  afterEach(() => {
    rmSync(tempDir, RM_OPTS);
  });

  function writeWUFile(id: string, content: string, dir?: string): string {
    const wuDir = path.join(dir ?? tempDir, WU_DIR);
    mkdirSync(wuDir, MKDIR_OPTS);
    const wuPath = path.join(wuDir, `${id}.yaml`);
    writeFileSync(wuPath, content, 'utf-8');
    return wuPath;
  }

  describe('showEscalationStatus', () => {
    it('displays unresolved escalation triggers', () => {
      const wu: Record<string, unknown> = {
        id: WU_ID,
        escalation_triggers: ['sensitive_data', 'security_p0'],
        requires_human_escalation: true,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      showEscalationStatus(wu);
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');

      expect(output).toContain(WU_ID);
      expect(output).toContain('sensitive_data');
      expect(output).toContain('security_p0');
      expect(output).toMatch(/unresolved/i);

      consoleSpy.mockRestore();
    });

    it('displays resolved status with resolver info', () => {
      const wu: Record<string, unknown> = {
        id: WU_ID,
        escalation_triggers: ['sensitive_data'],
        requires_human_escalation: true,
        escalation_resolved_by: RESOLVER_EMAIL,
        escalation_resolved_at: '2026-02-27T10:00:00.000Z',
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      showEscalationStatus(wu);
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');

      expect(output).toMatch(/resolved/i);
      expect(output).toContain(RESOLVER_EMAIL);

      consoleSpy.mockRestore();
    });

    it('reports no escalation when triggers are empty', () => {
      const wu: Record<string, unknown> = {
        id: WU_ID,
        escalation_triggers: [],
        requires_human_escalation: false,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      showEscalationStatus(wu);
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');

      expect(output).toMatch(/no escalation/i);

      consoleSpy.mockRestore();
    });
  });

  describe('resolveEscalation', () => {
    it('errors when WU file does not exist', async () => {
      await expect(resolveEscalation('WU-999', RESOLVER_EMAIL, tempDir)).rejects.toThrow(
        /WU-999 not found/,
      );
    });

    it('errors when WU has no escalation triggers', async () => {
      writeWUFile(
        WU_ID,
        [
          'id: WU-14',
          'title: Test WU',
          'status: in_progress',
          "lane: 'Framework: Core'",
          'escalation_triggers: []',
          'requires_human_escalation: false',
        ].join('\n'),
      );

      await expect(resolveEscalation(WU_ID, RESOLVER_EMAIL, tempDir)).rejects.toThrow(
        /no escalation/i,
      );
    });

    it('errors when escalation is already resolved', async () => {
      writeWUFile(
        WU_ID,
        [
          'id: WU-14',
          'title: Test WU',
          'status: in_progress',
          "lane: 'Framework: Core'",
          'escalation_triggers:',
          '  - sensitive_data',
          'requires_human_escalation: true',
          'escalation_resolved_by: previous@example.com',
          'escalation_resolved_at: "2026-02-27T10:00:00.000Z"',
        ].join('\n'),
      );

      await expect(resolveEscalation(WU_ID, RESOLVER_EMAIL, tempDir)).rejects.toThrow(
        /already resolved/i,
      );
    });

    it('sets escalation_resolved_by and escalation_resolved_at via micro-worktree', async () => {
      const wuContent = [
        'id: WU-14',
        'title: Test WU',
        'status: in_progress',
        "lane: 'Framework: Core'",
        'escalation_triggers:',
        '  - sensitive_data',
        'requires_human_escalation: true',
      ].join('\n');

      // Write WU file at the main location for validation
      writeWUFile(WU_ID, wuContent);

      // Also write it at the mock micro-worktree path so the execute callback can read it
      writeWUFile(WU_ID, wuContent, '/tmp/mock-micro-wt');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await resolveEscalation(WU_ID, RESOLVER_EMAIL, tempDir);
      consoleSpy.mockRestore();

      expect(result).toBeDefined();
      expect(result.resolver).toBe(RESOLVER_EMAIL);
      expect(result.resolvedAt).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(result.resolvedAt).toISOString()).toBe(result.resolvedAt);

      // Verify the micro-worktree file was updated with escalation fields
      const updatedPath = path.join('/tmp/mock-micro-wt', WU_DIR, `${WU_ID}.yaml`);
      const updatedContent = readFileSync(updatedPath, 'utf-8');
      const updatedWU = yamlParse(updatedContent);

      expect(updatedWU.escalation_resolved_by).toBe(RESOLVER_EMAIL);
      expect(updatedWU.escalation_resolved_at).toBe(result.resolvedAt);
    });

    it('uses git user.email when no resolver provided', async () => {
      const wuContent = [
        'id: WU-14',
        'title: Test WU',
        'status: in_progress',
        "lane: 'Framework: Core'",
        'escalation_triggers:',
        '  - sensitive_data',
        'requires_human_escalation: true',
      ].join('\n');

      writeWUFile(WU_ID, wuContent);
      writeWUFile(WU_ID, wuContent, '/tmp/mock-micro-wt');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await resolveEscalation(WU_ID, undefined, tempDir);
      consoleSpy.mockRestore();

      // Should have used the mock git email
      expect(result.resolver).toBe('agent@example.com');
    });

    // WU-2227: Worktree-aware escalation resolution tests
    describe('worktree-aware mode (WU-2227)', () => {
      const IN_PROGRESS_WU_CONTENT = [
        'id: WU-14',
        'title: Test WU',
        'status: in_progress',
        "lane: 'Framework: Core'",
        'worktree_path: worktrees/framework-core-wu-14',
        'escalation_triggers:',
        '  - sensitive_data',
        'requires_human_escalation: true',
      ].join('\n');

      const READY_WU_CONTENT = [
        'id: WU-14',
        'title: Test WU',
        'status: ready',
        "lane: 'Framework: Core'",
        'escalation_triggers:',
        '  - sensitive_data',
        'requires_human_escalation: true',
      ].join('\n');

      beforeEach(() => {
        mockValidateWorktreeExists.mockReturnValue(undefined);
        mockValidateWorktreeClean.mockResolvedValue(undefined);
        mockValidateWorktreeBranch.mockResolvedValue(undefined);
        mockWorktreeGit.raw.mockResolvedValue('');
        mockWorktreeGit.add.mockResolvedValue(undefined);
        mockWorktreeGit.commit.mockResolvedValue(undefined);
        mockWorktreeGit.push.mockResolvedValue(undefined);
        vi.mocked(withMicroWorktree).mockClear();
        vi.mocked(detectCurrentWorktree).mockReturnValue(null);
      });

      it('edits YAML in-place for in_progress WU with worktree_path', async () => {
        // Write WU file at rootDir (simulates reading from main or worktree)
        writeWUFile(WU_ID, IN_PROGRESS_WU_CONTENT);

        // Also create the WU file in the resolved worktree path
        const worktreeDir = path.resolve(tempDir, 'worktrees/framework-core-wu-14');
        writeWUFile(WU_ID, IN_PROGRESS_WU_CONTENT, worktreeDir);

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = await resolveEscalation(WU_ID, RESOLVER_EMAIL, tempDir);
        consoleSpy.mockRestore();

        expect(result).toBeDefined();
        expect(result.resolver).toBe(RESOLVER_EMAIL);
        expect(result.resolvedAt).toBeDefined();

        // Should NOT have called withMicroWorktree
        expect(withMicroWorktree).not.toHaveBeenCalled();

        // Verify the worktree WU file was updated
        const updatedPath = path.join(worktreeDir, WU_DIR, `${WU_ID}.yaml`);
        const updatedContent = readFileSync(updatedPath, 'utf-8');
        const updatedWU = yamlParse(updatedContent);

        expect(updatedWU.escalation_resolved_by).toBe(RESOLVER_EMAIL);
        expect(updatedWU.escalation_resolved_at).toBe(result.resolvedAt);
      });

      it('uses micro-worktree for ready WU (no worktree_path)', async () => {
        writeWUFile(WU_ID, READY_WU_CONTENT);
        writeWUFile(WU_ID, READY_WU_CONTENT, '/tmp/mock-micro-wt');

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = await resolveEscalation(WU_ID, RESOLVER_EMAIL, tempDir);
        consoleSpy.mockRestore();

        expect(result).toBeDefined();
        expect(result.resolver).toBe(RESOLVER_EMAIL);

        // Should have called withMicroWorktree
        expect(withMicroWorktree).toHaveBeenCalled();
      });

      it('uses micro-worktree for in_progress WU without worktree_path', async () => {
        const wuWithoutWorktree = [
          'id: WU-14',
          'title: Test WU',
          'status: in_progress',
          "lane: 'Framework: Core'",
          'escalation_triggers:',
          '  - sensitive_data',
          'requires_human_escalation: true',
        ].join('\n');

        writeWUFile(WU_ID, wuWithoutWorktree);
        writeWUFile(WU_ID, wuWithoutWorktree, '/tmp/mock-micro-wt');

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = await resolveEscalation(WU_ID, RESOLVER_EMAIL, tempDir);
        consoleSpy.mockRestore();

        expect(result).toBeDefined();
        // Should fallback to micro-worktree since no worktree_path
        expect(withMicroWorktree).toHaveBeenCalled();
      });

      it('commits and pushes to lane branch in worktree mode', async () => {
        writeWUFile(WU_ID, IN_PROGRESS_WU_CONTENT);

        const worktreeDir = path.resolve(tempDir, 'worktrees/framework-core-wu-14');
        writeWUFile(WU_ID, IN_PROGRESS_WU_CONTENT, worktreeDir);

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await resolveEscalation(WU_ID, RESOLVER_EMAIL, tempDir);
        consoleSpy.mockRestore();

        // Should have committed and pushed using worktree git
        expect(mockWorktreeGit.add).toHaveBeenCalled();
        expect(mockWorktreeGit.commit).toHaveBeenCalled();
        expect(mockWorktreeGit.push).toHaveBeenCalled();
      });
    });
  });
});
