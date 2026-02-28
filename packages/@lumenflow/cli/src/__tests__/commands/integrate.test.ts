// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file integrate.test.ts
 * Tests for Claude Code integration command (WU-1367)
 */

// Test file lint exceptions

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Mock fs
vi.mock('node:fs');

const TEST_PROJECT_DIR = '/test/project';
const TEST_CLAUDE_CLIENT_ID = 'claude-code';
const TEST_CLAUDE_HOOKS_DIR = '.claude/hooks/';
const TEST_ENFORCE_WORKTREE = 'enforce-worktree.sh';
const TEST_REQUIRE_WU = 'require-wu.sh';
const TEST_WARN_INCOMPLETE = 'warn-incomplete.sh';

describe('WU-1367: Integrate Command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  });

  describe('WU-2275: --sync core enforcement scaffolding', () => {
    it('parses --sync option', async () => {
      const { parseIntegrateOptions } = await import('../../commands/integrate.js');
      const originalArgv = process.argv;
      process.argv = ['node', 'integrate', '--client', TEST_CLAUDE_CLIENT_ID, '--sync'];
      try {
        const opts = parseIntegrateOptions();
        expect(opts.sync).toBe(true);
      } finally {
        process.argv = originalArgv;
      }
    });

    it('writes thin delegator pre-commit and CI workflow when sync is enabled', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const file = String(filePath);
        if (file.endsWith('pre-commit.template')) {
          return '#!/bin/sh\npnpm lumenflow:pre-commit-check\n';
        }
        if (file.endsWith('lumenflow-ci.yml.template')) {
          return 'name: LumenFlow CI\n';
        }
        return '{}';
      });
      const writeSpy = vi.mocked(fs.writeFileSync);
      writeSpy.mockClear();

      const { syncCoreEnforcementDelegators } = await import('../../commands/integrate.js');
      const created = syncCoreEnforcementDelegators(TEST_PROJECT_DIR);

      expect(created).toContain('.husky/pre-commit');
      expect(created).toContain('.github/workflows/lumenflow-ci.yml');
      const wrotePreCommit = writeSpy.mock.calls.some((call) =>
        String(call[0]).includes('.husky/pre-commit'),
      );
      const wroteCi = writeSpy.mock.calls.some((call) =>
        String(call[0]).includes('.github/workflows/lumenflow-ci.yml'),
      );
      expect(wrotePreCommit).toBe(true);
      expect(wroteCi).toBe(true);
    });
  });

  describe('integrateClaudeCode', () => {
    it('should skip integration when enforcement not enabled', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      const created = await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: false,
        },
      });

      // Should not write UnsafeAny files
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(created).toEqual([]);
    });

    it('should create hooks directory when it does not exist', async () => {
      const mockMkdirSync = vi.mocked(fs.mkdirSync);
      vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
        },
      });

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining(TEST_CLAUDE_HOOKS_DIR), {
        recursive: true,
      });
    });

    it('should generate enforce-worktree.sh when block_outside_worktree=true', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: false,
          warn_on_stop_without_wu_done: false,
        },
      });

      const enforceWorktreeCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes(TEST_ENFORCE_WORKTREE),
      );
      expect(enforceWorktreeCall).toBeDefined();
      expect(enforceWorktreeCall![1]).toContain(TEST_ENFORCE_WORKTREE);
    });

    it('should generate require-wu.sh when require_wu_for_edits=true', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: false,
          require_wu_for_edits: true,
          warn_on_stop_without_wu_done: false,
        },
      });

      const requireWuCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes(TEST_REQUIRE_WU),
      );
      expect(requireWuCall).toBeDefined();
    });

    it('should generate warn-incomplete.sh when warn_on_stop_without_wu_done=true', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: false,
          require_wu_for_edits: false,
          warn_on_stop_without_wu_done: true,
        },
      });

      const warnIncompleteCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes(TEST_WARN_INCOMPLETE),
      );
      expect(warnIncompleteCall).toBeDefined();
    });

    it('should return created hook paths for adapter consumers', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      const created = await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: true,
          warn_on_stop_without_wu_done: false,
        },
      });

      expect(created).toEqual([
        path.join(TEST_CLAUDE_HOOKS_DIR, TEST_ENFORCE_WORKTREE),
        path.join(TEST_CLAUDE_HOOKS_DIR, TEST_REQUIRE_WU),
      ]);
    });

    it('should keep client config lookup keyed by canonical client ID', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const file = String(filePath);
        if (file.endsWith('workspace.yaml')) {
          return `
software_delivery:
  agents:
    clients:
      ${TEST_CLAUDE_CLIENT_ID}:
        enforcement:
          hooks: true
          block_outside_worktree: true
`;
        }
        return '{}';
      });
      mockWriteFileSync.mockClear();

      const { main } = await import('../../commands/integrate.js');
      const originalArgv = process.argv;
      process.argv = ['node', 'integrate', '--client', TEST_CLAUDE_CLIENT_ID];
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(TEST_PROJECT_DIR);

      try {
        await main();
      } finally {
        process.argv = originalArgv;
        cwdSpy.mockRestore();
      }

      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should update settings.json with PreToolUse hooks', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          $schema: 'https://json.schemastore.org/claude-code-settings.json',
          permissions: { allow: ['Bash'] },
        }),
      );
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
        },
      });

      const settingsCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes('settings.json'),
      );
      expect(settingsCall).toBeDefined();

      const settingsContent = JSON.parse(settingsCall![1] as string);
      expect(settingsContent.hooks).toBeDefined();
      expect(settingsContent.hooks.PreToolUse).toBeDefined();
      expect(settingsContent.hooks.PreToolUse[0].matcher).toBe('Write|Edit');
    });

    it('should update settings.json with Stop hooks', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: false,
          require_wu_for_edits: false,
          warn_on_stop_without_wu_done: true,
        },
      });

      const settingsCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes('settings.json'),
      );
      expect(settingsCall).toBeDefined();

      const settingsContent = JSON.parse(settingsCall![1] as string);
      expect(settingsContent.hooks).toBeDefined();
      expect(settingsContent.hooks.Stop).toBeDefined();
    });

    it('should preserve existing permissions when updating settings.json', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          $schema: 'https://json.schemastore.org/claude-code-settings.json',
          permissions: {
            allow: ['Bash', 'Read', 'Write'],
            deny: ['Bash(rm -rf /*)'],
          },
        }),
      );
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
        },
      });

      const settingsCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes('settings.json'),
      );
      expect(settingsCall).toBeDefined();

      const settingsContent = JSON.parse(settingsCall![1] as string);
      expect(settingsContent.permissions).toBeDefined();
      expect(settingsContent.permissions.allow).toContain('Bash');
      expect(settingsContent.permissions.deny).toContain('Bash(rm -rf /*)');
    });
  });
});
