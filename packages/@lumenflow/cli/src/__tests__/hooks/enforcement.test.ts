/**
 * @file enforcement.test.ts
 * Tests for Claude Code enforcement hooks (WU-1367)
 *
 * TDD: Write failing tests first, then implement.
 */

// Test file lint exceptions

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';

// Mock fs before importing module under test
vi.mock('node:fs');
vi.mock('node:child_process');

const TEST_PROJECT_DIR = '/test/project';
const CONFIG_FILE_NAME = '.lumenflow.config.yaml';

describe('WU-1367: Enforcement Hooks Config Schema', () => {
  describe('ClientConfigSchema enforcement block', () => {
    it('should accept enforcement block under agents.clients.claude-code', async () => {
      // Import dynamically to allow mocking
      const { ClientConfigSchema } =
        await import('@lumenflow/core/dist/lumenflow-config-schema.js');

      const config = {
        preamble: 'CLAUDE.md',
        skillsDir: '.claude/skills',
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: true,
          warn_on_stop_without_wu_done: true,
        },
      };

      const result = ClientConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enforcement).toEqual({
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: true,
          warn_on_stop_without_wu_done: true,
        });
      }
    });

    it('should default enforcement values to false when not specified', async () => {
      const { ClientConfigSchema } =
        await import('@lumenflow/core/dist/lumenflow-config-schema.js');

      const config = {
        preamble: 'CLAUDE.md',
        enforcement: {},
      };

      const result = ClientConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enforcement?.hooks).toBe(false);
        expect(result.data.enforcement?.block_outside_worktree).toBe(false);
        expect(result.data.enforcement?.require_wu_for_edits).toBe(false);
        expect(result.data.enforcement?.warn_on_stop_without_wu_done).toBe(false);
      }
    });

    it('should allow enforcement to be undefined', async () => {
      const { ClientConfigSchema } =
        await import('@lumenflow/core/dist/lumenflow-config-schema.js');

      const config = {
        preamble: 'CLAUDE.md',
      };

      const result = ClientConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enforcement).toBeUndefined();
      }
    });
  });
});

describe('WU-1367: Hook Generation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('generateEnforcementHooks', () => {
    it('should generate PreToolUse hook for Write/Edit blocking when block_outside_worktree=true', async () => {
      const { generateEnforcementHooks } = await import('../../hooks/enforcement-generator.js');

      const config = {
        block_outside_worktree: true,
        require_wu_for_edits: false,
        warn_on_stop_without_wu_done: false,
      };

      const hooks = generateEnforcementHooks(config);

      expect(hooks.preToolUse).toBeDefined();
      expect(hooks.preToolUse?.length).toBeGreaterThan(0);
      expect(hooks.preToolUse?.[0].matcher).toBe('Write|Edit');
    });

    it('should generate PreToolUse hook for WU requirement when require_wu_for_edits=true', async () => {
      const { generateEnforcementHooks } = await import('../../hooks/enforcement-generator.js');

      const config = {
        block_outside_worktree: false,
        require_wu_for_edits: true,
        warn_on_stop_without_wu_done: false,
      };

      const hooks = generateEnforcementHooks(config);

      expect(hooks.preToolUse).toBeDefined();
      expect(hooks.preToolUse?.some((h) => h.matcher === 'Write|Edit')).toBe(true);
    });

    it('should generate Stop hook when warn_on_stop_without_wu_done=true', async () => {
      const { generateEnforcementHooks } = await import('../../hooks/enforcement-generator.js');

      const config = {
        block_outside_worktree: false,
        require_wu_for_edits: false,
        warn_on_stop_without_wu_done: true,
      };

      const hooks = generateEnforcementHooks(config);

      expect(hooks.stop).toBeDefined();
      expect(hooks.stop?.length).toBeGreaterThan(0);
    });

    it('should return empty hooks when all enforcement options are false', async () => {
      const { generateEnforcementHooks } = await import('../../hooks/enforcement-generator.js');

      const config = {
        block_outside_worktree: false,
        require_wu_for_edits: false,
        warn_on_stop_without_wu_done: false,
      };

      const hooks = generateEnforcementHooks(config);

      expect(hooks.preToolUse).toBeUndefined();
      expect(hooks.stop).toBeUndefined();
    });
  });

  describe('WU-1505: SessionStart dirty-main warning', () => {
    it('should include dirty-main detection using git status --porcelain', async () => {
      const { generateSessionStartRecoveryScript } = await import('../../hooks/enforcement-generator.js');
      const script = generateSessionStartRecoveryScript();

      expect(script).toContain('status --porcelain');
      expect(script).toContain('DIRTY_LINES=');
    });

    it('should include main-checkout-only guard', async () => {
      const { generateSessionStartRecoveryScript } = await import('../../hooks/enforcement-generator.js');
      const script = generateSessionStartRecoveryScript();

      expect(script).toContain('CURRENT_BRANCH=');
      expect(script).toContain('[[ "$CURRENT_BRANCH" == "main" ]]');
    });

    it('should skip warning when running inside a worktree checkout', async () => {
      const { generateSessionStartRecoveryScript } = await import('../../hooks/enforcement-generator.js');
      const script = generateSessionStartRecoveryScript();

      expect(script).toContain('WORKTREES_DIR=');
      expect(script).toContain('[[ "$CWD" != "${WORKTREES_DIR}/"* ]]');
    });
  });
});

describe('WU-1367: Integrate Command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('integrateClaudeCode', () => {
    it('should create .claude/hooks directory when enforcement.hooks=true', async () => {
      const mockMkdirSync = vi.mocked(fs.mkdirSync);
      vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      const config = {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: false,
          warn_on_stop_without_wu_done: false,
        },
      };

      await integrateClaudeCode(TEST_PROJECT_DIR, config);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.claude/hooks'),
        expect.any(Object),
      );
    });

    it('should generate enforce-worktree.sh hook when block_outside_worktree=true', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      const config = {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: false,
          warn_on_stop_without_wu_done: false,
        },
      };

      await integrateClaudeCode(TEST_PROJECT_DIR, config);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('enforce-worktree.sh'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should update settings.json with hook configuration', async () => {
      const mockWriteFileSync = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          permissions: { allow: ['Bash'] },
        }),
      );
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

      const { integrateClaudeCode } = await import('../../commands/integrate.js');

      const config = {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: false,
          warn_on_stop_without_wu_done: false,
        },
      };

      await integrateClaudeCode(TEST_PROJECT_DIR, config);

      // Should write updated settings.json with hooks config
      const settingsCall = mockWriteFileSync.mock.calls.find((call) =>
        String(call[0]).includes('settings.json'),
      );
      expect(settingsCall).toBeDefined();

      const settingsContent = JSON.parse(settingsCall![1] as string);
      expect(settingsContent.hooks).toBeDefined();
      expect(settingsContent.hooks.PreToolUse).toBeDefined();
    });
  });
});

describe('WU-1367: Hook Graceful Degradation', () => {
  it('should allow operation when LumenFlow state cannot be determined', async () => {
    // The hook should fail-open if it cannot determine LumenFlow state
    // This prevents blocking legitimate work due to infrastructure issues

    const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');

    // Simulate missing .lumenflow directory
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await checkWorktreeEnforcement({
      file_path: '/some/path/file.ts',
      tool_name: 'Write',
    });

    // Should not block - graceful degradation
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('graceful');
  });

  it('should allow operation when worktree detection fails', async () => {
    const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');

    // Simulate git command failure
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mockExecFileSync = vi.fn().mockImplementation(() => {
      throw new Error('git command failed');
    });
    vi.doMock('node:child_process', () => ({
      execFileSync: mockExecFileSync,
    }));

    const result = await checkWorktreeEnforcement({
      file_path: '/some/path/file.ts',
      tool_name: 'Write',
    });

    // Should not block - graceful degradation
    expect(result.allowed).toBe(true);
  });
});

describe('WU-1367: Setup Hook Sync', () => {
  it('should sync hooks when enforcement.hooks=true in config', async () => {
    // This tests that pnpm setup syncs hooks appropriately
    const mockWriteFileSync = vi.mocked(fs.writeFileSync);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    // Mock existsSync to return false for most paths (so dirs get created)
    // but return true for the config file
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr.endsWith(CONFIG_FILE_NAME);
    });

    // Config file is YAML, not JSON
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.endsWith(CONFIG_FILE_NAME)) {
        return `
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
`;
      }
      // Return empty JSON for settings.json
      return '{}';
    });

    // Clear any previous calls
    mockWriteFileSync.mockClear();

    const { syncEnforcementHooks } = await import('../../hooks/enforcement-sync.js');

    const result = await syncEnforcementHooks(TEST_PROJECT_DIR);

    // Should have written hook files
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('should skip hook sync when enforcement.hooks=false', async () => {
    const mockWriteFileSync = vi.mocked(fs.writeFileSync);

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr.endsWith(CONFIG_FILE_NAME);
    });

    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.endsWith(CONFIG_FILE_NAME)) {
        return `
agents:
  clients:
    claude-code:
      enforcement:
        hooks: false
`;
      }
      return '{}';
    });

    // Clear any previous calls
    mockWriteFileSync.mockClear();

    const { syncEnforcementHooks } = await import('../../hooks/enforcement-sync.js');

    const result = await syncEnforcementHooks(TEST_PROJECT_DIR);

    // Should NOT have written hook files
    expect(result).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
