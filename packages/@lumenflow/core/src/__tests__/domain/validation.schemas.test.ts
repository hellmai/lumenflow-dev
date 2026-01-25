/**
 * @file validation.schemas.test.ts
 * @description Tests for validation-related Zod schemas
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests verify:
 * - ValidationErrorSchema validates correctly
 * - ValidationWarningSchema validates correctly
 * - ValidationResultSchema validates correctly
 * - CommandPredicateSchema validates correctly
 * - CommandDefinitionSchema validates correctly
 * - Types are correctly inferred from Zod schemas
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ValidationErrorSchema,
  ValidationWarningSchema,
  ValidationResultSchema,
  CommandPredicateConfigSchema,
  CommandDefinitionConfigSchema,
  VALIDATION_ERROR_CODE_VALUES,
  PREDICATE_SEVERITY_VALUES,
  type ValidationError,
  type ValidationWarning,
  type ValidationResult,
  type CommandPredicateConfig,
  type CommandDefinitionConfig,
} from '../../domain/validation.schemas.js';
import { LOCATION_TYPE_VALUES } from '../../domain/context.schemas.js';

// Use schema constants for test values
const ERROR_CODES = {
  WRONG_LOCATION: 'WRONG_LOCATION' as const,
  WU_NOT_FOUND: 'WU_NOT_FOUND' as const,
  WU_ALREADY_EXISTS: 'WU_ALREADY_EXISTS' as const,
  WRONG_WU_STATUS: 'WRONG_WU_STATUS' as const,
  LANE_OCCUPIED: 'LANE_OCCUPIED' as const,
  WORKTREE_EXISTS: 'WORKTREE_EXISTS' as const,
  WORKTREE_MISSING: 'WORKTREE_MISSING' as const,
  GATES_NOT_PASSED: 'GATES_NOT_PASSED' as const,
  DIRTY_GIT: 'DIRTY_GIT' as const,
  REMOTE_UNAVAILABLE: 'REMOTE_UNAVAILABLE' as const,
  INCONSISTENT_STATE: 'INCONSISTENT_STATE' as const,
};

const LOCATION_TYPES = {
  MAIN: 'main' as const,
  WORKTREE: 'worktree' as const,
  DETACHED: 'detached' as const,
  UNKNOWN: 'unknown' as const,
};

const SEVERITY = {
  ERROR: 'error' as const,
  WARNING: 'warning' as const,
};

describe('ValidationErrorSchema', () => {
  describe('valid inputs', () => {
    it('validates error with fix command', () => {
      const input = {
        code: ERROR_CODES.WRONG_LOCATION,
        message: 'wu:done must be run from main checkout',
        fixCommand: 'cd /home/user/repo && pnpm wu:done --id WU-1093',
        context: { expected: 'main', actual: 'worktree' },
      };

      const result = ValidationErrorSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fixCommand).not.toBeNull();
      }
    });

    it('validates error without fix command', () => {
      const input = {
        code: ERROR_CODES.WU_NOT_FOUND,
        message: 'WU-9999 does not exist',
        fixCommand: null,
      };

      const result = ValidationErrorSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates all error codes', () => {
      for (const code of VALIDATION_ERROR_CODE_VALUES) {
        const input = {
          code,
          message: `Error for ${code}`,
          fixCommand: null,
        };
        const result = ValidationErrorSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('type inference', () => {
    it('inferred type matches ValidationError', () => {
      const schema: z.ZodType<ValidationError> = ValidationErrorSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('ValidationWarningSchema', () => {
  describe('valid inputs', () => {
    it('validates warning', () => {
      const input = {
        id: 'has-commits',
        message: 'No new commits to merge. Did you forget to commit your changes?',
      };

      const result = ValidationWarningSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('type inference', () => {
    it('inferred type matches ValidationWarning', () => {
      const schema: z.ZodType<ValidationWarning> = ValidationWarningSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('ValidationResultSchema', () => {
  describe('valid inputs', () => {
    it('validates successful result', () => {
      const input = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const result = ValidationResultSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates failed result with errors', () => {
      const input = {
        valid: false,
        errors: [
          {
            code: ERROR_CODES.WRONG_LOCATION,
            message: 'Must run from main',
            fixCommand: 'cd /repo',
          },
        ],
        warnings: [],
      };

      const result = ValidationResultSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.errors).toHaveLength(1);
      }
    });

    it('validates result with warnings', () => {
      const input = {
        valid: true,
        errors: [],
        warnings: [
          {
            id: 'state-consistent',
            message: 'State store and YAML may be inconsistent',
          },
        ],
      };

      const result = ValidationResultSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.warnings).toHaveLength(1);
      }
    });
  });

  describe('type inference', () => {
    it('inferred type matches ValidationResult (partial)', () => {
      // Note: The full ValidationResult includes context, but schema may be partial
      type PartialValidationResult = Pick<ValidationResult, 'valid' | 'errors' | 'warnings'>;
      const schema: z.ZodType<PartialValidationResult> = ValidationResultSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('CommandPredicateConfigSchema', () => {
  describe('valid inputs', () => {
    it('validates predicate config', () => {
      const input = {
        id: 'worktree-clean',
        description: 'Worktree must not have uncommitted changes',
        severity: SEVERITY.ERROR,
      };

      const result = CommandPredicateConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates warning severity', () => {
      const input = {
        id: 'has-commits',
        description: 'Branch should have commits',
        severity: SEVERITY.WARNING,
      };

      const result = CommandPredicateConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects invalid severity', () => {
      const input = {
        id: 'test',
        description: 'Test predicate',
        severity: 'critical', // Not a valid severity
      };

      const result = CommandPredicateConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches CommandPredicateConfig', () => {
      const schema: z.ZodType<CommandPredicateConfig> = CommandPredicateConfigSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('CommandDefinitionConfigSchema', () => {
  describe('valid inputs', () => {
    it('validates command definition with all fields', () => {
      const input = {
        name: 'wu:done',
        description: 'Complete WU (merge, stamp, cleanup)',
        requiredLocation: LOCATION_TYPES.MAIN,
        requiredWuStatus: 'in_progress',
        predicateIds: ['worktree-clean', 'has-commits'],
      };

      const result = CommandDefinitionConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates command definition with null requirements', () => {
      const input = {
        name: 'wu:status',
        description: 'Show WU status',
        requiredLocation: null,
        requiredWuStatus: null,
        predicateIds: [],
      };

      const result = CommandDefinitionConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates all location types', () => {
      for (const locationType of LOCATION_TYPE_VALUES) {
        const input = {
          name: 'wu:test',
          description: 'Test',
          requiredLocation: locationType,
          requiredWuStatus: null,
          predicateIds: [],
        };
        const result = CommandDefinitionConfigSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('invalid inputs', () => {
    it('rejects invalid location type', () => {
      const input = {
        name: 'wu:test',
        description: 'Test',
        requiredLocation: 'invalid',
        requiredWuStatus: null,
        predicateIds: [],
      };

      const result = CommandDefinitionConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
      const input = {
        description: 'Test',
        requiredLocation: null,
        requiredWuStatus: null,
        predicateIds: [],
      };

      const result = CommandDefinitionConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches CommandDefinitionConfig', () => {
      const schema: z.ZodType<CommandDefinitionConfig> = CommandDefinitionConfigSchema;
      expect(schema).toBeDefined();
    });
  });
});
