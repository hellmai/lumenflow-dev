// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file flow-metrics-tools.ts
 * @description Software-delivery pack handlers for flow/metrics tools.
 *
 * WU-1905: Migrated from in-process resolver stubs in runtime-tool-resolver.ts
 * to native software-delivery pack handlers.
 */

import type { ToolOutput } from '@lumenflow/kernel';
import { RUNTIME_CLI_COMMANDS, runtimeCliAdapter } from './runtime-cli-adapter.js';

// --- Tool name constants ---

const FLOW_METRICS_TOOLS = {
  FLOW_BOTTLENECKS: 'flow:bottlenecks',
  FLOW_REPORT: 'flow:report',
  METRICS: 'metrics',
  METRICS_SNAPSHOT: 'metrics:snapshot',
} as const;

type FlowMetricsToolName = (typeof FLOW_METRICS_TOOLS)[keyof typeof FLOW_METRICS_TOOLS];

// --- Error code mapping ---

const FLOW_METRICS_TOOL_ERROR_CODES: Record<FlowMetricsToolName, string> = {
  'flow:bottlenecks': 'FLOW_BOTTLENECKS_ERROR',
  'flow:report': 'FLOW_REPORT_ERROR',
  metrics: 'METRICS_ERROR',
  'metrics:snapshot': 'METRICS_SNAPSHOT_ERROR',
};

const FLOW_METRICS_TOOL_COMMANDS: Record<
  FlowMetricsToolName,
  (typeof RUNTIME_CLI_COMMANDS)[keyof typeof RUNTIME_CLI_COMMANDS]
> = {
  'flow:bottlenecks': RUNTIME_CLI_COMMANDS.FLOW_BOTTLENECKS,
  'flow:report': RUNTIME_CLI_COMMANDS.FLOW_REPORT,
  metrics: RUNTIME_CLI_COMMANDS.METRICS,
  'metrics:snapshot': RUNTIME_CLI_COMMANDS.METRICS_SNAPSHOT,
};

// --- Input helpers ---

function toRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return {};
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

// --- Command execution ---

interface CommandExecutionResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  executionError?: string;
}

async function runFlowMetricsCommand(
  toolName: FlowMetricsToolName,
  args: string[],
): Promise<CommandExecutionResult> {
  return runtimeCliAdapter.run(FLOW_METRICS_TOOL_COMMANDS[toolName], args);
}

function createFailureOutput(
  toolName: FlowMetricsToolName,
  execution: CommandExecutionResult,
): ToolOutput {
  const stderrMessage = execution.stderr.trim();
  const stdoutMessage = execution.stdout.trim();
  const message =
    execution.executionError ??
    (stderrMessage.length > 0
      ? stderrMessage
      : stdoutMessage.length > 0
        ? stdoutMessage
        : `${toolName} failed`);
  return {
    success: false,
    error: {
      code: FLOW_METRICS_TOOL_ERROR_CODES[toolName],
      message,
      details: {
        exit_code: execution.status,
        stdout: execution.stdout,
        stderr: execution.stderr,
      },
    },
  };
}

function createSuccessOutput(
  toolName: FlowMetricsToolName,
  execution: CommandExecutionResult,
): ToolOutput {
  const message = execution.stdout.trim().length > 0 ? execution.stdout.trim() : `${toolName} ran`;
  return {
    success: true,
    data: {
      message,
    },
  };
}

async function executeFlowMetricsTool(
  toolName: FlowMetricsToolName,
  args: string[],
): Promise<ToolOutput> {
  const execution = await runFlowMetricsCommand(toolName, args);
  if (!execution.ok) {
    return createFailureOutput(toolName, execution);
  }
  return createSuccessOutput(toolName, execution);
}

// --- Public tool handlers ---

/**
 * flow:bottlenecks handler -- identifies flow bottlenecks via CLI.
 */
export async function flowBottlenecksTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  const limit = toNumberValue(parsed.limit);
  if (limit !== null) {
    args.push('--limit', String(limit));
  }

  const format = toStringValue(parsed.format);
  if (format) {
    args.push('--format', format);
  }

  return executeFlowMetricsTool(FLOW_METRICS_TOOLS.FLOW_BOTTLENECKS, args);
}

/**
 * flow:report handler -- generates flow metrics report via CLI.
 */
export async function flowReportTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  const start = toStringValue(parsed.start);
  if (start) {
    args.push('--start', start);
  }

  const end = toStringValue(parsed.end);
  if (end) {
    args.push('--end', end);
  }

  const days = toNumberValue(parsed.days);
  if (days !== null) {
    args.push('--days', String(days));
  }

  const format = toStringValue(parsed.format);
  if (format) {
    args.push('--format', format);
  }

  return executeFlowMetricsTool(FLOW_METRICS_TOOLS.FLOW_REPORT, args);
}

/**
 * metrics handler -- unified workflow metrics command via CLI.
 */
export async function metricsTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];

  const subcommand = toStringValue(parsed.subcommand);
  if (subcommand) {
    args.push(subcommand);
  }

  const days = toNumberValue(parsed.days);
  if (days !== null) {
    args.push('--days', String(days));
  }

  const format = toStringValue(parsed.format);
  if (format) {
    args.push('--format', format);
  }

  return executeFlowMetricsTool(FLOW_METRICS_TOOLS.METRICS, args);
}

/**
 * metrics:snapshot handler -- captures metrics snapshot via CLI.
 */
export async function metricsSnapshotTool(_input: unknown): Promise<ToolOutput> {
  return executeFlowMetricsTool(FLOW_METRICS_TOOLS.METRICS_SNAPSHOT, []);
}
