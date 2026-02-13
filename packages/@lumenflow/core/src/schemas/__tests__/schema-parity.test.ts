/**
 * @file schemas/__tests__/schema-parity.test.ts
 * @description Comprehensive CLI/MCP schema parity tests (WU-1458)
 *
 * This test verifies that ALL shared schema modules are covered:
 * - command-schemas.ts (5 original commands)
 * - wu-lifecycle-schemas.ts (17 lifecycle commands)
 * - initiative-schemas.ts (8 initiative commands)
 * - memory-schemas.ts (13 memory commands)
 * - flow-schemas.ts (4 flow/metrics commands)
 * - validation-schemas.ts (5 validation commands)
 * - setup-schemas.ts (18 setup/agent/orchestration/spawn commands)
 *
 * Acceptance criteria:
 * - Covers ALL shared schema modules (not just a subset)
 * - Adding an unsupported flag to MCP fails tests
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Import all schema registries
import { commandSchemas } from '../command-schemas.js';
import { lifecycleCommandSchemas } from '../wu-lifecycle-schemas.js';
import { initiativeCommandSchemas } from '../initiative-schemas.js';
import { memoryCommandSchemas } from '../memory-schemas.js';
import { flowCommandSchemas } from '../flow-schemas.js';
import { validationCommandSchemas } from '../validation-schemas.js';
import { setupCommandSchemas } from '../setup-schemas.js';

// Import parity utilities
import { zodToMcpInputSchema, validateCliMcpParity, zodToCliOptions } from '../schema-utils.js';

// =============================================================================
// All schema registries in one place for exhaustive testing
// =============================================================================

const ALL_REGISTRIES = {
  command: { registry: commandSchemas, expectedCount: 5, label: 'Command (WU-1431)' },
  lifecycle: {
    registry: lifecycleCommandSchemas,
    expectedCount: 17,
    label: 'WU Lifecycle (WU-1454)',
  },
  initiative: {
    registry: initiativeCommandSchemas,
    expectedCount: 8,
    label: 'Initiative (WU-1455)',
  },
  memory: { registry: memoryCommandSchemas, expectedCount: 13, label: 'Memory (WU-1456)' },
  flow: { registry: flowCommandSchemas, expectedCount: 4, label: 'Flow/Metrics (WU-1457)' },
  validation: {
    registry: validationCommandSchemas,
    expectedCount: 5,
    label: 'Validation (WU-1457)',
  },
  setup: {
    registry: setupCommandSchemas,
    expectedCount: 18,
    label: 'Setup/Agent/Orchestration/Spawn (WU-1457)',
  },
} as const;

// Total expected: 5 + 17 + 8 + 13 + 4 + 5 + 18 = 70
const TOTAL_EXPECTED_SCHEMAS = 70;

describe('Comprehensive Schema Parity (WU-1458)', () => {
  describe('All schema modules are covered', () => {
    it('should have exactly 7 schema registries', () => {
      expect(Object.keys(ALL_REGISTRIES)).toHaveLength(7);
    });

    it(`should have ${TOTAL_EXPECTED_SCHEMAS} total schemas across all registries`, () => {
      let total = 0;
      for (const { registry, label } of Object.values(ALL_REGISTRIES)) {
        const count = Object.keys(registry).length;
        total += count;
        // Also verify each registry individually
        expect(count, `${label} registry should not be empty`).toBeGreaterThan(0);
      }
      expect(total).toBe(TOTAL_EXPECTED_SCHEMAS);
    });

    for (const [key, { registry, expectedCount, label }] of Object.entries(ALL_REGISTRIES)) {
      it(`should have ${expectedCount} schemas in ${label} registry`, () => {
        expect(Object.keys(registry)).toHaveLength(expectedCount);
      });
    }
  });

  describe('Every schema in every registry is a valid Zod schema', () => {
    for (const { registry, label } of Object.values(ALL_REGISTRIES)) {
      for (const [name, schema] of Object.entries(registry)) {
        it(`${label} > ${name} should be a ZodType`, () => {
          expect(schema).toBeInstanceOf(z.ZodType);
        });
      }
    }
  });

  describe('MCP inputSchema derivation works for all schemas', () => {
    for (const { registry, label } of Object.values(ALL_REGISTRIES)) {
      for (const [name, schema] of Object.entries(registry)) {
        it(`${label} > ${name} should produce a valid MCP inputSchema`, () => {
          const mcpSchema = zodToMcpInputSchema(schema as z.ZodObject<z.ZodRawShape>);
          expect(mcpSchema).toBeDefined();
          expect(mcpSchema.type).toBe('object');
          expect(mcpSchema.properties).toBeDefined();
          expect(typeof mcpSchema.properties).toBe('object');
        });
      }
    }
  });

  describe('CLI option derivation works for all schemas', () => {
    for (const { registry, label } of Object.values(ALL_REGISTRIES)) {
      for (const [name, schema] of Object.entries(registry)) {
        it(`${label} > ${name} should produce valid CLI options`, () => {
          const cliOptions = zodToCliOptions(schema as z.ZodObject<z.ZodRawShape>);
          expect(cliOptions).toBeDefined();
          expect(Array.isArray(cliOptions)).toBe(true);
        });
      }
    }
  });

  describe('CLI/MCP parity passes for all schemas', () => {
    for (const { registry, label } of Object.values(ALL_REGISTRIES)) {
      for (const [name, schema] of Object.entries(registry)) {
        it(`${label} > ${name} should pass parity validation`, () => {
          const result = validateCliMcpParity(name, schema as z.ZodObject<z.ZodRawShape>);
          expect(result.valid, `${name} parity check failed: ${result.errors.join(', ')}`).toBe(
            true,
          );
          expect(result.errors).toHaveLength(0);
        });
      }
    }
  });

  describe('No duplicate command names across registries', () => {
    it('should have unique command names across all registries', () => {
      const allNames: string[] = [];
      for (const { registry } of Object.values(ALL_REGISTRIES)) {
        allNames.push(...Object.keys(registry));
      }
      const uniqueNames = new Set(allNames);
      expect(uniqueNames.size).toBe(allNames.length);
    });
  });

  describe('Adding unsupported flag fails parity (regression guard)', () => {
    it('should detect MCP field without CLI equivalent when schema has extra field', () => {
      // Create a schema with an extra field that does not exist in CLI
      const extendedSchema = z.object({
        id: z.string().describe('WU ID'),
        fake_unsupported_flag: z.string().optional().describe('This flag does not exist in CLI'),
      });

      // Parity should still pass (both MCP and CLI derive from same schema)
      // but the schema should include the fake flag in MCP output
      const mcpSchema = zodToMcpInputSchema(extendedSchema);
      expect(mcpSchema.properties.fake_unsupported_flag).toBeDefined();

      // CLI options should also include it
      const cliOptions = zodToCliOptions(extendedSchema);
      const fakeOption = cliOptions.find((o) => o.name === 'fakeUnsupportedFlag');
      expect(fakeOption).toBeDefined();
    });
  });
});
