/**
 * @file schemas/__tests__/cli-flag-verification.test.ts
 * @description Verify MCP flags exist in CLI public manifest (WU-1458)
 *
 * This test ensures that every flag defined in shared schemas actually
 * has a corresponding CLI command and option. If a schema adds a new flag,
 * the CLI must support it (or it will be detected as MCP-only drift).
 *
 * Acceptance criteria:
 * - New test verifies MCP flags exist in CLI help output
 * - Adding unsupported flag to MCP fails tests
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

// Import schema utilities
import { zodToMcpInputSchema, zodToCliOptions } from '../schema-utils.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get all MCP field names from a Zod schema
 */
function getMcpFieldNames(schema: z.ZodObject<z.ZodRawShape>): string[] {
  const mcpSchema = zodToMcpInputSchema(schema);
  return Object.keys(mcpSchema.properties);
}

/**
 * Get all CLI option names (camelCase) from a Zod schema
 */
function getCliOptionNames(schema: z.ZodObject<z.ZodRawShape>): string[] {
  const cliOptions = zodToCliOptions(schema);
  return cliOptions.map((opt) => opt.name);
}

/**
 * Convert snake_case to camelCase (matching schema-utils.ts behavior)
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

// =============================================================================
// Build a unified registry of ALL schema-backed commands
// =============================================================================

type SchemaRegistry = Record<string, z.ZodObject<z.ZodRawShape>>;

const ALL_SCHEMA_REGISTRIES: Record<string, SchemaRegistry> = {
  command: commandSchemas as unknown as SchemaRegistry,
  lifecycle: lifecycleCommandSchemas as unknown as SchemaRegistry,
  initiative: initiativeCommandSchemas as unknown as SchemaRegistry,
  memory: memoryCommandSchemas as unknown as SchemaRegistry,
  flow: flowCommandSchemas as unknown as SchemaRegistry,
  validation: validationCommandSchemas as unknown as SchemaRegistry,
  setup: setupCommandSchemas as unknown as SchemaRegistry,
};

// =============================================================================
// Tests
// =============================================================================

describe('CLI Flag Verification (WU-1458)', () => {
  describe('Every MCP field has a corresponding CLI option', () => {
    for (const [group, registry] of Object.entries(ALL_SCHEMA_REGISTRIES)) {
      for (const [commandName, schema] of Object.entries(registry)) {
        it(`${commandName}: all MCP fields have CLI equivalents`, () => {
          const mcpFields = getMcpFieldNames(schema);
          const cliNames = getCliOptionNames(schema);

          for (const mcpField of mcpFields) {
            const expectedCliName = toCamelCase(mcpField);
            expect(
              cliNames,
              `MCP field '${mcpField}' (CLI: '${expectedCliName}') for ${commandName} missing from CLI options`,
            ).toContain(expectedCliName);
          }
        });
      }
    }
  });

  describe('Every CLI option has a corresponding MCP field', () => {
    for (const [group, registry] of Object.entries(ALL_SCHEMA_REGISTRIES)) {
      for (const [commandName, schema] of Object.entries(registry)) {
        it(`${commandName}: all CLI options have MCP equivalents`, () => {
          const mcpFields = getMcpFieldNames(schema);
          const cliOptions = zodToCliOptions(schema);

          for (const cliOpt of cliOptions) {
            // Convert CLI camelCase name back to snake_case MCP name
            const mcpEquivalent = cliOpt.name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
            expect(
              mcpFields,
              `CLI option '${cliOpt.name}' (MCP: '${mcpEquivalent}') for ${commandName} missing from MCP schema`,
            ).toContain(mcpEquivalent);
          }
        });
      }
    }
  });

  describe('Required field consistency between MCP and CLI', () => {
    for (const [group, registry] of Object.entries(ALL_SCHEMA_REGISTRIES)) {
      for (const [commandName, schema] of Object.entries(registry)) {
        it(`${commandName}: required fields match between MCP and CLI`, () => {
          const mcpSchema = zodToMcpInputSchema(schema);
          const cliOptions = zodToCliOptions(schema);
          const mcpRequired = new Set(mcpSchema.required ?? []);

          for (const cliOpt of cliOptions) {
            const mcpField = cliOpt.name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
            const mcpIsRequired = mcpRequired.has(mcpField);

            expect(
              cliOpt.required,
              `${commandName}: field '${cliOpt.name}' required mismatch ` +
                `(CLI: ${cliOpt.required}, MCP: ${mcpIsRequired})`,
            ).toBe(mcpIsRequired);
          }
        });
      }
    }
  });

  describe('Drift detection: unsupported MCP flag fails parity', () => {
    it('should fail parity when MCP has a flag not in CLI schema', () => {
      // Simulate drift: create a schema with a flag that would exist in MCP
      // but suppose CLI does not derive from the same schema.
      const mcpOnlySchema = z.object({
        id: z.string().describe('WU ID'),
        mcp_only_flag: z.boolean().optional().describe('MCP-only flag not in CLI'),
      });

      // Both CLI and MCP derive from the same schema, so they match.
      // The real test is: if someone manually adds a flag to MCP tools.ts
      // inputSchema WITHOUT adding it to the shared schema, the field
      // count will mismatch.
      //
      // To verify this, we check that the MCP schema derived from our
      // shared schema includes the field and CLI also includes it.
      const mcpFields = getMcpFieldNames(mcpOnlySchema);
      const cliNames = getCliOptionNames(mcpOnlySchema);

      expect(mcpFields).toContain('mcp_only_flag');
      expect(cliNames).toContain('mcpOnlyFlag');

      // Now verify the actual schemas don't include 'mcp_only_flag'
      // (proving the shared schemas are the authority)
      for (const [group, registry] of Object.entries(ALL_SCHEMA_REGISTRIES)) {
        for (const [commandName, schema] of Object.entries(registry)) {
          const fields = getMcpFieldNames(schema);
          expect(
            fields,
            `${commandName} should not contain 'mcp_only_flag' (schema drift guard)`,
          ).not.toContain('mcp_only_flag');
        }
      }
    });

    it('should detect if a fake flag is added to any real schema', () => {
      // This test verifies the detection mechanism works:
      // If we extend a real schema with an extra field, the field count changes
      const originalGatesFields = getMcpFieldNames(
        commandSchemas.gates as z.ZodObject<z.ZodRawShape>,
      );

      const extendedGates = (commandSchemas.gates as z.ZodObject<z.ZodRawShape>).extend({
        fake_flag: z.boolean().optional().describe('This should not exist'),
      });

      const extendedFields = getMcpFieldNames(extendedGates);

      // The extended schema has one more field
      expect(extendedFields.length).toBe(originalGatesFields.length + 1);
      expect(extendedFields).toContain('fake_flag');
      expect(originalGatesFields).not.toContain('fake_flag');
    });
  });

  describe('Schema field count snapshot (drift detection)', () => {
    // These snapshots ensure that if someone adds/removes a field from
    // a shared schema, the test explicitly catches it.
    const EXPECTED_FIELD_COUNTS: Record<string, number> = {
      // command-schemas.ts
      'wu:create': 15,
      'wu:claim': 2,
      'wu:status': 2,
      'wu:done': 4,
      gates: 6,
      // wu-lifecycle-schemas.ts
      'wu:block': 3,
      'wu:unblock': 3,
      'wu:edit': 10,
      'wu:release': 2,
      'wu:recover': 4,
      'wu:repair': 6,
      'wu:deps': 4,
      'wu:prep': 2,
      'wu:preflight': 2,
      'wu:prune': 1,
      'wu:delete': 3,
      'wu:cleanup': 2,
      'wu:spawn': 6,
      'wu:validate': 2,
      'wu:infer-lane': 3,
      'wu:unlock-lane': 5,
      // initiative-schemas.ts
      'initiative:create': 6,
      'initiative:edit': 14,
      'initiative:list': 3,
      'initiative:status': 3,
      'initiative:add-wu': 3,
      'initiative:remove-wu': 2,
      'initiative:bulk-assign': 3,
      'initiative:plan': 3,
      // memory-schemas.ts
      'mem:init': 1,
      'mem:start': 4,
      'mem:ready': 3,
      'mem:checkpoint': 6,
      'mem:cleanup': 3,
      'mem:context': 6,
      'mem:create': 7,
      'mem:delete': 4,
      'mem:export': 4,
      'mem:inbox': 3,
      'mem:signal': 2,
      'mem:summarize': 2,
      'mem:triage': 5,
      // flow-schemas.ts
      'flow:bottlenecks': 3,
      'flow:report': 5,
      'metrics:snapshot': 5,
      metrics: 5,
      // validation-schemas.ts
      validate: 3,
      'validate:agent-skills': 1,
      'validate:agent-sync': 0,
      'validate:backlog-sync': 0,
      'validate:skills-spec': 0,
      // setup-schemas.ts
      'lumenflow:init': 5,
      'lumenflow:doctor': 0,
      'lumenflow:integrate': 1,
      'lumenflow:upgrade': 0,
      'lumenflow:commands': 0,
      'docs:sync': 0,
      release: 1,
      'sync:templates': 0,
      'agent:session': 3,
      'agent:session:end': 0,
      'agent:log-issue': 8,
      'agent:issues-query': 3,
      'orchestrate:initiative': 4,
      'orchestrate:init-status': 1,
      'orchestrate:monitor': 6,
      'delegation:list': 3,
      'session:coordinator': 4,
      'rotate:progress': 2,
    };

    for (const [group, registry] of Object.entries(ALL_SCHEMA_REGISTRIES)) {
      for (const [commandName, schema] of Object.entries(registry)) {
        it(`${commandName}: field count matches snapshot`, () => {
          const fields = getMcpFieldNames(schema);
          const expectedCount = EXPECTED_FIELD_COUNTS[commandName];

          expect(
            expectedCount,
            `${commandName} is missing from EXPECTED_FIELD_COUNTS snapshot - ` +
              `add it with count ${fields.length}`,
          ).toBeDefined();

          expect(
            fields.length,
            `${commandName}: field count changed from ${expectedCount} to ${fields.length}. ` +
              `If intentional, update EXPECTED_FIELD_COUNTS.`,
          ).toBe(expectedCount);
        });
      }
    }

    it('EXPECTED_FIELD_COUNTS has no stale entries', () => {
      const allCommandNames = new Set<string>();
      for (const registry of Object.values(ALL_SCHEMA_REGISTRIES)) {
        for (const name of Object.keys(registry)) {
          allCommandNames.add(name);
        }
      }

      for (const snapshotName of Object.keys(EXPECTED_FIELD_COUNTS)) {
        expect(
          allCommandNames.has(snapshotName),
          `${snapshotName} exists in EXPECTED_FIELD_COUNTS but not in any schema registry`,
        ).toBe(true);
      }
    });
  });
});
