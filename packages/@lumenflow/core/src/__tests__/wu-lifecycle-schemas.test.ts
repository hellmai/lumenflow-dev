/**
 * @file wu-lifecycle-schemas.test.ts
 * @description Tests for WU lifecycle shared schemas (WU-1454)
 *
 * These tests verify that:
 * 1. All 17 WU lifecycle schemas exist and validate correctly
 * 2. Required vs optional fields are correct
 * 3. Enum values are properly constrained
 * 4. Schema registry includes all 16 lifecycle commands
 * 5. CLI/MCP parity is maintained
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  wuBlockSchema,
  wuUnblockSchema,
  wuEditSchema,
  wuReleaseSchema,
  wuRecoverSchema,
  wuRepairSchema,
  wuDepsSchema,
  wuPrepSchema,
  wuPreflightSchema,
  wuPruneSchema,
  wuDeleteSchema,
  wuCleanupSchema,
  wuSpawnSchema,
  wuValidateSchema,
  wuInferLaneSchema,
  wuUnlockLaneSchema,
  lifecycleCommandSchemas,
  type WuBlockInput,
  type WuUnblockInput,
  type WuEditInput,
  type WuReleaseInput,
  type WuRecoverInput,
  type WuRepairInput,
  type WuDepsInput,
  type WuPrepInput,
  type WuPreflightInput,
  type WuPruneInput,
  type WuDeleteInput,
  type WuCleanupInput,
  type WuSpawnInput,
  type WuValidateInput,
  type WuInferLaneInput,
  type WuUnlockLaneInput,
} from '../schemas/wu-lifecycle-schemas.js';

import { zodToMcpInputSchema, validateCliMcpParity } from '../schemas/schema-utils.js';

// =============================================================================
// Schema Definitions
// =============================================================================

describe('WU Lifecycle Schemas (WU-1454)', () => {
  describe('Schema Existence', () => {
    const schemas = [
      ['wuBlockSchema', wuBlockSchema],
      ['wuUnblockSchema', wuUnblockSchema],
      ['wuEditSchema', wuEditSchema],
      ['wuReleaseSchema', wuReleaseSchema],
      ['wuRecoverSchema', wuRecoverSchema],
      ['wuRepairSchema', wuRepairSchema],
      ['wuDepsSchema', wuDepsSchema],
      ['wuPrepSchema', wuPrepSchema],
      ['wuPreflightSchema', wuPreflightSchema],
      ['wuPruneSchema', wuPruneSchema],
      ['wuDeleteSchema', wuDeleteSchema],
      ['wuCleanupSchema', wuCleanupSchema],
      ['wuSpawnSchema', wuSpawnSchema],
      ['wuValidateSchema', wuValidateSchema],
      ['wuInferLaneSchema', wuInferLaneSchema],
      ['wuUnlockLaneSchema', wuUnlockLaneSchema],
    ] as const;

    it.each(schemas)('should export %s as a Zod schema', (name, schema) => {
      expect(schema).toBeDefined();
      expect(schema instanceof z.ZodType).toBe(true);
    });
  });

  // =============================================================================
  // wu:block
  // =============================================================================

  describe('wuBlockSchema', () => {
    it('should require id and reason', () => {
      const result = wuBlockSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuBlockInput = {
        id: 'WU-1234',
        reason: 'Blocked on external dependency',
      };
      const result = wuBlockSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional remove_worktree', () => {
      const input: WuBlockInput = {
        id: 'WU-1234',
        reason: 'Blocked',
        remove_worktree: true,
      };
      const result = wuBlockSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:unblock
  // =============================================================================

  describe('wuUnblockSchema', () => {
    it('should require id', () => {
      const result = wuUnblockSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuUnblockInput = {
        id: 'WU-1234',
      };
      const result = wuUnblockSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional reason and create_worktree', () => {
      const input: WuUnblockInput = {
        id: 'WU-1234',
        reason: 'Dependency resolved',
        create_worktree: true,
      };
      const result = wuUnblockSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:edit
  // =============================================================================

  describe('wuEditSchema', () => {
    it('should require id', () => {
      const result = wuEditSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input with just id', () => {
      const input: WuEditInput = {
        id: 'WU-1234',
      };
      const result = wuEditSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const input: WuEditInput = {
        id: 'WU-1234',
        description: 'Updated description',
        acceptance: ['AC1', 'AC2'],
        notes: 'Some notes',
        code_paths: ['src/file.ts'],
        lane: 'Framework: Core',
        priority: 'P1',
        initiative: 'INIT-001',
        phase: 2,
        no_strict: true,
      };
      const result = wuEditSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate priority enum', () => {
      const result = wuEditSchema.safeParse({
        id: 'WU-1234',
        priority: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  // =============================================================================
  // wu:release
  // =============================================================================

  describe('wuReleaseSchema', () => {
    it('should require id', () => {
      const result = wuReleaseSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuReleaseInput = {
        id: 'WU-1234',
      };
      const result = wuReleaseSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional reason', () => {
      const input: WuReleaseInput = {
        id: 'WU-1234',
        reason: 'Orphaned WU',
      };
      const result = wuReleaseSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:recover
  // =============================================================================

  describe('wuRecoverSchema', () => {
    it('should require id', () => {
      const result = wuRecoverSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuRecoverInput = {
        id: 'WU-1234',
      };
      const result = wuRecoverSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate action enum', () => {
      const input: WuRecoverInput = {
        id: 'WU-1234',
        action: 'resume',
      };
      const result = wuRecoverSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid action', () => {
      const result = wuRecoverSchema.safeParse({
        id: 'WU-1234',
        action: 'invalid_action',
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional force and json', () => {
      const input: WuRecoverInput = {
        id: 'WU-1234',
        action: 'nuke',
        force: true,
        json: true,
      };
      const result = wuRecoverSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:repair
  // =============================================================================

  describe('wuRepairSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = wuRepairSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const input: WuRepairInput = {
        id: 'WU-1234',
        check: true,
        all: false,
        claim: false,
        admin: false,
        repair_state: true,
      };
      const result = wuRepairSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:deps
  // =============================================================================

  describe('wuDepsSchema', () => {
    it('should require id', () => {
      const result = wuDepsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuDepsInput = {
        id: 'WU-1234',
      };
      const result = wuDepsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate format enum', () => {
      const input: WuDepsInput = {
        id: 'WU-1234',
        format: 'mermaid',
      };
      const result = wuDepsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid format', () => {
      const result = wuDepsSchema.safeParse({
        id: 'WU-1234',
        format: 'invalid_format',
      });
      expect(result.success).toBe(false);
    });

    it('should validate direction enum', () => {
      const input: WuDepsInput = {
        id: 'WU-1234',
        direction: 'both',
      };
      const result = wuDepsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional depth', () => {
      const input: WuDepsInput = {
        id: 'WU-1234',
        depth: 3,
      };
      const result = wuDepsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:prep
  // =============================================================================

  describe('wuPrepSchema', () => {
    it('should require id', () => {
      const result = wuPrepSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuPrepInput = {
        id: 'WU-1234',
      };
      const result = wuPrepSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional docs_only', () => {
      const input: WuPrepInput = {
        id: 'WU-1234',
        docs_only: true,
      };
      const result = wuPrepSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:preflight
  // =============================================================================

  describe('wuPreflightSchema', () => {
    it('should require id', () => {
      const result = wuPreflightSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuPreflightInput = {
        id: 'WU-1234',
      };
      const result = wuPreflightSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional worktree override', () => {
      const input: WuPreflightInput = {
        id: 'WU-1234',
        worktree: '/path/to/worktree',
      };
      const result = wuPreflightSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:prune
  // =============================================================================

  describe('wuPruneSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = wuPruneSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept execute flag', () => {
      const input: WuPruneInput = {
        execute: true,
      };
      const result = wuPruneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:delete
  // =============================================================================

  describe('wuDeleteSchema', () => {
    it('should require id', () => {
      const result = wuDeleteSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuDeleteInput = {
        id: 'WU-1234',
      };
      const result = wuDeleteSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional dry_run and batch', () => {
      const input: WuDeleteInput = {
        id: 'WU-1234',
        dry_run: true,
        batch: 'WU-1235,WU-1236',
      };
      const result = wuDeleteSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:cleanup
  // =============================================================================

  describe('wuCleanupSchema', () => {
    it('should require id', () => {
      const result = wuCleanupSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuCleanupInput = {
        id: 'WU-1234',
      };
      const result = wuCleanupSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional artifacts flag', () => {
      const input: WuCleanupInput = {
        id: 'WU-1234',
        artifacts: true,
      };
      const result = wuCleanupSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:spawn
  // =============================================================================

  describe('wuSpawnSchema', () => {
    it('should require id', () => {
      const result = wuSpawnSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuSpawnInput = {
        id: 'WU-1234',
      };
      const result = wuSpawnSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const input: WuSpawnInput = {
        id: 'WU-1234',
        client: 'claude-code',
        thinking: true,
        budget: 10000,
        parent_wu: 'WU-1000',
        no_context: false,
      };
      const result = wuSpawnSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:validate
  // =============================================================================

  describe('wuValidateSchema', () => {
    it('should require id', () => {
      const result = wuValidateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuValidateInput = {
        id: 'WU-1234',
      };
      const result = wuValidateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional no_strict', () => {
      const input: WuValidateInput = {
        id: 'WU-1234',
        no_strict: true,
      };
      const result = wuValidateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:infer-lane
  // =============================================================================

  describe('wuInferLaneSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = wuInferLaneSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional id', () => {
      const input: WuInferLaneInput = {
        id: 'WU-1234',
      };
      const result = wuInferLaneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional paths and desc', () => {
      const input: WuInferLaneInput = {
        paths: ['src/file.ts', 'src/other.ts'],
        desc: 'Add shared schemas',
      };
      const result = wuInferLaneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // wu:unlock-lane
  // =============================================================================

  describe('wuUnlockLaneSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = wuUnlockLaneSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept lane and reason', () => {
      const input: WuUnlockLaneInput = {
        lane: 'Framework: Core',
        reason: 'Stuck lock',
      };
      const result = wuUnlockLaneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const input: WuUnlockLaneInput = {
        lane: 'Framework: Core',
        reason: 'Stuck lock',
        force: true,
        list: false,
        status: true,
      };
      const result = wuUnlockLaneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Schema Registry
// =============================================================================

describe('Lifecycle Command Registry (WU-1454)', () => {
  const expectedCommands = [
    'wu:block',
    'wu:unblock',
    'wu:edit',
    'wu:release',
    'wu:recover',
    'wu:repair',
    'wu:deps',
    'wu:prep',
    'wu:preflight',
    'wu:prune',
    'wu:delete',
    'wu:cleanup',
    'wu:brief',
    'wu:spawn',
    'wu:validate',
    'wu:infer-lane',
    'wu:unlock-lane',
  ] as const;

  it('should include all expected WU lifecycle commands', () => {
    expect(Object.keys(lifecycleCommandSchemas)).toHaveLength(expectedCommands.length);
  });

  it('should have entries for all lifecycle commands', () => {

    for (const cmd of expectedCommands) {
      expect(lifecycleCommandSchemas).toHaveProperty(cmd);
    }
  });

  it('should have all entries as Zod schemas', () => {
    for (const [name, schema] of Object.entries(lifecycleCommandSchemas)) {
      expect(schema, `${name} should be a Zod schema`).toBeInstanceOf(z.ZodType);
    }
  });
});

// =============================================================================
// MCP Schema Derivation
// =============================================================================

describe('MCP Schema Derivation (WU-1454)', () => {
  it('should derive valid JSON Schema from wuBlockSchema', () => {
    const jsonSchema = zodToMcpInputSchema(wuBlockSchema);
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.id).toBeDefined();
    expect(jsonSchema.properties.reason).toBeDefined();
    expect(jsonSchema.required).toContain('id');
    expect(jsonSchema.required).toContain('reason');
  });

  it('should derive valid JSON Schema from wuEditSchema', () => {
    const jsonSchema = zodToMcpInputSchema(wuEditSchema);
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.id).toBeDefined();
    expect(jsonSchema.properties.description).toBeDefined();
    expect(jsonSchema.properties.acceptance).toBeDefined();
    expect(jsonSchema.required).toContain('id');
  });

  it('should derive valid JSON Schema from wuSpawnSchema', () => {
    const jsonSchema = zodToMcpInputSchema(wuSpawnSchema);
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties.id).toBeDefined();
    expect(jsonSchema.properties.client).toBeDefined();
    expect(jsonSchema.required).toContain('id');
  });

  it('should not include CLI-only aliases in MCP schemas', () => {
    const jsonSchema = zodToMcpInputSchema(wuEditSchema);
    expect(jsonSchema.properties.codePath).toBeUndefined();
    expect(jsonSchema.properties.code_path).toBeUndefined();
  });
});

// =============================================================================
// CLI/MCP Parity
// =============================================================================

describe('CLI/MCP Parity for Lifecycle Commands (WU-1454)', () => {
  const parityTests = [
    ['wu:block', wuBlockSchema],
    ['wu:unblock', wuUnblockSchema],
    ['wu:edit', wuEditSchema],
    ['wu:release', wuReleaseSchema],
    ['wu:recover', wuRecoverSchema],
    ['wu:repair', wuRepairSchema],
    ['wu:deps', wuDepsSchema],
    ['wu:prep', wuPrepSchema],
    ['wu:preflight', wuPreflightSchema],
    ['wu:prune', wuPruneSchema],
    ['wu:delete', wuDeleteSchema],
    ['wu:cleanup', wuCleanupSchema],
    ['wu:spawn', wuSpawnSchema],
    ['wu:validate', wuValidateSchema],
    ['wu:infer-lane', wuInferLaneSchema],
    ['wu:unlock-lane', wuUnlockLaneSchema],
  ] as const;

  it.each(parityTests)('should maintain parity for %s', (name, schema) => {
    const result = validateCliMcpParity(name, schema as z.ZodObject<z.ZodRawShape>);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
