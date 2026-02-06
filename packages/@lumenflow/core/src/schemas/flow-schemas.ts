/**
 * @file flow-schemas.ts
 * @description Shared Zod schemas for Flow/Metrics commands (WU-1457)
 *
 * These schemas are the single source of truth for flow and metrics command validation.
 * Both CLI argument parsing and MCP inputSchema derivation use these schemas.
 *
 * This file covers the 4 flow/metrics commands that were previously hand-coded
 * in MCP and CLI separately.
 *
 * Design decisions:
 * - Use snake_case for property names (MCP convention, JSON Schema friendly)
 * - Include descriptions for each field (used in both CLI help and MCP tool descriptions)
 * - CLI-only aliases are NOT defined here (handled in arg-validators)
 */

import { z } from 'zod';

// =============================================================================
// flow:bottlenecks Schema
// =============================================================================

/**
 * Schema for flow:bottlenecks command
 *
 * No required fields
 * Optional: limit, format, json
 */
export const flowBottlenecksSchema = z.object({
  limit: z.number().optional().describe('Number of bottlenecks to show (default: 10)'),
  format: z
    .enum(['json', 'table', 'mermaid'])
    .optional()
    .describe('Output format: json, table, mermaid'),
  json: z.boolean().optional().describe('Output as JSON (shorthand for --format json)'),
});

export type FlowBottlenecksInput = z.infer<typeof flowBottlenecksSchema>;

// =============================================================================
// flow:report Schema
// =============================================================================

/**
 * Schema for flow:report command
 *
 * No required fields
 * Optional: start, end, days, format, json
 */
export const flowReportSchema = z.object({
  start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  end: z.string().optional().describe('End date (YYYY-MM-DD), defaults to today'),
  days: z.number().optional().describe('Days to report (default: 7)'),
  format: z.enum(['json', 'table']).optional().describe('Output format: json, table'),
  json: z.boolean().optional().describe('Output as JSON (shorthand for --format json)'),
});

export type FlowReportInput = z.infer<typeof flowReportSchema>;

// =============================================================================
// metrics:snapshot Schema
// =============================================================================

/**
 * Schema for metrics:snapshot command
 *
 * No required fields
 * Optional: type, output, days, dry_run, format
 */
export const metricsSnapshotSchema = z.object({
  type: z
    .enum(['all', 'dora', 'lanes', 'flow'])
    .optional()
    .describe('Snapshot type: all, dora, lanes, flow (default: all)'),
  output: z.string().optional().describe('Output file path'),
  days: z.number().optional().describe('Days window for metrics calculation'),
  dry_run: z.boolean().optional().describe('Preview without writing snapshot file'),
  format: z.enum(['json', 'table']).optional().describe('Output format'),
});

export type MetricsSnapshotInput = z.infer<typeof metricsSnapshotSchema>;

// =============================================================================
// metrics (unified CLI) Schema
// =============================================================================

/**
 * Schema for unified metrics command
 *
 * No required fields
 * Optional: subcommand, format, days, output, dry_run
 */
export const metricsSchema = z.object({
  subcommand: z
    .enum(['lanes', 'dora', 'flow', 'all'])
    .optional()
    .describe('Metrics subcommand (lanes, dora, flow, all)'),
  format: z.enum(['json', 'table']).optional().describe('Output format'),
  days: z.number().optional().describe('Days window for metrics calculation'),
  output: z.string().optional().describe('Custom output file path'),
  dry_run: z.boolean().optional().describe('Preview without writing'),
});

export type MetricsInput = z.infer<typeof metricsSchema>;

// =============================================================================
// Flow Schema Registry
// =============================================================================

/**
 * Registry of all flow/metrics command schemas for validation and parity checking.
 * These complement the schemas in command-schemas.ts (WU-1431),
 * wu-lifecycle-schemas.ts (WU-1454), initiative-schemas.ts (WU-1455),
 * and memory-schemas.ts (WU-1456).
 */
export const flowCommandSchemas = {
  'flow:bottlenecks': flowBottlenecksSchema,
  'flow:report': flowReportSchema,
  'metrics:snapshot': metricsSnapshotSchema,
  metrics: metricsSchema,
} as const;

export type FlowCommandName = keyof typeof flowCommandSchemas;
