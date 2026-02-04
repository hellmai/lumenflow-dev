/**
 * @file schemas/index.ts
 * @description Shared command schemas and utilities for CLI/MCP parity (WU-1431)
 *
 * This module exports:
 * - Zod schemas for all commands (wu:create, wu:claim, wu:status, wu:done, gates)
 * - MCP inputSchema generation utilities
 * - CLI option generation utilities
 * - CLI argument validators
 * - Parity validation utilities
 */

// Command schemas
export {
  // Schemas
  wuCreateSchema,
  wuClaimSchema,
  wuStatusSchema,
  wuDoneSchema,
  gatesSchema,
  // Enums
  exposureEnum,
  wuStatusEnum,
  // Types
  type WuCreateInput,
  type WuClaimInput,
  type WuStatusInput,
  type WuDoneInput,
  type GatesInput,
  type Exposure,
  type WuStatus,
  // Registry
  commandSchemas,
  type CommandName,
} from './command-schemas.js';

// Schema utilities
export {
  // MCP utilities
  zodToMcpInputSchema,
  // CLI utilities
  zodToCliOptions,
  getCliOnlyAliases,
  // Parity validation
  validateCliMcpParity,
  // Types
  type JsonSchema,
  type JsonSchemaProperty,
  type CliOption,
  type CliAlias,
  type ParityValidationResult,
} from './schema-utils.js';

// Argument validators
export {
  validateWuCreateArgs,
  validateWuClaimArgs,
  validateWuStatusArgs,
  validateWuDoneArgs,
  validateGatesArgs,
  // Renamed to avoid conflict with validation/index.js ValidationResult
  type ValidationResult as ArgValidationResult,
} from './arg-validators.js';
