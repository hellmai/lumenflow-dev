/**
 * Domain Schemas Index
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * Re-exports all domain schemas and types for the context-aware validation system.
 *
 * @module domain
 */

// Context schemas (primary definitions for location, git, wu state)
export * from './context.schemas.js';

// Validation schemas (excludes re-exports from context.schemas)
export {
  VALIDATION_ERROR_CODE_VALUES,
  ValidationErrorCodeSchema,
  PREDICATE_SEVERITY_VALUES,
  PredicateSeveritySchema,
  ValidationErrorSchema,
  ValidationWarningSchema,
  ValidationResultSchema,
  CommandPredicateConfigSchema,
  CommandDefinitionConfigSchema,
  type ValidationErrorCode,
  type PredicateSeverity,
  type ValidationError,
  type ValidationWarning,
  type ValidationResult,
  type CommandPredicateConfig,
  type CommandDefinitionConfig,
} from './validation.schemas.js';

// Recovery schemas
export * from './recovery.schemas.js';

// Orchestration schemas (existing)
export * from './orchestration.schemas.js';
export * from './orchestration.constants.js';
