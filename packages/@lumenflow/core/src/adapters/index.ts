// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Adapters Index
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Re-exports all adapter implementations.
 *
 * @module adapters
 */

// Context adapters
export {
  SimpleGitLocationAdapter,
  SimpleGitStateAdapter,
  FileSystemWuStateAdapter,
} from './context-adapters.js';

// Validation adapters
export { CommandRegistryAdapter } from './validation-adapters.js';

// Recovery adapters
export { RecoveryAnalyzerAdapter } from './recovery-adapters.js';

// Existing adapters (pre-WU-1094)
export { TerminalDashboardRenderer } from './terminal-renderer.adapter.js';
export { FileSystemMetricsCollector } from './filesystem-metrics.adapter.js';
