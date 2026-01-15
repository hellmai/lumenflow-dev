/**
 * @file tool.schemas.test.ts
 * @description Unit tests for tool schema validation (WU-1394)
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ToolInputSchema,
  ToolOutputSchema,
  ToolMetadataSchema,
  ToolDefinitionSchema,
  toJSONSchema,
} from '../tool.schemas.js';
import { TOOL_DOMAINS, PERMISSION_LEVELS } from '../tool.constants.js';

describe('ToolInputSchema', () => {
  it('should validate valid tool input', () => {
    const validInput = {
      command: 'wu:claim',
      arguments: {
        id: 'WU-123',
        lane: 'Operations',
      },
    };

    expect(() => ToolInputSchema.parse(validInput)).not.toThrow();
  });

  it('should reject input without command', () => {
    const invalidInput = {
      arguments: { id: 'WU-123' },
    };

    expect(() => ToolInputSchema.parse(invalidInput)).toThrow();
  });

  it('should accept empty arguments object', () => {
    const validInput = {
      command: 'gates',
      arguments: {},
    };

    expect(() => ToolInputSchema.parse(validInput)).not.toThrow();
  });

  it('should accept optional context field', () => {
    const validInput = {
      command: 'wu:claim',
      arguments: { id: 'WU-123' },
      context: {
        session_id: '12345',
        user: 'tom@hellm.ai',
      },
    };

    expect(() => ToolInputSchema.parse(validInput)).not.toThrow();
  });
});

describe('ToolOutputSchema', () => {
  it('should validate successful output', () => {
    const validOutput = {
      success: true,
      data: { claimed: 'WU-123' },
    };

    expect(() => ToolOutputSchema.parse(validOutput)).not.toThrow();
  });

  it('should validate error output with error field', () => {
    const errorOutput = {
      success: false,
      error: {
        code: 'WU_NOT_FOUND',
        message: 'WU-123 not found',
      },
    };

    expect(() => ToolOutputSchema.parse(errorOutput)).not.toThrow();
  });

  it('should validate output with warnings', () => {
    const outputWithWarnings = {
      success: true,
      data: { result: 'ok' },
      warnings: ['Deprecated flag used'],
    };

    expect(() => ToolOutputSchema.parse(outputWithWarnings)).not.toThrow();
  });

  it('should validate output with metadata', () => {
    const outputWithMetadata = {
      success: true,
      data: { result: 'ok' },
      metadata: {
        duration_ms: 150,
        timestamp: '2025-12-06T00:00:00Z',
      },
    };

    expect(() => ToolOutputSchema.parse(outputWithMetadata)).not.toThrow();
  });

  it('should reject output without success field', () => {
    const invalidOutput = {
      data: { result: 'ok' },
    };

    expect(() => ToolOutputSchema.parse(invalidOutput)).toThrow();
  });
});

describe('ToolMetadataSchema', () => {
  it('should validate complete metadata', () => {
    const validMetadata = {
      name: 'wu:claim',
      description: 'Claim a Work Unit',
      domain: TOOL_DOMAINS.WU,
      permission: PERMISSION_LEVELS.WRITE,
      version: '1.0.0',
    };

    expect(() => ToolMetadataSchema.parse(validMetadata)).not.toThrow();
  });

  it('should validate metadata with optional fields', () => {
    const metadataWithOptionals = {
      name: 'wu:claim',
      description: 'Claim a Work Unit',
      domain: TOOL_DOMAINS.WU,
      permission: PERMISSION_LEVELS.WRITE,
      version: '1.0.0',
      tags: ['wu', 'workflow'],
      examples: [
        {
          description: 'Claim WU-123',
          input: { command: 'wu:claim', arguments: { id: 'WU-123' } },
        },
      ],
    };

    expect(() => ToolMetadataSchema.parse(metadataWithOptionals)).not.toThrow();
  });

  it('should reject metadata with invalid domain', () => {
    const invalidMetadata = {
      name: 'wu:claim',
      description: 'Claim a Work Unit',
      domain: 'invalid_domain',
      permission: PERMISSION_LEVELS.WRITE,
      version: '1.0.0',
    };

    expect(() => ToolMetadataSchema.parse(invalidMetadata)).toThrow();
  });

  it('should reject metadata with invalid permission level', () => {
    const invalidMetadata = {
      name: 'wu:claim',
      description: 'Claim a Work Unit',
      domain: TOOL_DOMAINS.WU,
      permission: 'superuser',
      version: '1.0.0',
    };

    expect(() => ToolMetadataSchema.parse(invalidMetadata)).toThrow();
  });
});

describe('ToolDefinitionSchema', () => {
  it('should validate complete tool definition', () => {
    const validDefinition = {
      metadata: {
        name: 'wu:claim',
        description: 'Claim a Work Unit',
        domain: TOOL_DOMAINS.WU,
        permission: PERMISSION_LEVELS.WRITE,
        version: '1.0.0',
      },
      inputSchema: z.object({
        id: z.string(),
        lane: z.string(),
      }),
      execute: async () => ({ success: true, data: {} }),
    };

    expect(() => ToolDefinitionSchema.parse(validDefinition)).not.toThrow();
  });

  it('should accept optional outputSchema', () => {
    const definitionWithOutputSchema = {
      metadata: {
        name: 'wu:claim',
        description: 'Claim a Work Unit',
        domain: TOOL_DOMAINS.WU,
        permission: PERMISSION_LEVELS.WRITE,
        version: '1.0.0',
      },
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ claimed: z.string() }),
      execute: async () => ({ success: true, data: { claimed: 'WU-123' } }),
    };

    expect(() => ToolDefinitionSchema.parse(definitionWithOutputSchema)).not.toThrow();
  });
});

describe('toJSONSchema', () => {
  it('should convert Zod schema to JSON Schema', () => {
    const zodSchema = z.object({
      id: z.string(),
      count: z.number().optional(),
    });

    const jsonSchema = toJSONSchema(zodSchema);

    expect(jsonSchema).toHaveProperty('type', 'object');
    expect(jsonSchema).toHaveProperty('properties');
    expect(jsonSchema.properties).toHaveProperty('id');
    expect(jsonSchema.properties).toHaveProperty('count');
  });

  it('should handle nested schemas', () => {
    const zodSchema = z.object({
      metadata: z.object({
        created: z.string(),
        author: z.string(),
      }),
    });

    const jsonSchema = toJSONSchema(zodSchema);

    expect(jsonSchema.properties).toHaveProperty('metadata');
    expect(jsonSchema.properties.metadata).toHaveProperty('type', 'object');
  });

  it('should include description from Zod schema', () => {
    const zodSchema = z
      .object({
        id: z.string().describe('Work Unit ID'),
      })
      .describe('Tool input');

    const jsonSchema = toJSONSchema(zodSchema);

    expect(jsonSchema).toHaveProperty('description', 'Tool input');
  });
});

describe('Schema validation error messages', () => {
  it('should provide clear error messages for invalid ToolInput', () => {
    const invalidInput = {
      command: 123, // Should be string
      arguments: { id: 'WU-123' },
    };

    try {
      ToolInputSchema.parse(invalidInput);
      expect.fail('Should have thrown validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      const zodError = error as z.ZodError;
      expect(zodError.errors[0].path).toContain('command');
      expect(zodError.errors[0].message).toContain('string');
    }
  });

  it('should provide clear error messages for missing required fields', () => {
    const invalidMetadata = {
      name: 'wu:claim',
      // Missing required fields: description, domain, permission, version
    };

    try {
      ToolMetadataSchema.parse(invalidMetadata);
      expect.fail('Should have thrown validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      const zodError = error as z.ZodError;
      expect(zodError.errors.length).toBeGreaterThan(0);
    }
  });
});
