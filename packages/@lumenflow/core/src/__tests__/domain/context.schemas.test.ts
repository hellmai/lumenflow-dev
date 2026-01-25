/**
 * @file context.schemas.test.ts
 * @description Tests for context-related Zod schemas
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests verify:
 * - LocationContextSchema validates correctly
 * - GitStateSchema validates correctly
 * - WuStateSchema validates correctly
 * - Types are correctly inferred from Zod schemas
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  LocationContextSchema,
  GitStateSchema,
  WuStateResultSchema,
  SessionStateSchema,
  LOCATION_TYPE_VALUES,
  type LocationContext,
  type GitState,
  type WuStateResult,
  type SessionState,
} from '../../domain/context.schemas.js';

// Use schema constants for test values
const LOCATION_TYPES = {
  MAIN: 'main' as const,
  WORKTREE: 'worktree' as const,
  DETACHED: 'detached' as const,
  UNKNOWN: 'unknown' as const,
};

describe('LocationContextSchema', () => {
  describe('valid inputs', () => {
    it('validates main checkout context', () => {
      const input = {
        type: LOCATION_TYPES.MAIN,
        cwd: '/home/user/repo',
        gitRoot: '/home/user/repo',
        mainCheckout: '/home/user/repo',
        worktreeName: null,
        worktreeWuId: null,
      };

      const result = LocationContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('main');
        expect(result.data.worktreeName).toBeNull();
      }
    });

    it('validates worktree context', () => {
      const input = {
        type: LOCATION_TYPES.WORKTREE,
        cwd: '/home/user/repo/worktrees/framework-core-wu-1093',
        gitRoot: '/home/user/repo/worktrees/framework-core-wu-1093',
        mainCheckout: '/home/user/repo',
        worktreeName: 'framework-core-wu-1093',
        worktreeWuId: 'WU-1093',
      };

      const result = LocationContextSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('worktree');
        expect(result.data.worktreeName).toBe('framework-core-wu-1093');
        expect(result.data.worktreeWuId).toBe('WU-1093');
      }
    });

    it('validates unknown location type', () => {
      const input = {
        type: LOCATION_TYPES.UNKNOWN,
        cwd: '/tmp/not-a-repo',
        gitRoot: '/tmp/not-a-repo',
        mainCheckout: '/tmp/not-a-repo',
        worktreeName: null,
        worktreeWuId: null,
      };

      const result = LocationContextSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates detached HEAD location type', () => {
      const input = {
        type: LOCATION_TYPES.DETACHED,
        cwd: '/home/user/repo',
        gitRoot: '/home/user/repo',
        mainCheckout: '/home/user/repo',
        worktreeName: null,
        worktreeWuId: null,
      };

      const result = LocationContextSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects invalid location type', () => {
      const input = {
        type: 'invalid-type',
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      };

      const result = LocationContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing required fields', () => {
      const input = {
        type: 'main',
        cwd: '/repo',
        // Missing gitRoot, mainCheckout
      };

      const result = LocationContextSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches LocationContext', () => {
      // This test ensures z.infer<typeof LocationContextSchema> matches LocationContext
      const schema: z.ZodType<LocationContext> = LocationContextSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('GitStateSchema', () => {
  describe('valid inputs', () => {
    it('validates clean git state', () => {
      const input = {
        branch: 'main',
        isDetached: false,
        isDirty: false,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: 'origin/main',
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      };

      const result = GitStateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates dirty git state with modified files', () => {
      const input = {
        branch: 'lane/framework-core/wu-1093',
        isDetached: false,
        isDirty: true,
        hasStaged: true,
        ahead: 5,
        behind: 2,
        tracking: 'origin/lane/framework-core/wu-1093',
        modifiedFiles: ['src/index.ts', 'README.md'],
        hasError: false,
        errorMessage: null,
      };

      const result = GitStateSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modifiedFiles).toHaveLength(2);
      }
    });

    it('validates detached HEAD state', () => {
      const input = {
        branch: null,
        isDetached: true,
        isDirty: false,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      };

      const result = GitStateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates error state', () => {
      const input = {
        branch: null,
        isDetached: false,
        isDirty: false,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: null,
        modifiedFiles: [],
        hasError: true,
        errorMessage: 'fatal: not a git repository',
      };

      const result = GitStateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects non-numeric ahead/behind', () => {
      const input = {
        branch: 'main',
        isDetached: false,
        isDirty: false,
        hasStaged: false,
        ahead: 'five',
        behind: 0,
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      };

      const result = GitStateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects non-array modifiedFiles', () => {
      const input = {
        branch: 'main',
        isDetached: false,
        isDirty: true,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: null,
        modifiedFiles: 'file.ts',
        hasError: false,
        errorMessage: null,
      };

      const result = GitStateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches GitState', () => {
      const schema: z.ZodType<GitState> = GitStateSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('WuStateResultSchema', () => {
  describe('valid inputs', () => {
    it('validates consistent WU state', () => {
      const input = {
        id: 'WU-1093',
        status: 'in_progress',
        lane: 'Framework: Core',
        title: 'Define ports and domain schemas',
        yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1093.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      };

      const result = WuStateResultSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates inconsistent WU state', () => {
      const input = {
        id: 'WU-1093',
        status: 'ready',
        lane: 'Framework: Core',
        title: 'Test',
        yamlPath: '/repo/wu.yaml',
        isConsistent: false,
        inconsistencyReason: 'YAML says ready but state store says in_progress',
      };

      const result = WuStateResultSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isConsistent).toBe(false);
        expect(result.data.inconsistencyReason).not.toBeNull();
      }
    });
  });

  describe('invalid inputs', () => {
    it('rejects missing id', () => {
      const input = {
        status: 'ready',
        lane: 'Framework: Core',
        title: 'Test',
        yamlPath: '/repo/wu.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      };

      const result = WuStateResultSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches WuStateResult', () => {
      const schema: z.ZodType<WuStateResult> = WuStateResultSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('SessionStateSchema', () => {
  describe('valid inputs', () => {
    it('validates active session', () => {
      const input = {
        isActive: true,
        sessionId: 'abc123-session-id',
      };

      const result = SessionStateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates inactive session', () => {
      const input = {
        isActive: false,
        sessionId: null,
      };

      const result = SessionStateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('type inference', () => {
    it('inferred type matches SessionState', () => {
      const schema: z.ZodType<SessionState> = SessionStateSchema;
      expect(schema).toBeDefined();
    });
  });
});
