// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file worktree-enforcement.test.ts
 * @description Tests for MCP worktree enforcement guard
 *
 * WU-1853: MCP file_write and file_edit tools bypass enforce-worktree hook.
 * These tests verify that the enforcement guard blocks writes to main checkout
 * while allowing writes to worktrees and allowlisted paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  checkWorktreeEnforcement,
  type WorktreeEnforcementResult,
  WORKTREE_ENFORCEMENT_ERROR_CODE,
} from '../worktree-enforcement.js';

// Mock @lumenflow/core for config loading
vi.mock('@lumenflow/core', async () => {
  const actual = await vi.importActual('@lumenflow/core');
  return {
    ...actual,
    getConfig: vi.fn(),
    findProjectRoot: vi.fn(),
  };
});

// Mock node:fs for git branch detection and worktree detection
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock node:child_process for git branch detection
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { getConfig, findProjectRoot } from '@lumenflow/core';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const mockGetConfig = vi.mocked(getConfig);
const mockFindProjectRoot = vi.mocked(findProjectRoot);
const mockExistsSync = vi.mocked(existsSync);
const mockExecFileSync = vi.mocked(execFileSync);

describe('worktree-enforcement', () => {
  const PROJECT_ROOT = '/mock/project';

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindProjectRoot.mockReturnValue(PROJECT_ROOT);
    // Default: .lumenflow dir exists (LumenFlow is configured)
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join(PROJECT_ROOT, '.lumenflow')) return true;
      if (String(p) === path.join(PROJECT_ROOT, 'worktrees')) return true;
      return false;
    });
    // Default: on main branch (execFileSync with encoding: 'utf8' returns string)
    mockExecFileSync.mockReturnValue('main\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AC1: file_write on main checkout is blocked when enforcement is active', () => {
    it('should block file_write to main checkout path when block_outside_worktree is true', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe(WORKTREE_ENFORCEMENT_ERROR_CODE);
      expect(result.reason).toContain('main');
    });

    it('should block file_edit to main checkout path when block_outside_worktree is true', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'packages/@lumenflow/core/src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe(WORKTREE_ENFORCEMENT_ERROR_CODE);
    });

    it('should allow writes when block_outside_worktree is false', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: false,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes when not on main/master branch', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      // On a lane branch, not main
      mockExecFileSync.mockReturnValue('lane/framework-mcp/wu-1853\n');

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('AC2: file_write inside a worktree succeeds regardless of enforcement', () => {
    it('should allow writes to worktree paths when enforcement is active', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: path.join(PROJECT_ROOT, 'worktrees/framework-mcp-wu-1853/src/index.ts'),
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes to worktree paths with relative path inside worktree', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'worktrees/framework-mcp-wu-1853/src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('AC3: file_write on allowlisted paths succeeds on main', () => {
    it('should allow writes to .lumenflow/ paths on main', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: '.lumenflow/stamps/WU-1853.done',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes to .claude/ paths on main', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: '.claude/hooks/enforce-worktree.sh',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes to WU YAML spec paths on main', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'docs/tasks/wu/WU-1853.yaml',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes to plan/ paths on main', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'plan/WU-1853-plan.md',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('AC4: graceful degradation when config cannot be read', () => {
    it('should allow writes when getConfig throws', () => {
      mockGetConfig.mockImplementation(() => {
        throw new Error('Config parse error');
      });

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes when .lumenflow dir does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes when enforcement config is not present', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {},
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow writes when git branch detection fails', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      mockExecFileSync.mockImplementation(() => {
        throw new Error('git not found');
      });

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle master branch same as main', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      mockExecFileSync.mockReturnValue('master\n');

      const result = checkWorktreeEnforcement({
        filePath: 'src/index.ts',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(false);
    });

    it('should handle absolute file paths that resolve into the project', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: path.join(PROJECT_ROOT, 'src/index.ts'),
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow writes outside the project root entirely', () => {
      mockGetConfig.mockReturnValue({
        directories: {
          worktrees: 'worktrees',
          wuDir: 'docs/tasks/wu',
        },
        agents: {
          clients: {
            'claude-code': {
              enforcement: {
                hooks: true,
                block_outside_worktree: true,
                require_wu_for_edits: false,
                warn_on_stop_without_wu_done: false,
              },
            },
          },
        },
      } as ReturnType<typeof getConfig>);

      const result = checkWorktreeEnforcement({
        filePath: '/tmp/somefile.txt',
        projectRoot: PROJECT_ROOT,
      });

      expect(result.allowed).toBe(true);
    });

    it('should export the WORKTREE_ENFORCEMENT_ERROR_CODE constant', () => {
      expect(WORKTREE_ENFORCEMENT_ERROR_CODE).toBe('WORKTREE_ENFORCEMENT_BLOCKED');
    });
  });
});
