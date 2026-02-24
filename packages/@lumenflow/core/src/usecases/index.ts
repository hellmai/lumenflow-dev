// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Use Cases Index
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 * WU-2128: Standardize error return contracts
 *
 * Re-exports all use case classes.
 *
 * Error Contract (WU-2128):
 * Use cases depend on port interfaces that THROW on failure. Use cases
 * propagate these exceptions to callers (CLI command handlers), which
 * CATCH and format errors for user output. Use cases do not return
 * Result types -- they rely on the port boundary contract of throwing.
 *
 * See ADR-004 for the full three-layer error contract specification.
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
