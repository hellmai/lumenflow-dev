/**
 * @file schema-utils.ts
 * @description Utilities for converting Zod schemas to MCP inputSchema and CLI options (WU-1431)
 *
 * These utilities enable deriving both MCP inputSchema and CLI argument definitions
 * from the shared Zod schemas, ensuring parity between CLI and MCP.
 */

import { z } from 'zod';

// =============================================================================
// Internal Type Helpers
// =============================================================================

/**
 * Internal Zod definition accessor type
 *
 * Zod's internal _def structure is not part of the public API,
 * so we use a permissive type to access implementation details
 * for schema introspection purposes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodDef = Record<string, any>;

/**
 * Get the internal _def from a Zod type
 */
function getDef(zodType: z.ZodTypeAny): ZodDef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
  return (zodType as any)._def as ZodDef;
}

// =============================================================================
// Types
// =============================================================================

/**
 * JSON Schema representation for MCP inputSchema
 */
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * CLI option definition compatible with Commander.js
 */
export interface CliOption {
  name: string;
  flags: string;
  description: string;
  default?: unknown;
  isRepeatable?: boolean;
  required?: boolean;
}

/**
 * CLI-only alias definition
 */
export interface CliAlias {
  name: string;
  flags: string;
  description: string;
  canonical: string; // The MCP-compatible field name this maps to
  isRepeatable?: boolean;
}

/**
 * Validation result for parity checking
 */
export interface ParityValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// CLI-Only Aliases
// =============================================================================

/**
 * CLI-only aliases that are NOT exposed in MCP schemas
 * These provide ergonomic shortcuts for CLI users but map to canonical fields
 */
const CLI_ONLY_ALIASES: Record<string, CliAlias> = {
  codePath: {
    name: 'codePath',
    flags: '--code-path <path>',
    description: 'Alias for --code-paths (repeatable)',
    canonical: 'code_paths',
    isRepeatable: true,
  },
  manualTest: {
    name: 'manualTest',
    flags: '--manual-test <test>',
    description: 'Alias for --test-paths-manual (repeatable)',
    canonical: 'test_paths_manual',
    isRepeatable: true,
  },
};

/**
 * Get CLI-only alias definitions
 *
 * These aliases are NOT exposed in MCP schemas but are available in CLI.
 * They map to canonical field names for validation/processing.
 */
export function getCliOnlyAliases(): Record<string, CliAlias> {
  return { ...CLI_ONLY_ALIASES };
}

// =============================================================================
// Zod to JSON Schema (for MCP inputSchema)
// =============================================================================

/**
 * Get Zod type name (compatible with both Zod 3 and Zod 4)
 */
function getZodTypeName(zodType: z.ZodTypeAny): string {
  const def = getDef(zodType);
  // Zod 4 uses _def.type as a string
  if (def?.type && typeof def.type === 'string') {
    return def.type as string;
  }
  // Zod 3 uses _def.typeName
  if (def?.typeName) {
    return def.typeName as string;
  }
  return 'unknown';
}

/**
 * Get inner type from Zod wrapper types (optional, default, etc.)
 */
function getInnerType(zodType: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const def = getDef(zodType);
  // Zod 4: innerType is an object with its own _def
  if (def?.innerType) {
    // In Zod 4, innerType has a def property we need to wrap
    if (def.innerType.def) {
      return { _def: def.innerType.def } as z.ZodTypeAny;
    }
    return def.innerType as z.ZodTypeAny;
  }
  return undefined;
}

/**
 * Convert a Zod type to JSON Schema type string
 */
function zodTypeToJsonType(zodType: z.ZodTypeAny): string {
  const typeName = getZodTypeName(zodType);

  switch (typeName) {
    case 'string':
    case 'ZodString':
      return 'string';
    case 'number':
    case 'ZodNumber':
      return 'number';
    case 'boolean':
    case 'ZodBoolean':
      return 'boolean';
    case 'array':
    case 'ZodArray':
      return 'array';
    case 'object':
    case 'ZodObject':
      return 'object';
    case 'enum':
    case 'ZodEnum':
      return 'string';
    case 'optional':
    case 'ZodOptional': {
      const inner = getInnerType(zodType);
      return inner ? zodTypeToJsonType(inner) : 'string';
    }
    case 'default':
    case 'ZodDefault': {
      const inner = getInnerType(zodType);
      return inner ? zodTypeToJsonType(inner) : 'string';
    }
    default:
      return 'string'; // Fallback
  }
}

/**
 * Get enum values from Zod enum type
 */
function getEnumValues(zodType: z.ZodTypeAny): string[] | undefined {
  const typeName = getZodTypeName(zodType);
  const def = getDef(zodType);

  // Zod 4 enum
  if (typeName === 'enum' && def?.entries) {
    return Object.keys(def.entries as object);
  }
  // Zod 3 enum
  if (typeName === 'ZodEnum' && def?.values) {
    return def.values as string[];
  }
  // Unwrap optional/default
  if (
    typeName === 'optional' ||
    typeName === 'ZodOptional' ||
    typeName === 'default' ||
    typeName === 'ZodDefault'
  ) {
    const inner = getInnerType(zodType);
    return inner ? getEnumValues(inner) : undefined;
  }
  return undefined;
}

/**
 * Get description from Zod type
 */
function getDescription(zodType: z.ZodTypeAny): string | undefined {
  const def = getDef(zodType);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  return (def?.description as string | undefined) ?? (zodType as any).description;
}

/**
 * Check if Zod type is optional
 */
function isOptional(zodType: z.ZodTypeAny): boolean {
  const typeName = getZodTypeName(zodType);
  return (
    typeName === 'optional' ||
    typeName === 'ZodOptional' ||
    typeName === 'default' ||
    typeName === 'ZodDefault' ||
    zodType.isOptional?.() === true
  );
}

/**
 * Get inner type from Zod array
 */
function getArrayItemType(zodType: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const typeName = getZodTypeName(zodType);
  const def = getDef(zodType);

  // Zod 4 array
  if (typeName === 'array' && def?.element) {
    // Wrap the element's def for compatibility
    if (def.element.def) {
      return { _def: def.element.def } as z.ZodTypeAny;
    }
    return def.element as z.ZodTypeAny;
  }
  // Zod 3 array
  if (typeName === 'ZodArray' && def?.type) {
    return def.type as z.ZodTypeAny;
  }
  // Unwrap optional/default
  if (
    typeName === 'optional' ||
    typeName === 'ZodOptional' ||
    typeName === 'default' ||
    typeName === 'ZodDefault'
  ) {
    const inner = getInnerType(zodType);
    return inner ? getArrayItemType(inner) : undefined;
  }
  return undefined;
}

/**
 * Convert a Zod schema to MCP-compatible JSON Schema
 *
 * @param schema - Zod object schema
 * @returns JSON Schema representation for MCP inputSchema
 */
export function zodToMcpInputSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const shape = schema.shape;
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [key, zodType] of Object.entries(shape)) {
    const type = zodTypeToJsonType(zodType as z.ZodTypeAny);
    const description = getDescription(zodType as z.ZodTypeAny);
    const enumValues = getEnumValues(zodType as z.ZodTypeAny);

    const property: JsonSchemaProperty = { type };
    if (description) property.description = description;
    if (enumValues) property.enum = enumValues;

    // Handle array items
    if (type === 'array') {
      const itemType = getArrayItemType(zodType as z.ZodTypeAny);
      if (itemType) {
        property.items = { type: zodTypeToJsonType(itemType) };
      }
    }

    properties[key] = property;

    // Track required fields
    if (!isOptional(zodType as z.ZodTypeAny)) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
    additionalProperties: false,
  };
}

// =============================================================================
// Zod to CLI Options (for Commander.js)
// =============================================================================

/**
 * Convert snake_case to kebab-case for CLI flags
 */
function toKebabCase(str: string): string {
  return str.replace(/_/g, '-');
}

/**
 * Convert snake_case to camelCase for option names
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert a Zod schema to CLI option definitions
 *
 * @param schema - Zod object schema
 * @returns Array of CLI option definitions compatible with Commander.js
 */
export function zodToCliOptions(schema: z.ZodObject<z.ZodRawShape>): CliOption[] {
  const shape = schema.shape;
  const options: CliOption[] = [];

  for (const [key, zodType] of Object.entries(shape)) {
    const type = zodTypeToJsonType(zodType as z.ZodTypeAny);
    const description = getDescription(zodType as z.ZodTypeAny) ?? '';
    const isRequired = !isOptional(zodType as z.ZodTypeAny);
    const isRepeatable = type === 'array';
    const kebabKey = toKebabCase(key);
    const camelKey = toCamelCase(key);

    // Build flags string
    // Boolean flags don't need <value> placeholder
    const valueSpec = type === 'boolean' ? '' : ` <${key}>`;
    const flags = `--${kebabKey}${valueSpec}`;

    options.push({
      name: camelKey,
      flags,
      description,
      required: isRequired,
      isRepeatable,
    });
  }

  return options;
}

// =============================================================================
// Parity Validation
// =============================================================================

/**
 * Validate CLI/MCP parity for a command schema
 *
 * Checks that:
 * 1. All MCP fields are available in CLI
 * 2. Required fields are consistent
 * 3. Types are compatible
 *
 * @param commandName - Name of the command (for error messages)
 * @param schema - Zod schema for the command
 * @returns Validation result with errors and warnings
 */
export function validateCliMcpParity(
  commandName: string,
  schema: z.ZodObject<z.ZodRawShape>,
): ParityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Generate both representations
  const jsonSchema = zodToMcpInputSchema(schema);
  const cliOptions = zodToCliOptions(schema);

  // Check that all MCP fields have CLI equivalents
  for (const mcpField of Object.keys(jsonSchema.properties)) {
    const cliField = toCamelCase(mcpField);
    const hasCliOption = cliOptions.some((opt) => opt.name === cliField);

    if (!hasCliOption) {
      errors.push(`${commandName}: MCP field '${mcpField}' has no CLI equivalent`);
    }
  }

  // Check required field consistency
  const mcpRequired = new Set(jsonSchema.required ?? []);
  for (const opt of cliOptions) {
    const mcpField = toKebabCase(opt.name).replace(/-/g, '_');
    const mcpIsRequired = mcpRequired.has(mcpField);

    if (opt.required !== mcpIsRequired) {
      errors.push(
        `${commandName}: Field '${opt.name}' required mismatch (CLI: ${opt.required}, MCP: ${mcpIsRequired})`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
