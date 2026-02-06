/**
 * @file schema-parity.test.ts
 * @description Tests for CLI/MCP schema parity (WU-1431, WU-1455)
 *
 * These tests verify that:
 * 1. Shared command schemas exist for wu:create, wu:claim, wu:status, wu:done, gates
 * 2. MCP inputSchema can be derived from shared schemas
 * 3. CLI arg mapping can be derived from shared schemas
 * 4. CLI-only aliases are not exposed in MCP schemas
 * 5. Parity is maintained between CLI and MCP
 * 6. Initiative schemas cover all 8 initiative commands (WU-1455)
 * 7. Initiative schemas can be used for MCP and CLI (WU-1455)
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Import shared schemas (to be created)
import {
  wuCreateSchema,
  wuClaimSchema,
  wuStatusSchema,
  wuDoneSchema,
  gatesSchema,
  type WuCreateInput,
  type WuClaimInput,
  type WuStatusInput,
  type WuDoneInput,
  type GatesInput,
} from '../schemas/command-schemas.js';

// Import initiative schemas (WU-1455)
import {
  initiativeCreateSchema,
  initiativeEditSchema,
  initiativeListSchema,
  initiativeStatusSchema,
  initiativeAddWuSchema,
  initiativeRemoveWuSchema,
  initiativeBulkAssignSchema,
  initiativePlanSchema,
  initiativeCommandSchemas,
  type InitiativeCreateInput,
  type InitiativeEditInput,
  type InitiativeListInput,
  type InitiativeStatusInput,
  type InitiativeAddWuInput,
  type InitiativeRemoveWuInput,
  type InitiativeBulkAssignInput,
  type InitiativePlanInput,
  type InitiativeCommandName,
} from '../schemas/initiative-schemas.js';

// Import initiative arg validators (WU-1455)
import {
  validateInitiativeCreateArgs,
  validateInitiativeEditArgs,
  validateInitiativeListArgs,
  validateInitiativeStatusArgs,
  validateInitiativeAddWuArgs,
  validateInitiativeRemoveWuArgs,
  validateInitiativeBulkAssignArgs,
  validateInitiativePlanArgs,
} from '../schemas/initiative-arg-validators.js';

// Import schema utilities
import {
  zodToMcpInputSchema,
  zodToCliOptions,
  getCliOnlyAliases,
  validateCliMcpParity,
} from '../schemas/schema-utils.js';

describe('Shared Command Schemas (WU-1431)', () => {
  describe('Schema Definitions', () => {
    it('should export wuCreateSchema as a Zod schema', () => {
      expect(wuCreateSchema).toBeDefined();
      expect(wuCreateSchema instanceof z.ZodType).toBe(true);
    });

    it('should export wuClaimSchema as a Zod schema', () => {
      expect(wuClaimSchema).toBeDefined();
      expect(wuClaimSchema instanceof z.ZodType).toBe(true);
    });

    it('should export wuStatusSchema as a Zod schema', () => {
      expect(wuStatusSchema).toBeDefined();
      expect(wuStatusSchema instanceof z.ZodType).toBe(true);
    });

    it('should export wuDoneSchema as a Zod schema', () => {
      expect(wuDoneSchema).toBeDefined();
      expect(wuDoneSchema instanceof z.ZodType).toBe(true);
    });

    it('should export gatesSchema as a Zod schema', () => {
      expect(gatesSchema).toBeDefined();
      expect(gatesSchema instanceof z.ZodType).toBe(true);
    });
  });

  describe('wuCreateSchema', () => {
    it('should require lane and title', () => {
      const result = wuCreateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input = {
        lane: 'Framework: Core',
        title: 'Test WU',
      };
      const result = wuCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const input: WuCreateInput = {
        id: 'WU-1234',
        lane: 'Framework: Core',
        title: 'Test WU',
        description: 'Context: ... Problem: ... Solution: ...',
        acceptance: ['AC1', 'AC2'],
        code_paths: ['src/file.ts'],
        exposure: 'backend-only',
      };
      const result = wuCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('wuClaimSchema', () => {
    it('should require id and lane', () => {
      const result = wuClaimSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuClaimInput = {
        id: 'WU-1234',
        lane: 'Framework: Core',
      };
      const result = wuClaimSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('wuStatusSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = wuStatusSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional id', () => {
      const input: WuStatusInput = {
        id: 'WU-1234',
      };
      const result = wuStatusSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('wuDoneSchema', () => {
    it('should require id', () => {
      const result = wuDoneSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: WuDoneInput = {
        id: 'WU-1234',
      };
      const result = wuDoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional skip_gates with reason and fix_wu', () => {
      const input: WuDoneInput = {
        id: 'WU-1234',
        skip_gates: true,
        reason: 'Pre-existing failure',
        fix_wu: 'WU-9999',
      };
      const result = wuDoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('gatesSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = gatesSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept docs_only flag', () => {
      const input: GatesInput = {
        docs_only: true,
      };
      const result = gatesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});

describe('Schema Utilities (WU-1431)', () => {
  describe('zodToMcpInputSchema', () => {
    it('should convert wuCreateSchema to JSON Schema format', () => {
      const jsonSchema = zodToMcpInputSchema(wuCreateSchema);
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
      expect(jsonSchema.properties.lane).toBeDefined();
      expect(jsonSchema.properties.title).toBeDefined();
    });

    it('should include descriptions in JSON Schema', () => {
      const jsonSchema = zodToMcpInputSchema(wuClaimSchema);
      expect(jsonSchema.properties.id.description).toBeDefined();
      expect(jsonSchema.properties.lane.description).toBeDefined();
    });

    it('should mark required fields correctly', () => {
      const jsonSchema = zodToMcpInputSchema(wuClaimSchema);
      expect(jsonSchema.required).toContain('id');
      expect(jsonSchema.required).toContain('lane');
    });

    it('should not include CLI-only aliases in MCP schema', () => {
      const jsonSchema = zodToMcpInputSchema(wuCreateSchema);
      // CLI-only aliases like --code-path (singular) should not appear
      expect(jsonSchema.properties.code_path).toBeUndefined();
      expect(jsonSchema.properties.codePath).toBeUndefined();
      expect(jsonSchema.properties.manual_test).toBeUndefined();
      expect(jsonSchema.properties.manualTest).toBeUndefined();
    });
  });

  describe('zodToCliOptions', () => {
    it('should generate CLI option definitions from schema', () => {
      const options = zodToCliOptions(wuCreateSchema);
      expect(options).toBeDefined();
      expect(Array.isArray(options)).toBe(true);
      expect(options.find((o) => o.name === 'lane')).toBeDefined();
      expect(options.find((o) => o.name === 'title')).toBeDefined();
    });

    it('should mark required options correctly', () => {
      const options = zodToCliOptions(wuClaimSchema);
      const idOption = options.find((o) => o.name === 'id');
      const laneOption = options.find((o) => o.name === 'lane');
      expect(idOption?.required).toBe(true);
      expect(laneOption?.required).toBe(true);
    });

    it('should handle repeatable options', () => {
      const options = zodToCliOptions(wuCreateSchema);
      const acceptanceOption = options.find((o) => o.name === 'acceptance');
      expect(acceptanceOption?.isRepeatable).toBe(true);
    });
  });

  describe('getCliOnlyAliases', () => {
    it('should return CLI-only alias definitions', () => {
      const aliases = getCliOnlyAliases();
      expect(aliases).toBeDefined();
      expect(aliases.codePath).toBeDefined();
      expect(aliases.codePath.canonical).toBe('code_paths');
      expect(aliases.manualTest).toBeDefined();
      expect(aliases.manualTest.canonical).toBe('test_paths_manual');
    });
  });

  describe('validateCliMcpParity', () => {
    it('should pass for wuCreateSchema', () => {
      const result = validateCliMcpParity('wu:create', wuCreateSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for wuClaimSchema', () => {
      const result = validateCliMcpParity('wu:claim', wuClaimSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for wuStatusSchema', () => {
      const result = validateCliMcpParity('wu:status', wuStatusSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for wuDoneSchema', () => {
      const result = validateCliMcpParity('wu:done', wuDoneSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for gatesSchema', () => {
      const result = validateCliMcpParity('gates', gatesSchema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// =============================================================================
// Initiative Schemas (WU-1455)
// =============================================================================

describe('Initiative Command Schemas (WU-1455)', () => {
  describe('Schema Registry', () => {
    it('should export a registry with all 8 initiative command schemas', () => {
      expect(initiativeCommandSchemas).toBeDefined();
      const commandNames = Object.keys(initiativeCommandSchemas);
      expect(commandNames).toHaveLength(8);
      expect(commandNames).toContain('initiative:create');
      expect(commandNames).toContain('initiative:edit');
      expect(commandNames).toContain('initiative:list');
      expect(commandNames).toContain('initiative:status');
      expect(commandNames).toContain('initiative:add-wu');
      expect(commandNames).toContain('initiative:remove-wu');
      expect(commandNames).toContain('initiative:bulk-assign');
      expect(commandNames).toContain('initiative:plan');
    });

    it('should have all registry values be Zod schemas', () => {
      for (const [name, schema] of Object.entries(initiativeCommandSchemas)) {
        expect(schema, `${name} should be a ZodType`).toBeInstanceOf(z.ZodType);
      }
    });
  });

  describe('initiativeCreateSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativeCreateSchema).toBeInstanceOf(z.ZodType);
    });

    it('should require id, slug, and title', () => {
      const result = initiativeCreateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input with required fields', () => {
      const input: InitiativeCreateInput = {
        id: 'INIT-001',
        slug: 'my-initiative',
        title: 'My Initiative',
      };
      const result = initiativeCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const input: InitiativeCreateInput = {
        id: 'INIT-001',
        slug: 'my-initiative',
        title: 'My Initiative',
        priority: 'P1',
        owner: 'tom@hellm.ai',
        target_date: '2026-06-01',
      };
      const result = initiativeCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('initiativeEditSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativeEditSchema).toBeInstanceOf(z.ZodType);
    });

    it('should require id', () => {
      const result = initiativeEditSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept id-only input', () => {
      const input: InitiativeEditInput = { id: 'INIT-001' };
      // Just id is valid (edits are all optional)
      const result = initiativeEditSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept status edit', () => {
      const input: InitiativeEditInput = {
        id: 'INIT-001',
        status: 'in_progress',
      };
      const result = initiativeEditSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept blocking fields', () => {
      const input: InitiativeEditInput = {
        id: 'INIT-001',
        blocked_by: 'INIT-002',
        blocked_reason: 'Waiting for Phase 1',
      };
      const result = initiativeEditSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('initiativeListSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativeListSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = initiativeListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional status filter', () => {
      const input: InitiativeListInput = { status: 'open' };
      const result = initiativeListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional format and color', () => {
      const input: InitiativeListInput = { format: 'json', color: true };
      const result = initiativeListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('initiativeStatusSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativeStatusSchema).toBeInstanceOf(z.ZodType);
    });

    it('should require id', () => {
      const result = initiativeStatusSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: InitiativeStatusInput = { id: 'INIT-001' };
      const result = initiativeStatusSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional format', () => {
      const input: InitiativeStatusInput = { id: 'INIT-001', format: 'json' };
      const result = initiativeStatusSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('initiativeAddWuSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativeAddWuSchema).toBeInstanceOf(z.ZodType);
    });

    it('should require initiative and wu', () => {
      const result = initiativeAddWuSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: InitiativeAddWuInput = {
        initiative: 'INIT-001',
        wu: 'WU-123',
      };
      const result = initiativeAddWuSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional phase', () => {
      const input: InitiativeAddWuInput = {
        initiative: 'INIT-001',
        wu: 'WU-123',
        phase: 1,
      };
      const result = initiativeAddWuSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('initiativeRemoveWuSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativeRemoveWuSchema).toBeInstanceOf(z.ZodType);
    });

    it('should require initiative and wu', () => {
      const result = initiativeRemoveWuSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: InitiativeRemoveWuInput = {
        initiative: 'INIT-001',
        wu: 'WU-123',
      };
      const result = initiativeRemoveWuSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('initiativeBulkAssignSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativeBulkAssignSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = initiativeBulkAssignSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional config and apply', () => {
      const input: InitiativeBulkAssignInput = {
        config: 'tools/config/custom.yaml',
        apply: true,
      };
      const result = initiativeBulkAssignSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('initiativePlanSchema', () => {
    it('should be a Zod schema', () => {
      expect(initiativePlanSchema).toBeInstanceOf(z.ZodType);
    });

    it('should require initiative', () => {
      const result = initiativePlanSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input with plan path', () => {
      const input: InitiativePlanInput = {
        initiative: 'INIT-001',
        plan: 'docs/04-operations/plans/my-plan.md',
      };
      const result = initiativePlanSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept create flag', () => {
      const input: InitiativePlanInput = {
        initiative: 'INIT-001',
        create: true,
      };
      const result = initiativePlanSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('MCP inputSchema derivation', () => {
    it('should derive valid MCP schemas from all 8 initiative schemas', () => {
      for (const [name, schema] of Object.entries(initiativeCommandSchemas)) {
        const mcpSchema = zodToMcpInputSchema(schema);
        expect(mcpSchema, `${name} MCP schema should be defined`).toBeDefined();
        expect(mcpSchema.type, `${name} MCP schema type should be object`).toBe('object');
        expect(
          mcpSchema.properties,
          `${name} MCP schema should have properties`,
        ).toBeDefined();
      }
    });

    it('should mark required fields for initiativeCreateSchema', () => {
      const mcpSchema = zodToMcpInputSchema(initiativeCreateSchema);
      expect(mcpSchema.required).toContain('id');
      expect(mcpSchema.required).toContain('slug');
      expect(mcpSchema.required).toContain('title');
    });

    it('should mark required fields for initiativeAddWuSchema', () => {
      const mcpSchema = zodToMcpInputSchema(initiativeAddWuSchema);
      expect(mcpSchema.required).toContain('initiative');
      expect(mcpSchema.required).toContain('wu');
    });
  });

  describe('CLI/MCP parity', () => {
    it('should pass parity check for all 8 initiative schemas', () => {
      for (const [name, schema] of Object.entries(initiativeCommandSchemas)) {
        const result = validateCliMcpParity(name, schema);
        expect(result.valid, `${name} parity check should pass: ${result.errors.join(', ')}`).toBe(
          true,
        );
      }
    });
  });

  describe('CLI argument validators', () => {
    it('should validate initiative:create args', () => {
      const result = validateInitiativeCreateArgs({
        id: 'INIT-001',
        slug: 'test',
        title: 'Test',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid initiative:create args', () => {
      const result = validateInitiativeCreateArgs({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate initiative:edit args', () => {
      const result = validateInitiativeEditArgs({ id: 'INIT-001', status: 'open' });
      expect(result.valid).toBe(true);
    });

    it('should validate initiative:list args', () => {
      const result = validateInitiativeListArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate initiative:status args', () => {
      const result = validateInitiativeStatusArgs({ id: 'INIT-001' });
      expect(result.valid).toBe(true);
    });

    it('should validate initiative:add-wu args', () => {
      const result = validateInitiativeAddWuArgs({
        initiative: 'INIT-001',
        wu: 'WU-123',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid initiative:add-wu args', () => {
      const result = validateInitiativeAddWuArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate initiative:remove-wu args', () => {
      const result = validateInitiativeRemoveWuArgs({
        initiative: 'INIT-001',
        wu: 'WU-123',
      });
      expect(result.valid).toBe(true);
    });

    it('should validate initiative:bulk-assign args', () => {
      const result = validateInitiativeBulkAssignArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate initiative:plan args', () => {
      const result = validateInitiativePlanArgs({
        initiative: 'INIT-001',
        plan: 'docs/plan.md',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid initiative:plan args', () => {
      const result = validateInitiativePlanArgs({});
      expect(result.valid).toBe(false);
    });
  });
});
