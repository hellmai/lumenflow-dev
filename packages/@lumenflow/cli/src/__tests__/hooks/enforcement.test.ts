// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file enforcement.test.ts
 * Tests for Claude Code enforcement hooks (WU-1367)
 *
 * TDD: Write failing tests first, then implement.
 */

// Test file lint exceptions

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Mock fs before importing module under test
vi.mock('node:fs');
vi.mock('node:child_process');

const TEST_PROJECT_DIR = '/test/project';
const CONFIG_FILE_NAME = 'workspace.yaml';

describe('WU-1367: Enforcement Hooks Config Schema', () => {
  describe('ClientConfigSchema enforcement block', () => {
    it('should accept enforcement block under agents.clients.claude-code', async () => {
      // Import dynamically to allow mocking
      const { ClientConfigSchema } = await import('@lumenflow/core/config-schema');

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
      const { ClientConfigSchema } = await import('@lumenflow/core/config-schema');

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
      const { ClientConfigSchema } = await import('@lumenflow/core/config-schema');

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
    }, 15000);

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

  describe('SessionStart recovery (WU-1638: dirty-main warning removed)', () => {
    it('should NOT include dirty-main detection (removed by WU-1638)', async () => {
      const { generateSessionStartRecoveryScript } =
        await import('../../hooks/enforcement-generator.js');
      const script = generateSessionStartRecoveryScript();

      expect(script).not.toContain('DIRTY MAIN CHECKOUT DETECTED');
      expect(script).not.toContain('DIRTY_LINES=');
    });

    it('should still include recovery file detection', async () => {
      const { generateSessionStartRecoveryScript } =
        await import('../../hooks/enforcement-generator.js');
      const script = generateSessionStartRecoveryScript();

      expect(script).toContain('RECOVERY_DIR=');
      expect(script).toContain('recovery-pending-');
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

describe('WU-2277: WU requirement scopes to repository paths', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function mockNoClaim(): void {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('.lumenflow'));
  }

  it('should allow Write to /tmp without claimed WU', async () => {
    const { checkWuRequirement } = await import('../../hooks/enforcement-checks.js');
    mockNoClaim();

    const result = await checkWuRequirement(
      { file_path: '/tmp/plan-theming.md', tool_name: 'Write' },
      '/test/project',
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('outside repository');
  });

  it('should allow Write to home-relative path outside repo without claimed WU', async () => {
    const { checkWuRequirement } = await import('../../hooks/enforcement-checks.js');
    mockNoClaim();

    const previousHome = process.env.HOME;
    process.env.HOME = '/home/test-user';
    try {
      const result = await checkWuRequirement(
        { file_path: '~/.claude/plans/plan.md', tool_name: 'Write' },
        '/test/project',
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('outside repository');
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });

  it('should block Write inside repo without claimed WU', async () => {
    const { checkWuRequirement } = await import('../../hooks/enforcement-checks.js');
    mockNoClaim();

    const result = await checkWuRequirement(
      { file_path: '/test/project/packages/@lumenflow/cli/src/index.ts', tool_name: 'Write' },
      '/test/project',
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('no WU claimed');
  });
});

// =================================================================
// WU-1501: Fail-closed default on main
// =================================================================

describe('WU-1501: Fail-closed default on main', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('AC1: checkWorktreeEnforcement blocks when no active claim context', () => {
    it('should block Write on main when no worktrees directory exists', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');

      // .lumenflow exists but worktrees dir does not, no state file
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('.lumenflow')) return true;
        return false;
      });

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/packages/cli/src/file.ts', tool_name: 'Write' },
        '/test/project',
      );

      // WU-1501: Should block (fail-closed) instead of allowing
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('no active claim');
    });

    it('should block Write on main when worktrees directory is empty', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('.lumenflow')) return true;
        if (pathStr.endsWith('worktrees')) return true;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/packages/cli/src/file.ts', tool_name: 'Write' },
        '/test/project',
      );

      // WU-1501: Should block (fail-closed) instead of allowing
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('no active claim');
    });
  });

  describe('AC2: Explicit allowlist paths', () => {
    // Helper: mock filesystem with no worktrees and no state file
    function mockNoActiveClaim(): void {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('.lumenflow')) return true;
        return false;
      });
    }

    it('should allow Write to WU YAML files (configured wuDir)', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');
      const { createWuPaths } = await import('@lumenflow/core/wu-paths');
      mockNoActiveClaim();
      const wuFilePath = path.join(
        TEST_PROJECT_DIR,
        createWuPaths({ projectRoot: TEST_PROJECT_DIR }).WU('WU-1501'),
      );

      const result = await checkWorktreeEnforcement(
        {
          file_path: wuFilePath,
          tool_name: 'Write',
        },
        '/test/project',
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('allowlist');
    });

    it('should allow Write to .lumenflow/ state files', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');
      mockNoActiveClaim();

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/.lumenflow/state/wu-events.jsonl', tool_name: 'Write' },
        '/test/project',
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('allowlist');
    });

    it('should allow Write to .claude/ config files', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');
      mockNoActiveClaim();

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/.claude/settings.json', tool_name: 'Write' },
        '/test/project',
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('allowlist');
    });

    it('should allow Write to plan/ scaffold paths', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');
      mockNoActiveClaim();

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/plan/WU-1501-plan.md', tool_name: 'Write' },
        '/test/project',
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('allowlist');
    });

    it('should allow Write to home-relative path outside the repo', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');
      mockNoActiveClaim();

      const previousHome = process.env.HOME;
      process.env.HOME = '/home/test-user';
      try {
        const result = await checkWorktreeEnforcement(
          { file_path: '~/.claude/plans/example.md', tool_name: 'Write' },
          '/test/project',
        );

        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('outside repository');
      } finally {
        if (previousHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = previousHome;
        }
      }
    });

    it('should block Write to non-allowlisted paths on main', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');
      mockNoActiveClaim();

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/packages/cli/src/some-code.ts', tool_name: 'Write' },
        '/test/project',
      );

      expect(result.allowed).toBe(false);
    });

    it('should block Edit to non-allowlisted paths on main', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');
      mockNoActiveClaim();

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/packages/core/src/index.ts', tool_name: 'Edit' },
        '/test/project',
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('AC3: Branch-PR claimed_mode remains writable', () => {
    it('should allow Write on main when branch-pr WU is claimed', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');

      // .lumenflow exists, worktrees dir does not, but state file has branch-pr claim
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('.lumenflow')) return true;
        if (pathStr.includes('wu-events.jsonl')) return true;
        return false;
      });

      vi.mocked(fs.readFileSync).mockReturnValue(
        '{"event":"claim","wu_id":"WU-1501","status":"in_progress","claimed_mode":"branch-pr"}\n',
      );

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/packages/cli/src/some-code.ts', tool_name: 'Write' },
        '/test/project',
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('branch-pr');
    });

    it('should block when state has only worktree-mode claims (no active worktrees)', async () => {
      const { checkWorktreeEnforcement } = await import('../../hooks/enforcement-checks.js');

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('.lumenflow')) return true;
        if (pathStr.includes('wu-events.jsonl')) return true;
        return false;
      });

      // Only worktree mode claims, no branch-pr
      vi.mocked(fs.readFileSync).mockReturnValue(
        '{"event":"claim","wu_id":"WU-1500","status":"in_progress","claimed_mode":"worktree"}\n',
      );

      const result = await checkWorktreeEnforcement(
        { file_path: '/test/project/packages/cli/src/some-code.ts', tool_name: 'Write' },
        '/test/project',
      );

      // Should block: worktree WU exists but no active worktree found
      expect(result.allowed).toBe(false);
    });
  });

  describe('AC4: Generated enforce-worktree.sh uses fail-closed wrappers', () => {
    it('should NOT exit 0 when no worktrees exist in generated script', async () => {
      const { generateEnforceWorktreeScript } =
        await import('../../hooks/enforcement-generator.js');
      const script = generateEnforceWorktreeScript();

      // The generated script must not have an early exit 0 for empty worktree count
      // Previously: if worktree count == 0 -> exit 0 (fail-open)
      // Now: continue to allowlist/blocking logic (fail-closed)
      expect(script).not.toMatch(/if \[\[ "\$WORKTREE_COUNT" -eq 0 \]\];\s*then\s*\n\s*exit 0/);
    });

    it('should include allowlist patterns in generated script', async () => {
      const { generateEnforceWorktreeScript } =
        await import('../../hooks/enforcement-generator.js');
      const { createWuPaths } = await import('@lumenflow/core/wu-paths');
      const expectedWuAllowlistPrefix = `${createWuPaths({
        projectRoot: TEST_PROJECT_DIR,
      }).WU_DIR()}/`;
      const script = generateEnforceWorktreeScript({ projectRoot: TEST_PROJECT_DIR });

      // Should contain allowlist checking
      expect(script).toContain('.lumenflow/');
      expect(script).toContain('.claude/');
      expect(script).toContain(expectedWuAllowlistPrefix);
    });

    it('should canonicalize home-relative paths in generated script', async () => {
      const { generateEnforceWorktreeScript } =
        await import('../../hooks/enforcement-generator.js');
      const script = generateEnforceWorktreeScript();

      expect(script).toContain('CANONICAL_PATH="$FILE_PATH"');
      expect(script).toContain('CANONICAL_PATH="${HOME}/${CANONICAL_PATH:2}"');
    });

    it('should check for branch-pr claimed_mode in generated script', async () => {
      const { generateEnforceWorktreeScript } =
        await import('../../hooks/enforcement-generator.js');
      const script = generateEnforceWorktreeScript();

      expect(script).toContain('branch-pr');
      expect(script).toContain('claimed_mode');
    });
  });
});

describe('WU-2277: Generated require-wu.sh scopes to repository paths', () => {
  it('should parse file_path and skip non-repo targets', async () => {
    const { generateRequireWuScript } = await import('../../hooks/enforcement-generator.js');
    const script = generateRequireWuScript();

    expect(script).toContain("tool_input = data.get('tool_input', {})");
    expect(script).toContain('FILE_PATH=$(echo "$PARSE_RESULT" | sed -n \'3p\')');
    expect(script).toContain('CANONICAL_PATH="$FILE_PATH"');
    expect(script).toContain('RESOLVED_PATH=$(realpath -m "$CANONICAL_PATH"');
    expect(script).toContain('if [[ "$RESOLVED_PATH" != "${MAIN_REPO_PATH}/"*');
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
software_delivery:
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

    // Clear UnsafeAny previous calls
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
software_delivery:
  agents:
    clients:
      claude-code:
        enforcement:
          hooks: false
`;
      }
      return '{}';
    });

    // Clear UnsafeAny previous calls
    mockWriteFileSync.mockClear();

    const { syncEnforcementHooks } = await import('../../hooks/enforcement-sync.js');

    const result = await syncEnforcementHooks(TEST_PROJECT_DIR);

    // Should NOT have written hook files
    expect(result).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

// =================================================================
describe('generateEnforcementHooks PostToolUse hooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should not include PostToolUse hooks with minimal config', async () => {
    const { generateEnforcementHooks } = await import('../../hooks/enforcement-generator.js');

    const hooks = generateEnforcementHooks({
      block_outside_worktree: false,
      require_wu_for_edits: false,
      warn_on_stop_without_wu_done: false,
    });

    // No postToolUse hooks when no auto-checkpoint configured
    expect(hooks.postToolUse).toBeUndefined();
  });

  it('should include PostToolUse auto-checkpoint hook when enabled', async () => {
    const { generateEnforcementHooks } = await import('../../hooks/enforcement-generator.js');

    const hooks = generateEnforcementHooks({
      block_outside_worktree: false,
      require_wu_for_edits: false,
      warn_on_stop_without_wu_done: false,
      auto_checkpoint: { enabled: true, interval_tool_calls: 20 },
    });

    expect(hooks.postToolUse).toBeDefined();
    const allEntry = hooks.postToolUse?.find((entry) => entry.matcher === '.*');
    expect(allEntry).toBeDefined();
    expect(allEntry!.hooks[0].command).toContain('auto-checkpoint.sh');
  });
});
