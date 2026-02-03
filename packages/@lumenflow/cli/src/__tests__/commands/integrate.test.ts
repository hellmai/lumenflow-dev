/**
 * @file integrate.test.ts
 * Tests for Claude Code integration command (WU-1367)
 */

// Test file lint exceptions
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable sonarjs/no-duplicate-string */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';

// Mock fs
vi.mock('node:fs');

const TEST_PROJECT_DIR = '/test/project';

describe('WU-1367: Integrate Command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  });

  describe('integrateClaudeCode', () => {
    it('should skip integration when enforcement not enabled', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      mockWriteFileSync.mockClear();

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      await integrateClaudeCode(TEST_PROJECT_DIR, {
        enforcement: {
          hooks: false,
        },
      });

      // Should not write any files
      expect(mockWriteFileSync).not.toHaveBeenCalled();
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

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('.claude/hooks'), {
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
        String(call[0]).includes('enforce-worktree.sh'),
      );
      expect(enforceWorktreeCall).toBeDefined();
      expect(enforceWorktreeCall![1]).toContain('enforce-worktree.sh');
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
        String(call[0]).includes('require-wu.sh'),
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
        String(call[0]).includes('warn-incomplete.sh'),
      );
      expect(warnIncompleteCall).toBeDefined();
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
