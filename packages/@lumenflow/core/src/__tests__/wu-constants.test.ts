// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Tests for wu-constants module
 *
 * WU-1102: INIT-003 Phase 2b - Migrate WU helpers to @lumenflow/core
 *
 * Tests cover:
 * - Constants exports (BRANCHES, WU_STATUS, PATTERNS, etc.)
 * - toKebab function
 * - getWorktreePath function
 * - getLaneBranch function
 * - getProjectRoot function
 *
 * @module __tests__/wu-constants.test
 */

import { describe, it, expect } from 'vitest';
import { getConfig } from '../lumenflow-config.js';
import {
  BRANCHES,
  REMOTES,
  GIT_REFS,
  WU_STATUS,
  WU_STATUS_GROUPS,
  CLAIMED_MODES,
  PATTERNS,
  COMMIT_FORMATS,
  LOG_PREFIX,
  DEFAULTS,
  FILE_SYSTEM,
  STRING_LITERALS,
  LUMENFLOW_PATHS,
  SIZING_GUIDE_REF,
  toKebab,
  getWorktreePath,
  getLaneBranch,
  getProjectRoot,
} from '../wu-constants.js';

describe('wu-constants', () => {
  describe('BRANCHES', () => {
    it('should export MAIN as "main"', () => {
      expect(BRANCHES.MAIN).toBe('main');
    });

    it('should export MASTER for legacy support', () => {
      expect(BRANCHES.MASTER).toBe('master');
    });

    it('should export TEMP_PREFIX', () => {
      expect(BRANCHES.TEMP_PREFIX).toBe('tmp/');
    });
  });

  describe('REMOTES', () => {
    it('should export ORIGIN', () => {
      expect(REMOTES.ORIGIN).toBe('origin');
    });
  });

  describe('GIT_REFS', () => {
    it('should export ORIGIN_MAIN', () => {
      expect(GIT_REFS.ORIGIN_MAIN).toBe('origin/main');
    });

    it('should have remote function', () => {
      expect(GIT_REFS.remote('origin', 'main')).toBe('origin/main');
      expect(GIT_REFS.remote('upstream', 'develop')).toBe('upstream/develop');
    });

    it('should export HEAD', () => {
      expect(GIT_REFS.HEAD).toBe('HEAD');
    });

    it('should export UPSTREAM', () => {
      expect(GIT_REFS.UPSTREAM).toBe('@{u}');
    });
  });

  describe('WU_STATUS', () => {
    it('should export all status values', () => {
      expect(WU_STATUS.READY).toBe('ready');
      expect(WU_STATUS.IN_PROGRESS).toBe('in_progress');
      expect(WU_STATUS.BLOCKED).toBe('blocked');
      expect(WU_STATUS.DONE).toBe('done');
    });

    it('should export legacy status values', () => {
      expect(WU_STATUS.TODO).toBe('todo');
      expect(WU_STATUS.BACKLOG).toBe('backlog');
      expect(WU_STATUS.COMPLETED).toBe('completed');
    });

    it('should export terminal statuses', () => {
      expect(WU_STATUS.CANCELLED).toBe('cancelled');
      expect(WU_STATUS.ABANDONED).toBe('abandoned');
      expect(WU_STATUS.DEFERRED).toBe('deferred');
    });
  });

  describe('WU_STATUS_GROUPS', () => {
    it('should have UNCLAIMED group', () => {
      expect(WU_STATUS_GROUPS.UNCLAIMED).toContain('ready');
      expect(WU_STATUS_GROUPS.UNCLAIMED).toContain('todo');
      expect(WU_STATUS_GROUPS.UNCLAIMED).toContain('backlog');
    });

    it('should have TERMINAL group', () => {
      expect(WU_STATUS_GROUPS.TERMINAL).toContain('done');
      expect(WU_STATUS_GROUPS.TERMINAL).toContain('completed');
      expect(WU_STATUS_GROUPS.TERMINAL).toContain('cancelled');
    });
  });

  describe('CLAIMED_MODES', () => {
    it('should export WORKTREE mode', () => {
      expect(CLAIMED_MODES.WORKTREE).toBe('worktree');
    });

    it('should export BRANCH_ONLY mode', () => {
      expect(CLAIMED_MODES.BRANCH_ONLY).toBe('branch-only');
    });

    it('should export WORKTREE_PR mode', () => {
      expect(CLAIMED_MODES.WORKTREE_PR).toBe('worktree-pr');
    });
  });

  describe('PATTERNS', () => {
    it('should have WU_ID pattern', () => {
      expect(PATTERNS.WU_ID.test('WU-123')).toBe(true);
      expect(PATTERNS.WU_ID.test('WU-1')).toBe(true);
      expect(PATTERNS.WU_ID.test('WU-99999')).toBe(true);
      expect(PATTERNS.WU_ID.test('wu-123')).toBe(false);
      expect(PATTERNS.WU_ID.test('TICKET-123')).toBe(false);
    });

    it('should have WU_ID_EXTRACT pattern', () => {
      expect('Working on WU-456 today'.match(PATTERNS.WU_ID_EXTRACT)?.[0]).toBe('WU-456');
    });

    it('should have WU_ID_EXTRACT_CI pattern (case insensitive)', () => {
      expect('path/wu-789/file.ts'.match(PATTERNS.WU_ID_EXTRACT_CI)?.[0]).toBe('wu-789');
      expect('path/WU-789/file.ts'.match(PATTERNS.WU_ID_EXTRACT_CI)?.[0]).toBe('WU-789');
    });

    it('should have LANE_BRANCH pattern', () => {
      expect(PATTERNS.LANE_BRANCH.test('lane/framework-core/wu-123')).toBe(true);
      expect(PATTERNS.LANE_BRANCH.test('lane/ops/wu-1')).toBe(true);
      expect(PATTERNS.LANE_BRANCH.test('main')).toBe(false);
      expect(PATTERNS.LANE_BRANCH.test('feature/foo')).toBe(false);
    });

    it('should have WORKTREE_PATH pattern', () => {
      expect(PATTERNS.WORKTREE_PATH.test('worktrees/framework-core-wu-123')).toBe(true);
      expect(PATTERNS.WORKTREE_PATH.test('worktrees/ops-wu-1')).toBe(true);
      expect(PATTERNS.WORKTREE_PATH.test('/absolute/worktrees/foo')).toBe(false);
    });
  });

  describe('COMMIT_FORMATS', () => {
    it('should format CLAIM message', () => {
      expect(COMMIT_FORMATS.CLAIM('wu-123', 'framework-core')).toBe(
        'wu(wu-123): claim for framework-core lane',
      );
    });

    it('should format DONE message', () => {
      expect(COMMIT_FORMATS.DONE('wu-456', 'Implement feature')).toBe(
        'wu(wu-456): done - Implement feature',
      );
    });

    it('should format CREATE message', () => {
      expect(COMMIT_FORMATS.CREATE('WU-789', 'Add tests')).toBe(
        'docs: create wu-789 for Add tests',
      );
    });

    it('should format EDIT message', () => {
      expect(COMMIT_FORMATS.EDIT('WU-100')).toBe('docs: edit wu-100 spec');
    });

    it('should format SPEC_UPDATE message', () => {
      expect(COMMIT_FORMATS.SPEC_UPDATE('WU-200')).toBe('wu(wu-200): spec update');
    });

    it('should format BLOCK message', () => {
      expect(COMMIT_FORMATS.BLOCK('WU-300')).toBe('wu(WU-300): block');
    });

    it('should format UNBLOCK message', () => {
      expect(COMMIT_FORMATS.UNBLOCK('WU-400')).toBe('wu(WU-400): unblock');
    });

    it('should format REPAIR message', () => {
      expect(COMMIT_FORMATS.REPAIR('WU-500')).toBe('fix(WU-500): repair state inconsistency');
    });
  });

  describe('LOG_PREFIX', () => {
    it('should export all log prefixes', () => {
      expect(LOG_PREFIX.DONE).toBe('[wu-done]');
      expect(LOG_PREFIX.CLAIM).toBe('[wu-claim]');
      expect(LOG_PREFIX.CREATE).toBe('[wu:create]');
      expect(LOG_PREFIX.EDIT).toBe('[wu:edit]');
      expect(LOG_PREFIX.DELETE).toBe('[wu:delete]');
    });
  });

  describe('DEFAULTS', () => {
    it('should export WORKTREES_DIR', () => {
      expect(DEFAULTS.WORKTREES_DIR).toBe('worktrees');
    });

    it('should export MAX_COMMIT_SUBJECT', () => {
      expect(DEFAULTS.MAX_COMMIT_SUBJECT).toBe(100);
    });

    it('should export PROJECT_ROOT_DEPTH', () => {
      expect(DEFAULTS.PROJECT_ROOT_DEPTH).toBe(2);
    });

    it('should export EMAIL_DOMAIN default', () => {
      expect(DEFAULTS.EMAIL_DOMAIN).toBe('example.com');
    });
  });

  describe('FILE_SYSTEM', () => {
    it('should export ENCODING', () => {
      expect(FILE_SYSTEM.ENCODING).toBe('utf8');
    });

    it('should export UTF8 alias', () => {
      expect(FILE_SYSTEM.UTF8).toBe('utf8');
    });
  });

  describe('STRING_LITERALS', () => {
    it('should export NEWLINE', () => {
      expect(STRING_LITERALS.NEWLINE).toBe('\n');
    });

    it('should export DOUBLE_NEWLINE', () => {
      expect(STRING_LITERALS.DOUBLE_NEWLINE).toBe('\n\n');
    });

    it('should export EMPTY', () => {
      expect(STRING_LITERALS.EMPTY).toBe('');
    });
  });

  describe('LUMENFLOW_PATHS', () => {
    it('should export BASE path', () => {
      expect(LUMENFLOW_PATHS.BASE).toBe('.lumenflow');
    });

    it('should export STATE_DIR', () => {
      expect(LUMENFLOW_PATHS.STATE_DIR).toBe('.lumenflow/state');
    });

    it('should export STAMPS_DIR', () => {
      expect(LUMENFLOW_PATHS.STAMPS_DIR).toBe('.lumenflow/stamps');
    });

    it('should export WU_EVENTS', () => {
      expect(LUMENFLOW_PATHS.WU_EVENTS).toBe('.lumenflow/state/wu-events.jsonl');
    });

    it('should export SESSIONS', () => {
      expect(LUMENFLOW_PATHS.SESSIONS).toBe('.lumenflow/sessions');
    });
  });

  describe('SIZING_GUIDE_REF', () => {
    it('should derive from configured sizingGuidePath', () => {
      expect(SIZING_GUIDE_REF).toBe(getConfig().directories.sizingGuidePath);
    });
  });

  describe('toKebab', () => {
    it('should convert lane name to kebab case', () => {
      expect(toKebab('Framework: Core')).toBe('framework-core');
    });

    it('should handle sublane format', () => {
      expect(toKebab('Operations: Tooling')).toBe('operations-tooling');
    });

    it('should handle single word', () => {
      expect(toKebab('Intelligence')).toBe('intelligence');
    });

    it('should handle multiple words without colon', () => {
      expect(toKebab('Core Systems')).toBe('core-systems');
    });

    it('should return empty string for null', () => {
      expect(toKebab(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(toKebab(undefined)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(toKebab('')).toBe('');
    });

    it('should return empty string for whitespace only', () => {
      expect(toKebab('   ')).toBe('');
    });

    it('should trim input before converting', () => {
      expect(toKebab('  Framework: Core  ')).toBe('framework-core');
    });
  });

  describe('getWorktreePath', () => {
    it('should generate worktree path from lane and id', () => {
      expect(getWorktreePath('Framework: Core', 'WU-123')).toBe('worktrees/framework-core-wu-123');
    });

    it('should convert WU ID to lowercase', () => {
      expect(getWorktreePath('Operations', 'WU-456')).toBe('worktrees/operations-wu-456');
    });

    it('should handle sublane format', () => {
      expect(getWorktreePath('Content: Documentation', 'WU-789')).toBe(
        'worktrees/content-documentation-wu-789',
      );
    });
  });

  describe('getLaneBranch', () => {
    it('should generate lane branch from lane and id', () => {
      expect(getLaneBranch('Framework: Core', 'WU-123')).toBe('lane/framework-core/wu-123');
    });

    it('should convert WU ID to lowercase', () => {
      expect(getLaneBranch('Operations', 'WU-456')).toBe('lane/operations/wu-456');
    });

    it('should handle sublane format', () => {
      expect(getLaneBranch('Content: Documentation', 'WU-789')).toBe(
        'lane/content-documentation/wu-789',
      );
    });
  });

  describe('getProjectRoot', () => {
    it('should be a function', () => {
      expect(typeof getProjectRoot).toBe('function');
    });

    it('should return a path string when given module URL', () => {
      // Note: This test uses a mock URL since we can't easily provide a real import.meta.url
      const result = getProjectRoot('file:///home/user/project/tools/lib/wu-constants.ts');
      expect(typeof result).toBe('string');
      expect(result).toContain('/home/user/project');
    });
  });
});
