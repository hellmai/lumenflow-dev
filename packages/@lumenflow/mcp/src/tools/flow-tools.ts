/**
 * @file flow-tools.ts
 * @description Flow/Metrics tool implementations
 *
 * WU-1642: Extracted from tools.ts during domain decomposition.
 * WU-1426: Flow/Metrics tools: flow_bottlenecks, flow_report, metrics_snapshot
 * WU-1457: All flow/metrics commands use shared schemas
 * WU-1803: Migrated from CLI shell-out to executeViaPack (runtime pack execution)
 */

import {
  flowBottlenecksSchema,
  flowReportSchema,
  metricsSnapshotSchema,
  metricsSchema,
} from '@lumenflow/core';
import {
  type ToolDefinition,
  ErrorCodes,
  CliArgs,
  buildMetricsArgs,
  executeViaPack,
} from '../tools-shared.js';
import { CliCommands } from '../mcp-constants.js';

/**
 * flow_bottlenecks - Identify flow bottlenecks
 */
export const flowBottlenecksTool: ToolDefinition = {
  name: 'flow_bottlenecks',
  description: 'Identify flow bottlenecks in the workflow (WIP violations, stuck WUs, etc.)',
  inputSchema: flowBottlenecksSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.limit) args.push('--limit', String(input.limit));
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);
    if (input.json) args.push(...CliArgs.FORMAT_JSON);

    const result = await executeViaPack(CliCommands.FLOW_BOTTLENECKS, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.FLOW_BOTTLENECKS,
        args,
        errorCode: ErrorCodes.FLOW_BOTTLENECKS_ERROR,
      },
    });

    return result;
  },
};

/**
 * flow_report - Generate flow metrics report
 */
export const flowReportTool: ToolDefinition = {
  name: 'flow_report',
  description: 'Generate flow metrics report with cycle time, throughput, and other DORA metrics',
  inputSchema: flowReportSchema,

  async execute(input, options) {
    const args: string[] = [];
    if (input.start) args.push('--start', input.start as string);
    if (input.end) args.push('--end', input.end as string);
    if (input.days) args.push('--days', String(input.days));
    if (input.format) args.push(CliArgs.FORMAT, input.format as string);
    if (input.json) args.push(...CliArgs.FORMAT_JSON);

    const result = await executeViaPack(CliCommands.FLOW_REPORT, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.FLOW_REPORT,
        args,
        errorCode: ErrorCodes.FLOW_REPORT_ERROR,
      },
    });

    return result;
  },
};

/**
 * metrics_snapshot - Capture metrics snapshot
 */
export const metricsSnapshotTool: ToolDefinition = {
  name: 'metrics_snapshot',
  description: 'Capture a snapshot of current LumenFlow metrics',
  inputSchema: metricsSnapshotSchema,

  async execute(input, options) {
    const result = await executeViaPack(CliCommands.METRICS_SNAPSHOT, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.METRICS_SNAPSHOT,
        args: [],
        errorCode: ErrorCodes.METRICS_SNAPSHOT_ERROR,
      },
    });

    return result;
  },
};

/**
 * lumenflow_metrics - Public metrics alias
 */
export const lumenflowMetricsTool: ToolDefinition = {
  name: 'lumenflow_metrics',
  description: 'View workflow metrics (lumenflow:metrics alias)',
  inputSchema: metricsSchema,

  async execute(input, options) {
    const args = buildMetricsArgs(input);

    const result = await executeViaPack(CliCommands.LUMENFLOW_METRICS, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.METRICS,
        args,
        errorCode: ErrorCodes.LUMENFLOW_METRICS_ERROR,
      },
    });

    return result;
  },
};

/**
 * metrics - Unified workflow metrics command
 */
export const metricsTool: ToolDefinition = {
  name: 'metrics',
  description: 'View workflow metrics (lanes, dora, flow, all)',
  inputSchema: metricsSchema,

  async execute(input, options) {
    const args = buildMetricsArgs(input);

    const result = await executeViaPack(CliCommands.METRICS, input, {
      projectRoot: options?.projectRoot,
      fallback: {
        command: CliCommands.METRICS,
        args,
        errorCode: ErrorCodes.METRICS_ERROR,
      },
    });

    return result;
  },
};
