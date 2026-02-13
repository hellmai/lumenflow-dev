/**
 * Shared types for gates module
 *
 * WU-1550: Extracted type definitions used across gate-registry,
 * gate-defaults, and the main gates.ts orchestrator.
 *
 * WU-1647: DocsOnlyTestPlan now canonical in gates-plan-resolvers.ts;
 * re-exported here for backward compatibility with gate-defaults.ts.
 *
 * @module gates-types
 */

// Re-export from canonical location (WU-1647)
export type { DocsOnlyTestPlan } from './gates-plan-resolvers.js';

/**
 * Lane health gate mode
 */
export type LaneHealthMode = 'warn' | 'error' | 'off';
