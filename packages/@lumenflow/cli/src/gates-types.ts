/**
 * Shared types for gates module
 *
 * WU-1550: Extracted type definitions used across gate-registry,
 * gate-defaults, and the main gates.ts orchestrator.
 *
 * @module gates-types
 */

/**
 * Docs-only test plan (re-exported from gates.ts for use by gate-defaults)
 */
export type DocsOnlyTestPlan = {
  mode: 'skip' | 'filtered';
  packages: string[];
  reason?: 'no-code-packages';
};

/**
 * Lane health gate mode
 */
export type LaneHealthMode = 'warn' | 'error' | 'off';
