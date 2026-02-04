/**
 * @file schema-parity.test.ts
 * @description Tests for CLI/MCP schema parity (WU-1431)
 *
 * These tests verify that:
 * 1. Shared command schemas exist for wu:create, wu:claim, wu:status, wu:done, gates
 * 2. MCP inputSchema can be derived from shared schemas
 * 3. CLI arg mapping can be derived from shared schemas
 * 4. CLI-only aliases are not exposed in MCP schemas
 * 5. Parity is maintained between CLI and MCP
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
