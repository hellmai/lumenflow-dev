/**
 * Use Cases Index
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Re-exports all use case classes.
 *
 * @module usecases
 */

// Context use cases
export { ComputeContextUseCase, type ComputeContextOptions } from './compute-context.usecase.js';

// Validation use cases
export { ValidateCommandUseCase } from './validate-command.usecase.js';

// Recovery use cases
export { AnalyzeRecoveryUseCase } from './analyze-recovery.usecase.js';

// Existing use cases (pre-WU-1094)
export {
  GetDashboardDataUseCase,
  type GetDashboardDataOptions,
} from './get-dashboard-data.usecase.js';

export { GetSuggestionsUseCase, type GetSuggestionsOptions } from './get-suggestions.usecase.js';
