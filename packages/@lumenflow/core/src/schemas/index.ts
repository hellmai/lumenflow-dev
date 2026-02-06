/**
 * @file schemas/index.ts
 * @description Shared command schemas and utilities for CLI/MCP parity (WU-1431, WU-1454)
 *
 * This module exports:
 * - Zod schemas for all commands (wu:create, wu:claim, wu:status, wu:done, gates) (WU-1431)
 * - Zod schemas for 16 WU lifecycle commands (WU-1454)
 * - MCP inputSchema generation utilities
 * - CLI option generation utilities
 * - CLI argument validators
 * - Parity validation utilities
 */

// Command schemas (WU-1431: 5 original commands)
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

// WU Lifecycle schemas (WU-1454: 16 lifecycle commands)
export {
  // Schemas
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
  // Types
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
  // Registry
  lifecycleCommandSchemas,
  type LifecycleCommandName,
} from './wu-lifecycle-schemas.js';

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

// Argument validators (WU-1431: 5 original commands)
export {
  validateWuCreateArgs,
  validateWuClaimArgs,
  validateWuStatusArgs,
  validateWuDoneArgs,
  validateGatesArgs,
  // Renamed to avoid conflict with validation/index.js ValidationResult
  type ValidationResult as ArgValidationResult,
} from './arg-validators.js';

// WU Lifecycle argument validators (WU-1454: 16 lifecycle commands)
export {
  validateWuBlockArgs,
  validateWuUnblockArgs,
  validateWuEditArgs,
  validateWuReleaseArgs,
  validateWuRecoverArgs,
  validateWuRepairArgs,
  validateWuDepsArgs,
  validateWuPrepArgs,
  validateWuPreflightArgs,
  validateWuPruneArgs,
  validateWuDeleteArgs,
  validateWuCleanupArgs,
  validateWuSpawnArgs,
  validateWuValidateArgs,
  validateWuInferLaneArgs,
  validateWuUnlockLaneArgs,
} from './wu-lifecycle-arg-validators.js';
