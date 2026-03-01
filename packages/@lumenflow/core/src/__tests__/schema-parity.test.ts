// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file schema-parity.test.ts
 * @description Tests for CLI/MCP schema parity (WU-1431, WU-1455, WU-1456, WU-1457)
 *
 * These tests verify that:
 * 1. Shared command schemas exist for wu:create, wu:claim, wu:status, wu:done, gates
 * 2. MCP inputSchema can be derived from shared schemas
 * 3. CLI arg mapping can be derived from shared schemas
 * 4. CLI-only aliases are not exposed in MCP schemas
 * 5. Parity is maintained between CLI and MCP
 * 6. Initiative schemas cover all 8 initiative commands (WU-1455)
 * 7. Initiative schemas can be used for MCP and CLI (WU-1455)
 * 8. Memory schemas cover all 13 memory commands (WU-1456)
 * 9. Memory schemas can be used for MCP and CLI (WU-1456)
 * 10. Flow schemas cover flow/metrics commands (WU-1457)
 * 11. Validation schemas cover all validation commands (WU-1457)
 * 12. Setup schemas cover all setup/lumenflow commands (WU-1457)
 * 13. Agent, orchestration, and spawn schemas exist (WU-1457)
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

// Import memory schemas (WU-1456)
import {
  memInitSchema,
  memStartSchema,
  memReadySchema,
  memCheckpointSchema,
  memCleanupSchema,
  memContextSchema,
  memCreateSchema,
  memDeleteSchema,
  memExportSchema,
  memInboxSchema,
  memSignalSchema,
  memSummarizeSchema,
  memTriageSchema,
  memoryCommandSchemas,
  type MemInitInput,
  type MemStartInput,
  type MemCheckpointInput,
  type MemContextInput,
  type MemCreateInput,
  type MemDeleteInput,
  type MemExportInput,
  type MemInboxInput,
  type MemSignalInput,
  type MemSummarizeInput,
  type MemTriageInput,
  type MemoryCommandName,
} from '../schemas/memory-schemas.js';

// Import memory arg validators (WU-1456)
import {
  validateMemInitArgs,
  validateMemStartArgs,
  validateMemReadyArgs,
  validateMemCheckpointArgs,
  validateMemCleanupArgs,
  validateMemContextArgs,
  validateMemCreateArgs,
  validateMemDeleteArgs,
  validateMemExportArgs,
  validateMemInboxArgs,
  validateMemSignalArgs,
  validateMemSummarizeArgs,
  validateMemTriageArgs,
} from '../schemas/memory-arg-validators.js';

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
        expect(mcpSchema.properties, `${name} MCP schema should have properties`).toBeDefined();
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

// =============================================================================
// Memory Schemas (WU-1456)
// =============================================================================

describe('Memory Command Schemas (WU-1456)', () => {
  describe('Schema Registry', () => {
    it('should export a registry with all 13 memory command schemas', () => {
      expect(memoryCommandSchemas).toBeDefined();
      const commandNames = Object.keys(memoryCommandSchemas);
      expect(commandNames).toHaveLength(13);
      expect(commandNames).toContain('mem:init');
      expect(commandNames).toContain('mem:start');
      expect(commandNames).toContain('mem:ready');
      expect(commandNames).toContain('mem:checkpoint');
      expect(commandNames).toContain('mem:cleanup');
      expect(commandNames).toContain('mem:context');
      expect(commandNames).toContain('mem:create');
      expect(commandNames).toContain('mem:delete');
      expect(commandNames).toContain('mem:export');
      expect(commandNames).toContain('mem:inbox');
      expect(commandNames).toContain('mem:signal');
      expect(commandNames).toContain('mem:summarize');
      expect(commandNames).toContain('mem:triage');
    });

    it('should have all registry values be Zod schemas', () => {
      for (const [name, schema] of Object.entries(memoryCommandSchemas)) {
        expect(schema, `${name} should be a ZodType`).toBeInstanceOf(z.ZodType);
      }
    });
  });

  describe('memInitSchema', () => {
    it('should be a Zod schema', () => {
      expect(memInitSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = memInitSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('memStartSchema', () => {
    it('should be a Zod schema', () => {
      expect(memStartSchema).toBeInstanceOf(z.ZodType);
    });

    it('should require wu', () => {
      const result = memStartSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: MemStartInput = { wu: 'WU-1234' };
      const result = memStartSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional lane and agent_type', () => {
      const input: MemStartInput = {
        wu: 'WU-1234',
        lane: 'Framework: Core',
        agent_type: 'general-purpose',
      };
      const result = memStartSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memReadySchema', () => {
    it('should require wu', () => {
      const result = memReadySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const result = memReadySchema.safeParse({ wu: 'WU-1234' });
      expect(result.success).toBe(true);
    });
  });

  describe('memCheckpointSchema', () => {
    it('should require wu', () => {
      const result = memCheckpointSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input with optional fields', () => {
      const input: MemCheckpointInput = {
        wu: 'WU-1234',
        message: 'Progress at 50%',
      };
      const result = memCheckpointSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memCleanupSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = memCleanupSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept dry_run flag', () => {
      const result = memCleanupSchema.safeParse({ dry_run: true });
      expect(result.success).toBe(true);
    });
  });

  describe('memContextSchema', () => {
    it('should require wu', () => {
      const result = memContextSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input with optional lane', () => {
      const input: MemContextInput = {
        wu: 'WU-1234',
        lane: 'Framework: Core',
      };
      const result = memContextSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memCreateSchema', () => {
    it('should require message', () => {
      const result = memCreateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: MemCreateInput = {
        message: 'Bug: found issue in validator',
        wu: 'WU-1234',
      };
      const result = memCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional type and tags', () => {
      const input: MemCreateInput = {
        message: 'Bug: found issue',
        wu: 'WU-1234',
        type: 'discovery',
        tags: ['bug', 'validator'],
      };
      const result = memCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memDeleteSchema', () => {
    it('should require id', () => {
      const result = memDeleteSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: MemDeleteInput = { id: 'mem-abc123' };
      const result = memDeleteSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memExportSchema', () => {
    it('should require wu', () => {
      const result = memExportSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input with optional format', () => {
      const input: MemExportInput = {
        wu: 'WU-1234',
        format: 'json',
      };
      const result = memExportSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memInboxSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = memInboxSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional since, wu, and lane', () => {
      const input: MemInboxInput = {
        since: '30m',
        wu: 'WU-1234',
        lane: 'Framework: Core',
      };
      const result = memInboxSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memSignalSchema', () => {
    it('should require message and wu', () => {
      const result = memSignalSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: MemSignalInput = {
        message: 'Completed phase 1',
        wu: 'WU-1234',
      };
      const result = memSignalSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should preserve optional signal metadata fields', () => {
      const input: MemSignalInput = {
        message: 'handoff complete',
        wu: 'WU-1234',
        type: 'handoff',
        sender: 'agent-a',
        target_agent: 'agent-b',
        origin: 'mcp',
        remote_id: 'remote-123',
      };

      const result = memSignalSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('handoff');
      expect(result.data?.sender).toBe('agent-a');
      expect(result.data?.target_agent).toBe('agent-b');
      expect(result.data?.origin).toBe('mcp');
      expect(result.data?.remote_id).toBe('remote-123');
    });
  });

  describe('memSummarizeSchema', () => {
    it('should require wu', () => {
      const result = memSummarizeSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: MemSummarizeInput = { wu: 'WU-1234' };
      const result = memSummarizeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('memTriageSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = memTriageSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept valid input with wu filter', () => {
      const input: MemTriageInput = {
        wu: 'WU-1234',
        promote: 'mem-abc123',
        lane: 'Framework: Core',
      };
      const result = memTriageSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('MCP inputSchema derivation', () => {
    it('should derive valid MCP schemas from all 13 memory schemas', () => {
      for (const [name, schema] of Object.entries(memoryCommandSchemas)) {
        const mcpSchema = zodToMcpInputSchema(schema);
        expect(mcpSchema, `${name} MCP schema should be defined`).toBeDefined();
        expect(mcpSchema.type, `${name} MCP schema type should be object`).toBe('object');
        expect(mcpSchema.properties, `${name} MCP schema should have properties`).toBeDefined();
      }
    });

    it('should mark required fields for memCreateSchema', () => {
      const mcpSchema = zodToMcpInputSchema(memCreateSchema);
      expect(mcpSchema.required).toContain('message');
    });

    it('should mark required fields for memSignalSchema', () => {
      const mcpSchema = zodToMcpInputSchema(memSignalSchema);
      expect(mcpSchema.required).toContain('message');
      expect(mcpSchema.required).toContain('wu');
    });
  });

  describe('CLI/MCP parity', () => {
    it('should pass parity check for all 13 memory schemas', () => {
      for (const [name, schema] of Object.entries(memoryCommandSchemas)) {
        const result = validateCliMcpParity(name, schema);
        expect(result.valid, `${name} parity check should pass: ${result.errors.join(', ')}`).toBe(
          true,
        );
      }
    });
  });

  describe('CLI argument validators', () => {
    it('should validate mem:init args', () => {
      const result = validateMemInitArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate mem:start args', () => {
      const result = validateMemStartArgs({ wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid mem:start args', () => {
      const result = validateMemStartArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate mem:ready args', () => {
      const result = validateMemReadyArgs({ wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should validate mem:checkpoint args', () => {
      const result = validateMemCheckpointArgs({ wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should validate mem:cleanup args', () => {
      const result = validateMemCleanupArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate mem:context args', () => {
      const result = validateMemContextArgs({ wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid mem:context args', () => {
      const result = validateMemContextArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate mem:create args', () => {
      const result = validateMemCreateArgs({ message: 'test', wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid mem:create args', () => {
      const result = validateMemCreateArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate mem:delete args', () => {
      const result = validateMemDeleteArgs({ id: 'mem-abc123' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid mem:delete args', () => {
      const result = validateMemDeleteArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate mem:export args', () => {
      const result = validateMemExportArgs({ wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should validate mem:inbox args', () => {
      const result = validateMemInboxArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate mem:signal args', () => {
      const result = validateMemSignalArgs({ message: 'test', wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid mem:signal args', () => {
      const result = validateMemSignalArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate mem:summarize args', () => {
      const result = validateMemSummarizeArgs({ wu: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should validate mem:triage args', () => {
      const result = validateMemTriageArgs({});
      expect(result.valid).toBe(true);
    });
  });
});

// =============================================================================
// Flow Schemas (WU-1457)
// =============================================================================

// Import flow schemas (WU-1457)
import {
  flowBottlenecksSchema,
  flowReportSchema,
  metricsSnapshotSchema,
  metricsSchema,
  flowCommandSchemas,
  type FlowBottlenecksInput,
  type FlowReportInput as FlowReportSchemaInput,
  type MetricsSnapshotInput as MetricsSnapshotSchemaInput,
  type MetricsInput,
  type FlowCommandName,
} from '../schemas/flow-schemas.js';

// Import flow arg validators (WU-1457)
import {
  validateFlowBottlenecksArgs,
  validateFlowReportArgs,
  validateMetricsSnapshotArgs,
  validateMetricsArgs,
} from '../schemas/flow-arg-validators.js';

// Import validation schemas (WU-1457)
import {
  validateSchema,
  validateAgentSkillsSchema,
  validateAgentSyncSchema,
  validateBacklogSyncSchema,
  validateSkillsSpecSchema,
  validationCommandSchemas,
  type ValidateInput,
  type ValidateAgentSkillsInput,
  type ValidationCommandName,
} from '../schemas/validation-schemas.js';

// Import validation arg validators (WU-1457)
import {
  validateValidateArgs,
  validateValidateAgentSkillsArgs,
  validateValidateAgentSyncArgs,
  validateValidateBacklogSyncArgs,
  validateValidateSkillsSpecArgs,
} from '../schemas/validation-arg-validators.js';

// Import setup schemas (WU-1457)
import {
  lumenflowInitSchema,
  lumenflowDoctorSchema,
  lumenflowIntegrateSchema,
  lumenflowUpgradeSchema,
  lumenflowCommandsSchema,
  docsSyncSchema,
  releaseSchema,
  syncTemplatesSchema,
  agentSessionSchema,
  agentSessionEndSchema,
  agentLogIssueSchema,
  agentIssuesQuerySchema,
  orchestrateInitiativeSchema,
  orchestrateInitStatusSchema,
  orchestrateMonitorSchema,
  delegationListSchema,
  sessionCoordinatorSchema,
  rotateProgressSchema,
  setupCommandSchemas,
  type LumenflowInitInput,
  type LumenflowIntegrateInput,
  type ReleaseInput,
  type AgentSessionInput,
  type AgentLogIssueInput,
  type AgentIssuesQueryInput,
  type OrchestrateInitiativeInput,
  type OrchestrateInitStatusInput,
  type OrchestrateMonitorInput,
  type DelegationListInput,
  type SessionCoordinatorInput,
  type RotateProgressInput,
  type SetupCommandName,
} from '../schemas/setup-schemas.js';

// Import setup arg validators (WU-1457)
import {
  validateLumenflowInitArgs,
  validateLumenflowDoctorArgs,
  validateLumenflowIntegrateArgs,
  validateLumenflowUpgradeArgs,
  validateLumenflowCommandsArgs,
  validateDocsSyncArgs,
  validateReleaseArgs,
  validateSyncTemplatesArgs,
  validateAgentSessionArgs,
  validateAgentSessionEndArgs,
  validateAgentLogIssueArgs,
  validateAgentIssuesQueryArgs,
  validateOrchestrateInitiativeArgs,
  validateOrchestrateInitStatusArgs,
  validateOrchestrateMonitorArgs,
  validateDelegationListArgs,
  validateSessionCoordinatorArgs,
  validateRotateProgressArgs,
} from '../schemas/setup-arg-validators.js';

describe('Flow Command Schemas (WU-1457)', () => {
  describe('Schema Registry', () => {
    it('should export a registry with all 4 flow/metrics command schemas', () => {
      expect(flowCommandSchemas).toBeDefined();
      const commandNames = Object.keys(flowCommandSchemas);
      expect(commandNames).toHaveLength(4);
      expect(commandNames).toContain('flow:bottlenecks');
      expect(commandNames).toContain('flow:report');
      expect(commandNames).toContain('metrics:snapshot');
      expect(commandNames).toContain('metrics');
    });

    it('should have all registry values be Zod schemas', () => {
      for (const [name, schema] of Object.entries(flowCommandSchemas)) {
        expect(schema, `${name} should be a ZodType`).toBeInstanceOf(z.ZodType);
      }
    });
  });

  describe('flowBottlenecksSchema', () => {
    it('should be a Zod schema', () => {
      expect(flowBottlenecksSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = flowBottlenecksSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional limit and format', () => {
      const input: FlowBottlenecksInput = { limit: 5, format: 'table' };
      const result = flowBottlenecksSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('flowReportSchema', () => {
    it('should be a Zod schema', () => {
      expect(flowReportSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = flowReportSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional date and format fields', () => {
      const input: FlowReportSchemaInput = {
        start: '2026-01-01',
        end: '2026-01-31',
        format: 'json',
      };
      const result = flowReportSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('metricsSnapshotSchema', () => {
    it('should be a Zod schema', () => {
      expect(metricsSnapshotSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = metricsSnapshotSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional type and dry_run', () => {
      const input: MetricsSnapshotSchemaInput = {
        type: 'dora',
        dry_run: true,
      };
      const result = metricsSnapshotSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('metricsSchema', () => {
    it('should be a Zod schema', () => {
      expect(metricsSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = metricsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional format and days', () => {
      const input: MetricsInput = {
        format: 'table',
        days: 30,
      };
      const result = metricsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('MCP inputSchema derivation', () => {
    it('should derive valid MCP schemas from all 4 flow schemas', () => {
      for (const [name, schema] of Object.entries(flowCommandSchemas)) {
        const mcpSchema = zodToMcpInputSchema(schema);
        expect(mcpSchema, `${name} MCP schema should be defined`).toBeDefined();
        expect(mcpSchema.type, `${name} MCP schema type should be object`).toBe('object');
        expect(mcpSchema.properties, `${name} MCP schema should have properties`).toBeDefined();
      }
    });
  });

  describe('CLI/MCP parity', () => {
    it('should pass parity check for all 4 flow schemas', () => {
      for (const [name, schema] of Object.entries(flowCommandSchemas)) {
        const result = validateCliMcpParity(name, schema);
        expect(result.valid, `${name} parity check should pass: ${result.errors.join(', ')}`).toBe(
          true,
        );
      }
    });
  });

  describe('CLI argument validators', () => {
    it('should validate flow:bottlenecks args', () => {
      const result = validateFlowBottlenecksArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate flow:report args', () => {
      const result = validateFlowReportArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate metrics:snapshot args', () => {
      const result = validateMetricsSnapshotArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate metrics args', () => {
      const result = validateMetricsArgs({});
      expect(result.valid).toBe(true);
    });
  });
});

// =============================================================================
// Validation Schemas (WU-1457)
// =============================================================================

describe('Validation Command Schemas (WU-1457)', () => {
  describe('Schema Registry', () => {
    it('should export a registry with all 5 validation command schemas', () => {
      expect(validationCommandSchemas).toBeDefined();
      const commandNames = Object.keys(validationCommandSchemas);
      expect(commandNames).toHaveLength(5);
      expect(commandNames).toContain('validate');
      expect(commandNames).toContain('validate:agent-skills');
      expect(commandNames).toContain('validate:agent-sync');
      expect(commandNames).toContain('validate:backlog-sync');
      expect(commandNames).toContain('validate:skills-spec');
    });

    it('should have all registry values be Zod schemas', () => {
      for (const [name, schema] of Object.entries(validationCommandSchemas)) {
        expect(schema, `${name} should be a ZodType`).toBeInstanceOf(z.ZodType);
      }
    });
  });

  describe('validateSchema', () => {
    it('should be a Zod schema', () => {
      expect(validateSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = validateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional id and strict', () => {
      const input: ValidateInput = { id: 'WU-123', strict: true };
      const result = validateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('validateAgentSkillsSchema', () => {
    it('should be a Zod schema', () => {
      expect(validateAgentSkillsSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = validateAgentSkillsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional skill filter', () => {
      const input: ValidateAgentSkillsInput = { skill: 'wu-lifecycle' };
      const result = validateAgentSkillsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('no-parameter schemas', () => {
    it('should accept empty input for validate:agent-sync', () => {
      const result = validateAgentSyncSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept empty input for validate:backlog-sync', () => {
      const result = validateBacklogSyncSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept empty input for validate:skills-spec', () => {
      const result = validateSkillsSpecSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('MCP inputSchema derivation', () => {
    it('should derive valid MCP schemas from all 5 validation schemas', () => {
      for (const [name, schema] of Object.entries(validationCommandSchemas)) {
        const mcpSchema = zodToMcpInputSchema(schema);
        expect(mcpSchema, `${name} MCP schema should be defined`).toBeDefined();
        expect(mcpSchema.type, `${name} MCP schema type should be object`).toBe('object');
      }
    });
  });

  describe('CLI/MCP parity', () => {
    it('should pass parity check for all 5 validation schemas', () => {
      for (const [name, schema] of Object.entries(validationCommandSchemas)) {
        const result = validateCliMcpParity(name, schema);
        expect(result.valid, `${name} parity check should pass: ${result.errors.join(', ')}`).toBe(
          true,
        );
      }
    });
  });

  describe('CLI argument validators', () => {
    it('should validate validate args', () => {
      const result = validateValidateArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate validate:agent-skills args', () => {
      const result = validateValidateAgentSkillsArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate validate:agent-sync args', () => {
      const result = validateValidateAgentSyncArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate validate:backlog-sync args', () => {
      const result = validateValidateBacklogSyncArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate validate:skills-spec args', () => {
      const result = validateValidateSkillsSpecArgs({});
      expect(result.valid).toBe(true);
    });
  });
});

// =============================================================================
// Setup + Agent + Orchestration + Spawn Schemas (WU-1457)
// =============================================================================

describe('Setup/Agent/Orchestration/Spawn Command Schemas (WU-1457)', () => {
  describe('Schema Registry', () => {
    it('should export a registry with all 18 setup/agent/orchestration/spawn schemas', () => {
      expect(setupCommandSchemas).toBeDefined();
      const commandNames = Object.keys(setupCommandSchemas);
      expect(commandNames).toHaveLength(18);
      // Setup commands
      expect(commandNames).toContain('lumenflow:init');
      expect(commandNames).toContain('lumenflow:doctor');
      expect(commandNames).toContain('lumenflow:integrate');
      expect(commandNames).toContain('lumenflow:upgrade');
      expect(commandNames).toContain('lumenflow:commands');
      expect(commandNames).toContain('docs:sync');
      expect(commandNames).toContain('release');
      expect(commandNames).toContain('sync:templates');
      // Agent commands
      expect(commandNames).toContain('agent:session');
      expect(commandNames).toContain('agent:session:end');
      expect(commandNames).toContain('agent:log-issue');
      expect(commandNames).toContain('agent:issues-query');
      // Orchestration commands
      expect(commandNames).toContain('orchestrate:initiative');
      expect(commandNames).toContain('orchestrate:init-status');
      expect(commandNames).toContain('orchestrate:monitor');
      // Delegation commands
      expect(commandNames).toContain('delegation:list');
      // Coordination commands
      expect(commandNames).toContain('session:coordinator');
      expect(commandNames).toContain('rotate:progress');
    });

    it('should have all registry values be Zod schemas', () => {
      for (const [name, schema] of Object.entries(setupCommandSchemas)) {
        expect(schema, `${name} should be a ZodType`).toBeInstanceOf(z.ZodType);
      }
    });
  });

  describe('lumenflowInitSchema', () => {
    it('should be a Zod schema', () => {
      expect(lumenflowInitSchema).toBeInstanceOf(z.ZodType);
    });

    it('should accept empty input (no required fields)', () => {
      const result = lumenflowInitSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional client and merge', () => {
      const input: LumenflowInitInput = { client: 'claude', merge: true };
      const result = lumenflowInitSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('lumenflowIntegrateSchema', () => {
    it('should require client', () => {
      const result = lumenflowIntegrateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: LumenflowIntegrateInput = { client: 'claude-code' };
      const result = lumenflowIntegrateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('releaseSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = releaseSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional dry_run', () => {
      const input: ReleaseInput = { dry_run: true };
      const result = releaseSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('no-parameter setup schemas', () => {
    it('should accept empty input for lumenflow:doctor', () => {
      const result = lumenflowDoctorSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept empty input for lumenflow:upgrade', () => {
      const result = lumenflowUpgradeSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept empty input for lumenflow:commands', () => {
      const result = lumenflowCommandsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept empty input for docs:sync', () => {
      const result = docsSyncSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept empty input for sync:templates', () => {
      const result = syncTemplatesSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('agentSessionSchema', () => {
    it('should require wu and tier', () => {
      const result = agentSessionSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: AgentSessionInput = { wu: 'WU-1234', tier: 1 };
      const result = agentSessionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional agent_type', () => {
      const input: AgentSessionInput = {
        wu: 'WU-1234',
        tier: 2,
        agent_type: 'claude-code',
      };
      const result = agentSessionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('agentSessionEndSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = agentSessionEndSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('agentLogIssueSchema', () => {
    it('should require category, severity, title, description', () => {
      const result = agentLogIssueSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: AgentLogIssueInput = {
        category: 'workflow',
        severity: 'minor',
        title: 'Test issue',
        description: 'A test description for the issue',
      };
      const result = agentLogIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional resolution, tags, step, files', () => {
      const input: AgentLogIssueInput = {
        category: 'tooling',
        severity: 'blocker',
        title: 'Build failure',
        description: 'Build failed on main',
        resolution: 'Fixed by reverting',
        tags: ['ci', 'build'],
        step: 'gates',
        files: ['src/index.ts'],
      };
      const result = agentLogIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('agentIssuesQuerySchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = agentIssuesQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional filters', () => {
      const input: AgentIssuesQueryInput = {
        since: 7,
        category: 'workflow',
        severity: 'blocker',
      };
      const result = agentIssuesQuerySchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('orchestrateInitiativeSchema', () => {
    it('should require initiative', () => {
      const result = orchestrateInitiativeSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: OrchestrateInitiativeInput = { initiative: 'INIT-001' };
      const result = orchestrateInitiativeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional dry_run and progress', () => {
      const input: OrchestrateInitiativeInput = {
        initiative: 'INIT-001',
        dry_run: true,
        progress: true,
      };
      const result = orchestrateInitiativeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('orchestrateInitStatusSchema', () => {
    it('should require initiative', () => {
      const result = orchestrateInitStatusSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const input: OrchestrateInitStatusInput = { initiative: 'INIT-001' };
      const result = orchestrateInitStatusSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('orchestrateMonitorSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = orchestrateMonitorSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const input: OrchestrateMonitorInput = {
        threshold: 30,
        recover: true,
        dry_run: true,
        since: '30m',
        wu: 'WU-1234',
        signals_only: true,
      };
      const result = orchestrateMonitorSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('delegationListSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = delegationListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional wu and initiative', () => {
      const input: DelegationListInput = { wu: 'WU-1234', json: true };
      const result = delegationListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('sessionCoordinatorSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = sessionCoordinatorSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const input: SessionCoordinatorInput = {
        command: 'start',
        wu: 'WU-1234',
        agent: 'claude-code',
      };
      const result = sessionCoordinatorSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('rotateProgressSchema', () => {
    it('should accept empty input (no required fields)', () => {
      const result = rotateProgressSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional dry_run and limit', () => {
      const input: RotateProgressInput = { dry_run: true, limit: 10 };
      const result = rotateProgressSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('MCP inputSchema derivation', () => {
    it('should derive valid MCP schemas from all 18 setup/agent/orchestration/spawn schemas', () => {
      for (const [name, schema] of Object.entries(setupCommandSchemas)) {
        const mcpSchema = zodToMcpInputSchema(schema);
        expect(mcpSchema, `${name} MCP schema should be defined`).toBeDefined();
        expect(mcpSchema.type, `${name} MCP schema type should be object`).toBe('object');
      }
    });

    it('should mark required fields for agentSessionSchema', () => {
      const mcpSchema = zodToMcpInputSchema(agentSessionSchema);
      expect(mcpSchema.required).toContain('wu');
      expect(mcpSchema.required).toContain('tier');
    });

    it('should mark required fields for agentLogIssueSchema', () => {
      const mcpSchema = zodToMcpInputSchema(agentLogIssueSchema);
      expect(mcpSchema.required).toContain('category');
      expect(mcpSchema.required).toContain('severity');
      expect(mcpSchema.required).toContain('title');
      expect(mcpSchema.required).toContain('description');
    });

    it('should mark required fields for orchestrateInitiativeSchema', () => {
      const mcpSchema = zodToMcpInputSchema(orchestrateInitiativeSchema);
      expect(mcpSchema.required).toContain('initiative');
    });

    it('should mark required fields for lumenflowIntegrateSchema', () => {
      const mcpSchema = zodToMcpInputSchema(lumenflowIntegrateSchema);
      expect(mcpSchema.required).toContain('client');
    });
  });

  describe('CLI/MCP parity', () => {
    it('should pass parity check for all 18 setup/agent/orchestration/spawn schemas', () => {
      for (const [name, schema] of Object.entries(setupCommandSchemas)) {
        const result = validateCliMcpParity(name, schema);
        expect(result.valid, `${name} parity check should pass: ${result.errors.join(', ')}`).toBe(
          true,
        );
      }
    });
  });

  describe('CLI argument validators', () => {
    it('should validate lumenflow:init args', () => {
      const result = validateLumenflowInitArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate lumenflow:doctor args', () => {
      const result = validateLumenflowDoctorArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate lumenflow:integrate args', () => {
      const result = validateLumenflowIntegrateArgs({ client: 'claude-code' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid lumenflow:integrate args', () => {
      const result = validateLumenflowIntegrateArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate lumenflow:upgrade args', () => {
      const result = validateLumenflowUpgradeArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate lumenflow:commands args', () => {
      const result = validateLumenflowCommandsArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate docs:sync args', () => {
      const result = validateDocsSyncArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate release args', () => {
      const result = validateReleaseArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate sync:templates args', () => {
      const result = validateSyncTemplatesArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate agent:session args', () => {
      const result = validateAgentSessionArgs({ wu: 'WU-1234', tier: 1 });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid agent:session args', () => {
      const result = validateAgentSessionArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate agent:session:end args', () => {
      const result = validateAgentSessionEndArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate agent:log-issue args', () => {
      const result = validateAgentLogIssueArgs({
        category: 'workflow',
        severity: 'minor',
        title: 'Test',
        description: 'Test description',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid agent:log-issue args', () => {
      const result = validateAgentLogIssueArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate agent:issues-query args', () => {
      const result = validateAgentIssuesQueryArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate orchestrate:initiative args', () => {
      const result = validateOrchestrateInitiativeArgs({ initiative: 'INIT-001' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid orchestrate:initiative args', () => {
      const result = validateOrchestrateInitiativeArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate orchestrate:init-status args', () => {
      const result = validateOrchestrateInitStatusArgs({ initiative: 'INIT-001' });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid orchestrate:init-status args', () => {
      const result = validateOrchestrateInitStatusArgs({});
      expect(result.valid).toBe(false);
    });

    it('should validate orchestrate:monitor args', () => {
      const result = validateOrchestrateMonitorArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate delegation:list args', () => {
      const result = validateDelegationListArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate session:coordinator args', () => {
      const result = validateSessionCoordinatorArgs({});
      expect(result.valid).toBe(true);
    });

    it('should validate rotate:progress args', () => {
      const result = validateRotateProgressArgs({});
      expect(result.valid).toBe(true);
    });
  });
});
