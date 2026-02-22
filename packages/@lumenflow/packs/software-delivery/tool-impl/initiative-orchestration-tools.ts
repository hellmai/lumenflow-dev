// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { ToolOutput } from '@lumenflow/kernel';
import { RUNTIME_CLI_COMMANDS, runtimeCliAdapter } from './runtime-cli-adapter.js';

const INITIATIVE_ORCHESTRATION_TOOLS = {
  CLOUD_CONNECT: 'cloud:connect',
  WORKSPACE_INIT: 'workspace:init',
  INITIATIVE_ADD_WU: 'initiative:add-wu',
  INITIATIVE_BULK_ASSIGN: 'initiative:bulk-assign',
  INITIATIVE_CREATE: 'initiative:create',
  INITIATIVE_EDIT: 'initiative:edit',
  INITIATIVE_LIST: 'initiative:list',
  INITIATIVE_PLAN: 'initiative:plan',
  INITIATIVE_REMOVE_WU: 'initiative:remove-wu',
  INITIATIVE_STATUS: 'initiative:status',
  ORCHESTRATE_INIT_STATUS: 'orchestrate:init-status',
  ORCHESTRATE_INITIATIVE: 'orchestrate:initiative',
  ORCHESTRATE_MONITOR: 'orchestrate:monitor',
  PLAN_CREATE: 'plan:create',
  PLAN_EDIT: 'plan:edit',
  PLAN_LINK: 'plan:link',
  PLAN_PROMOTE: 'plan:promote',
  DELEGATION_LIST: 'delegation:list',
  DOCS_SYNC: 'docs:sync',
  INIT_PLAN: 'init:plan',
  LUMENFLOW: 'lumenflow',
  LUMENFLOW_DOCTOR: 'lumenflow:doctor',
  LUMENFLOW_INTEGRATE: 'lumenflow:integrate',
  LUMENFLOW_RELEASE: 'lumenflow:release',
  LUMENFLOW_UPGRADE: 'lumenflow:upgrade',
  SYNC_TEMPLATES: 'sync:templates',
} as const;

type InitiativeOrchestrationToolName =
  (typeof INITIATIVE_ORCHESTRATION_TOOLS)[keyof typeof INITIATIVE_ORCHESTRATION_TOOLS];

const INITIATIVE_ORCHESTRATION_TOOL_ERROR_CODES: Record<InitiativeOrchestrationToolName, string> = {
  'cloud:connect': 'CLOUD_CONNECT_ERROR',
  'workspace:init': 'WORKSPACE_INIT_ERROR',
  'initiative:add-wu': 'INITIATIVE_ADD_WU_ERROR',
  'initiative:bulk-assign': 'INITIATIVE_BULK_ASSIGN_ERROR',
  'initiative:create': 'INITIATIVE_CREATE_ERROR',
  'initiative:edit': 'INITIATIVE_EDIT_ERROR',
  'initiative:list': 'INITIATIVE_LIST_ERROR',
  'initiative:plan': 'INITIATIVE_PLAN_ERROR',
  'initiative:remove-wu': 'INITIATIVE_REMOVE_WU_ERROR',
  'initiative:status': 'INITIATIVE_STATUS_ERROR',
  'orchestrate:init-status': 'ORCHESTRATE_INIT_STATUS_ERROR',
  'orchestrate:initiative': 'ORCHESTRATE_INITIATIVE_ERROR',
  'orchestrate:monitor': 'ORCHESTRATE_MONITOR_ERROR',
  'plan:create': 'PLAN_CREATE_ERROR',
  'plan:edit': 'PLAN_EDIT_ERROR',
  'plan:link': 'PLAN_LINK_ERROR',
  'plan:promote': 'PLAN_PROMOTE_ERROR',
  'delegation:list': 'DELEGATION_LIST_ERROR',
  'docs:sync': 'DOCS_SYNC_ERROR',
  'init:plan': 'INIT_PLAN_ERROR',
  lumenflow: 'LUMENFLOW_INIT_ERROR',
  'lumenflow:doctor': 'LUMENFLOW_DOCTOR_ERROR',
  'lumenflow:integrate': 'LUMENFLOW_INTEGRATE_ERROR',
  'lumenflow:release': 'LUMENFLOW_RELEASE_ERROR',
  'lumenflow:upgrade': 'LUMENFLOW_UPGRADE_ERROR',
  'sync:templates': 'SYNC_TEMPLATES_ALIAS_ERROR',
};

const INITIATIVE_ORCHESTRATION_TOOL_COMMANDS: Record<
  InitiativeOrchestrationToolName,
  (typeof RUNTIME_CLI_COMMANDS)[keyof typeof RUNTIME_CLI_COMMANDS]
> = {
  'cloud:connect': RUNTIME_CLI_COMMANDS.INIT,
  'workspace:init': RUNTIME_CLI_COMMANDS.WORKSPACE_INIT,
  'initiative:add-wu': RUNTIME_CLI_COMMANDS.INITIATIVE_ADD_WU,
  'initiative:bulk-assign': RUNTIME_CLI_COMMANDS.INITIATIVE_BULK_ASSIGN,
  'initiative:create': RUNTIME_CLI_COMMANDS.INITIATIVE_CREATE,
  'initiative:edit': RUNTIME_CLI_COMMANDS.INITIATIVE_EDIT,
  'initiative:list': RUNTIME_CLI_COMMANDS.INITIATIVE_LIST,
  'initiative:plan': RUNTIME_CLI_COMMANDS.INITIATIVE_PLAN,
  'initiative:remove-wu': RUNTIME_CLI_COMMANDS.INITIATIVE_REMOVE_WU,
  'initiative:status': RUNTIME_CLI_COMMANDS.INITIATIVE_STATUS,
  'orchestrate:init-status': RUNTIME_CLI_COMMANDS.ORCHESTRATE_INIT_STATUS,
  'orchestrate:initiative': RUNTIME_CLI_COMMANDS.ORCHESTRATE_INITIATIVE,
  'orchestrate:monitor': RUNTIME_CLI_COMMANDS.ORCHESTRATE_MONITOR,
  'plan:create': RUNTIME_CLI_COMMANDS.PLAN_CREATE,
  'plan:edit': RUNTIME_CLI_COMMANDS.PLAN_EDIT,
  'plan:link': RUNTIME_CLI_COMMANDS.PLAN_LINK,
  'plan:promote': RUNTIME_CLI_COMMANDS.PLAN_PROMOTE,
  'delegation:list': RUNTIME_CLI_COMMANDS.DELEGATION_LIST,
  'docs:sync': RUNTIME_CLI_COMMANDS.DOCS_SYNC,
  'init:plan': RUNTIME_CLI_COMMANDS.INITIATIVE_PLAN,
  lumenflow: RUNTIME_CLI_COMMANDS.INIT,
  'lumenflow:doctor': RUNTIME_CLI_COMMANDS.LUMENFLOW_DOCTOR,
  'lumenflow:integrate': RUNTIME_CLI_COMMANDS.INTEGRATE,
  'lumenflow:release': RUNTIME_CLI_COMMANDS.RELEASE,
  'lumenflow:upgrade': RUNTIME_CLI_COMMANDS.LUMENFLOW_UPGRADE,
  'sync:templates': RUNTIME_CLI_COMMANDS.SYNC_TEMPLATES,
};

const FLAG_NAMES = {
  ADD_LANE: '--add-lane',
  ADD_PHASE: '--add-phase',
  ADD_SUCCESS_METRIC: '--add-success-metric',
  APPEND: '--append',
  APPLY: '--apply',
  CHECKPOINT_PER_WAVE: '--checkpoint-per-wave',
  CLIENT: '--client',
  CONFIG: '--config',
  CONTENT: '--content',
  CREATE: '--create',
  CREATED: '--created',
  DESCRIPTION: '--description',
  DRY_RUN: '--dry-run',
  ENDPOINT: '--endpoint',
  FORCE: '--force',
  FORMAT: '--format',
  FRAMEWORK: '--framework',
  FULL: '--full',
  ID: '--id',
  INITIATIVE: '--initiative',
  JSON: '--json',
  MERGE: '--merge',
  MINIMAL: '--minimal',
  NOTES: '--notes',
  ORG_ID: '--org-id',
  OUTPUT: '--output',
  PHASE: '--phase',
  PHASE_ID: '--phase-id',
  PHASE_STATUS: '--phase-status',
  PLAN: '--plan',
  POLICY_MODE: '--policy-mode',
  PRIORITY: '--priority',
  PROJECT_ID: '--project-id',
  PROGRESS: '--progress',
  RECOVER: '--recover',
  REMOVE_LANE: '--remove-lane',
  SECTION: '--section',
  SIGNALS_ONLY: '--signals-only',
  SINCE: '--since',
  SLUG: '--slug',
  STATUS: '--status',
  SYNC_INTERVAL: '--sync-interval',
  SYNC_FROM_INITIATIVE: '--sync-from-initiative',
  TARGET_DATE: '--target-date',
  THRESHOLD: '--threshold',
  TOKEN_ENV: '--token-env',
  TITLE: '--title',
  UNBLOCK: '--unblock',
  VENDOR: '--vendor',
  WU: '--wu',
  YES: '--yes',
} as const;

const CLOUD_CONNECT_SUBCOMMAND = 'cloud:connect';
const LUMENFLOW_DEFAULT_SUBCOMMAND = 'commands';

const MISSING_PARAMETER_MESSAGES = {
  CLIENT_REQUIRED: 'client is required',
  DELEGATION_TARGET_REQUIRED: 'Either wu or initiative is required',
  ENDPOINT_REQUIRED: 'endpoint is required',
  ID_REQUIRED: 'id is required',
  INITIATIVE_REQUIRED: 'initiative is required',
  ORG_ID_REQUIRED: 'org_id is required',
  PLAN_REQUIRED: 'plan is required',
  PROJECT_ID_REQUIRED: 'project_id is required',
  TITLE_REQUIRED: 'title is required',
  WU_REQUIRED: 'wu is required',
} as const;

interface CommandExecutionResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  executionError?: string;
}

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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== null);
}

function toIntegerString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function appendFlagIfTrue(args: string[], enabled: unknown, flagName: string): void {
  if (enabled === true) {
    args.push(flagName);
  }
}

function appendValueIfPresent(
  args: string[],
  flagName: string,
  value: unknown,
  converter: (value: unknown) => string | null = toStringValue,
): void {
  const converted = converter(value);
  if (converted) {
    args.push(flagName, converted);
  }
}

async function runInitiativeOrchestrationCommand(
  toolName: InitiativeOrchestrationToolName,
  args: string[],
): Promise<CommandExecutionResult> {
  return runtimeCliAdapter.run(INITIATIVE_ORCHESTRATION_TOOL_COMMANDS[toolName], args);
}

function createMissingParameterOutput(message: string): ToolOutput {
  return {
    success: false,
    error: {
      code: 'MISSING_PARAMETER',
      message,
    },
  };
}

function createFailureOutput(
  toolName: InitiativeOrchestrationToolName,
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
      code: INITIATIVE_ORCHESTRATION_TOOL_ERROR_CODES[toolName],
      message,
      details: {
        exit_code: execution.status,
        stdout: execution.stdout,
        stderr: execution.stderr,
      },
    },
  };
}

function parseJsonOutput(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function createSuccessOutput(
  toolName: InitiativeOrchestrationToolName,
  execution: CommandExecutionResult,
): ToolOutput {
  const parsedJson = parseJsonOutput(execution.stdout);
  if (parsedJson !== null) {
    return {
      success: true,
      data: parsedJson,
    };
  }

  const message = execution.stdout.trim().length > 0 ? execution.stdout.trim() : `${toolName} ran`;
  return {
    success: true,
    data: {
      message,
    },
  };
}

async function executeInitiativeOrchestrationTool(
  toolName: InitiativeOrchestrationToolName,
  args: string[],
): Promise<ToolOutput> {
  const execution = await runInitiativeOrchestrationCommand(toolName, args);
  if (!execution.ok) {
    return createFailureOutput(toolName, execution);
  }
  return createSuccessOutput(toolName, execution);
}

function requireId(parsed: Record<string, unknown>): string | null {
  const id = toStringValue(parsed.id);
  return id ?? null;
}

function requireInitiative(parsed: Record<string, unknown>): string | null {
  const initiative = toStringValue(parsed.initiative);
  return initiative ?? null;
}

function requireWu(parsed: Record<string, unknown>): string | null {
  const wu = toStringValue(parsed.wu);
  return wu ?? null;
}

function buildInitiativePlanArgs(parsed: Record<string, unknown>): string[] | null {
  const initiative = requireInitiative(parsed);
  if (!initiative) {
    return null;
  }
  const args = [FLAG_NAMES.INITIATIVE, initiative];
  appendValueIfPresent(args, FLAG_NAMES.PLAN, parsed.plan);
  appendFlagIfTrue(args, parsed.create, FLAG_NAMES.CREATE);
  return args;
}

export async function initiativeListTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendValueIfPresent(args, FLAG_NAMES.STATUS, parsed.status);
  appendValueIfPresent(args, FLAG_NAMES.FORMAT, parsed.format);
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_LIST, args);
}

export async function initiativeStatusTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = requireId(parsed);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }
  const args = [FLAG_NAMES.ID, id];
  appendValueIfPresent(args, FLAG_NAMES.FORMAT, parsed.format);
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_STATUS, args);
}

export async function initiativeCreateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = requireId(parsed);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }
  const title = toStringValue(parsed.title);
  if (!title) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.TITLE_REQUIRED);
  }

  const args = [FLAG_NAMES.ID, id];
  appendValueIfPresent(args, FLAG_NAMES.SLUG, parsed.slug);
  args.push(FLAG_NAMES.TITLE, title);
  appendValueIfPresent(args, FLAG_NAMES.PRIORITY, parsed.priority);
  appendValueIfPresent(args, '--owner', parsed.owner);
  appendValueIfPresent(args, FLAG_NAMES.TARGET_DATE, parsed.target_date);

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_CREATE, args);
}

export async function initiativeEditTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = requireId(parsed);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = [FLAG_NAMES.ID, id];
  appendValueIfPresent(args, FLAG_NAMES.DESCRIPTION, parsed.description);
  appendValueIfPresent(args, FLAG_NAMES.STATUS, parsed.status);
  appendValueIfPresent(args, '--blocked-by', parsed.blocked_by);
  appendValueIfPresent(args, '--blocked-reason', parsed.blocked_reason);
  appendFlagIfTrue(args, parsed.unblock, FLAG_NAMES.UNBLOCK);
  appendValueIfPresent(args, FLAG_NAMES.NOTES, parsed.notes);
  appendValueIfPresent(args, FLAG_NAMES.PHASE_ID, parsed.phase_id);
  appendValueIfPresent(args, FLAG_NAMES.PHASE_STATUS, parsed.phase_status);
  appendValueIfPresent(args, FLAG_NAMES.CREATED, parsed.created);

  for (const lane of toStringArray(parsed.add_lane)) {
    args.push(FLAG_NAMES.ADD_LANE, lane);
  }
  for (const lane of toStringArray(parsed.remove_lane)) {
    args.push(FLAG_NAMES.REMOVE_LANE, lane);
  }
  for (const phase of toStringArray(parsed.add_phase)) {
    args.push(FLAG_NAMES.ADD_PHASE, phase);
  }
  for (const metric of toStringArray(parsed.add_success_metric)) {
    args.push(FLAG_NAMES.ADD_SUCCESS_METRIC, metric);
  }

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_EDIT, args);
}

export async function initiativeAddWuTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const initiative = requireInitiative(parsed);
  if (!initiative) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.INITIATIVE_REQUIRED);
  }
  const wu = requireWu(parsed);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  const args = [FLAG_NAMES.INITIATIVE, initiative, FLAG_NAMES.WU, wu];
  appendValueIfPresent(args, FLAG_NAMES.PHASE, parsed.phase, toIntegerString);

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_ADD_WU, args);
}

export async function initiativeRemoveWuTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const initiative = requireInitiative(parsed);
  if (!initiative) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.INITIATIVE_REQUIRED);
  }
  const wu = requireWu(parsed);
  if (!wu) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.WU_REQUIRED);
  }

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_REMOVE_WU, [
    FLAG_NAMES.INITIATIVE,
    initiative,
    FLAG_NAMES.WU,
    wu,
  ]);
}

export async function initiativeBulkAssignTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendValueIfPresent(args, FLAG_NAMES.CONFIG, parsed.config);
  appendFlagIfTrue(args, parsed.apply, FLAG_NAMES.APPLY);
  appendValueIfPresent(args, FLAG_NAMES.SYNC_FROM_INITIATIVE, parsed.sync_from_initiative);

  return executeInitiativeOrchestrationTool(
    INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_BULK_ASSIGN,
    args,
  );
}

export async function initiativePlanTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args = buildInitiativePlanArgs(parsed);
  if (!args) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.INITIATIVE_REQUIRED);
  }
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INITIATIVE_PLAN, args);
}

export async function initPlanTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args = buildInitiativePlanArgs(parsed);
  if (!args) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.INITIATIVE_REQUIRED);
  }
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.INIT_PLAN, args);
}

export async function orchestrateInitStatusTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const initiative = requireInitiative(parsed);
  if (!initiative) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.INITIATIVE_REQUIRED);
  }
  return executeInitiativeOrchestrationTool(
    INITIATIVE_ORCHESTRATION_TOOLS.ORCHESTRATE_INIT_STATUS,
    [FLAG_NAMES.INITIATIVE, initiative],
  );
}

export async function orchestrateInitiativeTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const initiative = requireInitiative(parsed);
  if (!initiative) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.INITIATIVE_REQUIRED);
  }

  const args = [FLAG_NAMES.INITIATIVE, initiative];
  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendFlagIfTrue(args, parsed.progress, FLAG_NAMES.PROGRESS);
  appendFlagIfTrue(args, parsed.checkpoint_per_wave, FLAG_NAMES.CHECKPOINT_PER_WAVE);

  return executeInitiativeOrchestrationTool(
    INITIATIVE_ORCHESTRATION_TOOLS.ORCHESTRATE_INITIATIVE,
    args,
  );
}

export async function orchestrateMonitorTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendValueIfPresent(args, FLAG_NAMES.THRESHOLD, parsed.threshold, toIntegerString);
  appendFlagIfTrue(args, parsed.recover, FLAG_NAMES.RECOVER);
  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendValueIfPresent(args, FLAG_NAMES.SINCE, parsed.since);
  appendValueIfPresent(args, FLAG_NAMES.WU, parsed.wu);
  appendFlagIfTrue(args, parsed.signals_only, FLAG_NAMES.SIGNALS_ONLY);

  return executeInitiativeOrchestrationTool(
    INITIATIVE_ORCHESTRATION_TOOLS.ORCHESTRATE_MONITOR,
    args,
  );
}

export async function planCreateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = requireId(parsed);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }
  const title = toStringValue(parsed.title);
  if (!title) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.TITLE_REQUIRED);
  }

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.PLAN_CREATE, [
    FLAG_NAMES.ID,
    id,
    FLAG_NAMES.TITLE,
    title,
  ]);
}

export async function planEditTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = requireId(parsed);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = [FLAG_NAMES.ID, id];
  appendValueIfPresent(args, FLAG_NAMES.SECTION, parsed.section);
  appendValueIfPresent(args, FLAG_NAMES.CONTENT, parsed.content);
  appendValueIfPresent(args, FLAG_NAMES.APPEND, parsed.append);

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.PLAN_EDIT, args);
}

export async function planLinkTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = requireId(parsed);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }
  const plan = toStringValue(parsed.plan);
  if (!plan) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.PLAN_REQUIRED);
  }

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.PLAN_LINK, [
    FLAG_NAMES.ID,
    id,
    FLAG_NAMES.PLAN,
    plan,
  ]);
}

export async function planPromoteTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const id = requireId(parsed);
  if (!id) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ID_REQUIRED);
  }

  const args = [FLAG_NAMES.ID, id];
  appendFlagIfTrue(args, parsed.force, FLAG_NAMES.FORCE);

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.PLAN_PROMOTE, args);
}

export async function delegationListTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const wu = requireWu(parsed);
  const initiative = requireInitiative(parsed);
  if (!wu && !initiative) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.DELEGATION_TARGET_REQUIRED);
  }

  const args: string[] = [];
  if (wu) {
    args.push(FLAG_NAMES.WU, wu);
  }
  if (initiative) {
    args.push(FLAG_NAMES.INITIATIVE, initiative);
  }
  appendFlagIfTrue(args, parsed.json, FLAG_NAMES.JSON);

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.DELEGATION_LIST, args);
}

export async function docsSyncTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendValueIfPresent(args, FLAG_NAMES.VENDOR, parsed.vendor);
  appendFlagIfTrue(args, parsed.force, FLAG_NAMES.FORCE);
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.DOCS_SYNC, args);
}

export async function cloudConnectTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const endpoint = toStringValue(parsed.endpoint);
  if (!endpoint) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ENDPOINT_REQUIRED);
  }
  const orgId = toStringValue(parsed.org_id);
  if (!orgId) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.ORG_ID_REQUIRED);
  }
  const projectId = toStringValue(parsed.project_id);
  if (!projectId) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.PROJECT_ID_REQUIRED);
  }

  const args = [
    CLOUD_CONNECT_SUBCOMMAND,
    FLAG_NAMES.ENDPOINT,
    endpoint,
    FLAG_NAMES.ORG_ID,
    orgId,
    FLAG_NAMES.PROJECT_ID,
    projectId,
  ];
  appendValueIfPresent(args, FLAG_NAMES.TOKEN_ENV, parsed.token_env);
  appendValueIfPresent(args, FLAG_NAMES.POLICY_MODE, parsed.policy_mode);
  appendValueIfPresent(args, FLAG_NAMES.SYNC_INTERVAL, parsed.sync_interval, toIntegerString);
  appendValueIfPresent(args, FLAG_NAMES.OUTPUT, parsed.output);
  appendFlagIfTrue(args, parsed.force, FLAG_NAMES.FORCE);

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.CLOUD_CONNECT, args);
}

export async function workspaceInitTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendFlagIfTrue(args, parsed.yes, FLAG_NAMES.YES);
  appendValueIfPresent(args, FLAG_NAMES.OUTPUT, parsed.output);
  appendFlagIfTrue(args, parsed.force, FLAG_NAMES.FORCE);

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.WORKSPACE_INIT, args);
}

export async function lumenflowTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendValueIfPresent(args, FLAG_NAMES.CLIENT, parsed.client);
  appendFlagIfTrue(args, parsed.merge, FLAG_NAMES.MERGE);
  appendFlagIfTrue(args, parsed.full, FLAG_NAMES.FULL);
  appendFlagIfTrue(args, parsed.minimal, FLAG_NAMES.MINIMAL);
  appendValueIfPresent(args, FLAG_NAMES.FRAMEWORK, parsed.framework);
  if (args.length === 0) {
    args.push(LUMENFLOW_DEFAULT_SUBCOMMAND);
  }

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.LUMENFLOW, args);
}

export async function lumenflowDoctorTool(_input: unknown): Promise<ToolOutput> {
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.LUMENFLOW_DOCTOR, []);
}

export async function lumenflowIntegrateTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const client = toStringValue(parsed.client);
  if (!client) {
    return createMissingParameterOutput(MISSING_PARAMETER_MESSAGES.CLIENT_REQUIRED);
  }

  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.LUMENFLOW_INTEGRATE, [
    FLAG_NAMES.CLIENT,
    client,
  ]);
}

export async function lumenflowReleaseTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.LUMENFLOW_RELEASE, args);
}

export async function lumenflowUpgradeTool(_input: unknown): Promise<ToolOutput> {
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.LUMENFLOW_UPGRADE, []);
}

export async function syncTemplatesTool(input: unknown): Promise<ToolOutput> {
  const parsed = toRecord(input);
  const args: string[] = [];
  appendFlagIfTrue(args, parsed.dry_run, FLAG_NAMES.DRY_RUN);
  appendFlagIfTrue(args, parsed.verbose, '--verbose');
  appendFlagIfTrue(args, parsed.check_drift, '--check-drift');
  return executeInitiativeOrchestrationTool(INITIATIVE_ORCHESTRATION_TOOLS.SYNC_TEMPLATES, args);
}
