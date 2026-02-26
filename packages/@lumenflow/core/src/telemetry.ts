#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telemetry Module - DORA/SPACE Metrics Emission
 *
 * Emits structured NDJSON telemetry for gates execution and WU flow metrics.
 * Used by gates-local.ts and flow-report.ts.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import YAML from 'yaml';
import { LUMENFLOW_PATHS, FILE_EXTENSIONS, STDIO, STRING_LITERALS } from './wu-constants.js';
import { WORKSPACE_CONFIG_FILE_NAME } from './config-contract.js';
import { createError, ErrorCodes } from './error-handler.js';

/** Gate event telemetry data */
interface GateEventData {
  wu_id?: string | null;
  lane?: string | null;
  gate_name: string;
  passed: boolean;
  duration_ms: number;
}

/** LLM classification start data */
interface LLMClassificationStartData {
  classification_type: string;
  has_context?: boolean;
  wu_id?: string;
  lane?: string;
}

/** LLM classification complete data */
interface LLMClassificationCompleteData {
  classification_type: string;
  duration_ms: number;
  tokens_used: number;
  estimated_cost_usd: number;
  confidence: number;
  fallback_used: boolean;
  fallback_reason?: string;
  wu_id?: string;
  lane?: string;
}

/** LLM classification error data */
interface LLMClassificationErrorData {
  classification_type: string;
  error_type: string;
  error_message: string;
  duration_ms?: number;
  wu_id?: string;
  lane?: string;
  input_text_preview?: string;
}

/** WU flow event data */
interface WUFlowEventData {
  [key: string]: unknown;
}

const TELEMETRY_DIR = LUMENFLOW_PATHS.TELEMETRY;
const GATES_LOG = `${TELEMETRY_DIR}/gates${FILE_EXTENSIONS.NDJSON}`;
const LLM_CLASSIFICATION_LOG = `${TELEMETRY_DIR}/llm-classification${FILE_EXTENSIONS.NDJSON}`;
const FLOW_LOG = LUMENFLOW_PATHS.FLOW_LOG;
const WORKSPACE_FILE = WORKSPACE_CONFIG_FILE_NAME;
const CLOUD_SYNC_STATE_FILE = `${TELEMETRY_DIR}/cloud-sync-state${FILE_EXTENSIONS.JSON}`;
const CLOUD_SYNC_LOG_PREFIX = '[telemetry:cloud-sync]';
const PACK_KEY_SOFTWARE_DELIVERY = 'software_delivery';
const CONTROL_PLANE_FIELD = 'control_plane';
const CONTROL_PLANE_AUTH_FIELD = 'auth';
const CONTROL_PLANE_ENDPOINT_FIELD = 'endpoint';
const CONTROL_PLANE_SYNC_INTERVAL_FIELD = 'sync_interval';
const CONTROL_PLANE_BATCH_SIZE_FIELD = 'batch_size';
const CONTROL_PLANE_TIMEOUT_MS_FIELD = 'timeout_ms';
const CONTROL_PLANE_TOKEN_ENV_FIELD = 'token_env';
const WORKSPACE_ID_FIELD = 'id';
const HTTP = {
  METHOD_POST: 'POST',
  HEADER_AUTHORIZATION: 'authorization',
  HEADER_CONTENT_TYPE: 'content-type',
  CONTENT_TYPE_JSON: 'application/json',
} as const;
const CONTROL_PLANE_API_PATH = {
  TELEMETRY: '/api/v1/telemetry',
} as const;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const MS_PER_SECOND = 1000;
const ERROR_NAME = {
  ABORT: 'AbortError',
} as const;
const CONTROL_PLANE_TOKEN_ENV_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const METRIC_NAME = {
  GATES_DURATION_MS: 'gates.duration_ms',
  FLOW_EVENT: 'flow.event',
  RAW_GATES: 'telemetry.raw.gates',
  RAW_FLOW: 'telemetry.raw.flow',
} as const;
const TELEMETRY_SOURCE = {
  GATES: 'gates',
  FLOW: 'flow',
} as const;

type TelemetrySource = (typeof TELEMETRY_SOURCE)[keyof typeof TELEMETRY_SOURCE];

type PrimitiveTagValue = string | number | boolean;

type CloudTelemetryRecord = {
  metric: string;
  value: number;
  timestamp: string;
  tags?: Record<string, PrimitiveTagValue>;
};

interface ParsedTelemetryLine {
  readonly record: CloudTelemetryRecord | null;
  readonly offsetAfterLine: number;
}

interface CloudSyncConfig {
  readonly workspaceId: string;
  readonly endpoint: string;
  readonly token: string;
  readonly syncIntervalMs: number;
  readonly batchSize: number;
  readonly timeoutMs: number;
}

type CloudSyncSkippedReason =
  | 'control-plane-unavailable'
  | 'sync-interval-not-elapsed'
  | 'sync-failed';

interface CloudSyncFileState {
  offset: number;
}

interface CloudSyncState {
  version: 1;
  lastSyncAtMs: number;
  files: {
    gates: CloudSyncFileState;
    flow: CloudSyncFileState;
  };
}

export interface TelemetryCloudSyncOptions {
  workspaceRoot?: string;
  logger?: Pick<Console, 'warn'>;
  fetchFn?: typeof fetch;
  now?: () => number;
  environment?: NodeJS.ProcessEnv;
}

export interface TelemetryCloudSyncResult {
  readonly recordsRead: number;
  readonly recordsSent: number;
  readonly malformedLines: number;
  readonly batchesAttempted: number;
  readonly batchesSucceeded: number;
  readonly skippedReason?: CloudSyncSkippedReason;
}

/**
 * Ensure telemetry directory exists
 */
function ensureTelemetryDir() {
  try {
    mkdirSync(TELEMETRY_DIR, { recursive: true });
  } catch {
    // Directory may already exist, ignore
  }
}

/**
 * Emit a telemetry event as NDJSON
 * @param {string} filePath - Path to NDJSON file
 * @param {object} event - Event data to emit
 */
export function emit(filePath: string, event: Record<string, unknown>) {
  ensureTelemetryDir();
  const line = `${JSON.stringify(event)}${STRING_LITERALS.NEWLINE}`;
  try {
    appendFileSync(filePath, line, { encoding: 'utf-8' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry] Failed to emit to ${filePath}:`, message);
  }
}

/**
 * Emit a gates execution event
 * @param {object} data - Gates event data
 * @param {string} data.wu_id - Work Unit ID (e.g., 'WU-402')
 * @param {string} data.lane - Lane name (e.g., 'Operations')
 * @param {string} data.gate_name - Gate name (e.g., 'format:check')
 * @param {boolean} data.passed - Whether gate passed
 * @param {number} data.duration_ms - Execution duration in milliseconds
 */
export function emitGateEvent(data: GateEventData) {
  const event = {
    timestamp: new Date().toISOString(),
    wu_id: data.wu_id || null,
    lane: data.lane || null,
    gate_name: data.gate_name,
    passed: data.passed,
    duration_ms: data.duration_ms,
  };
  emit(GATES_LOG, event);
}

/**
 * Get current WU ID from git branch or environment
 * @returns {string|null} WU ID or null
 */
export function getCurrentWU() {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: [STDIO.PIPE, STDIO.PIPE, STDIO.IGNORE],
    }).trim();

    // Extract WU ID from branch name (e.g., lane/operations/wu-402 -> WU-402)
    const match = branch.match(/wu-(\d+)/i);
    if (match) {
      return `WU-${match[1]}`.toUpperCase();
    }
  } catch {
    // Not in a git repo or command failed
  }
  return null;
}

/**
 * Get lane from git branch or environment
 * @returns {string|null} Lane name or null
 */
export function getCurrentLane() {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: [STDIO.PIPE, STDIO.PIPE, STDIO.IGNORE],
    }).trim();

    // Extract lane from branch name (e.g., lane/operations/wu-402 -> Operations)
    const match = branch.match(/^lane\/([^/]+)\//i);
    const laneSegment = match?.[1];
    if (laneSegment) {
      return laneSegment.charAt(0).toUpperCase() + laneSegment.slice(1).toLowerCase();
    }
  } catch {
    // Not in a git repo or command failed
  }
  return null;
}

/**
 * Emit LLM classification start event
 * @param {object} data - Classification start data
 * @param {string} data.classification_type - Type of classification (e.g., 'mode_detection', 'red_flag', 'sensitive_data_detection')
 * @param {boolean} [data.has_context] - Whether conversation context was provided
 * @param {string} [data.wu_id] - Work Unit ID
 * @param {string} [data.lane] - Lane name
 * @param {string} [logPath] - Optional log path override (for testing)
 */
export function emitLLMClassificationStart(
  data: LLMClassificationStartData,
  logPath = LLM_CLASSIFICATION_LOG,
) {
  const event = {
    timestamp: new Date().toISOString(),
    event_type: 'llm.classification.start',
    classification_type: data.classification_type,
    has_context: data.has_context ?? false,
    wu_id: data.wu_id || getCurrentWU(),
    lane: data.lane || getCurrentLane(),
  };
  emit(logPath, event);
}

/**
 * Emit LLM classification complete event
 * @param {object} data - Classification completion data
 * @param {string} data.classification_type - Type of classification
 * @param {number} data.duration_ms - Processing duration in milliseconds
 * @param {number} data.tokens_used - Total tokens consumed
 * @param {number} data.estimated_cost_usd - Estimated cost in USD
 * @param {number} data.confidence - Classification confidence score (0-1)
 * @param {boolean} data.fallback_used - Whether fallback (regex) was used
 * @param {string} [data.fallback_reason] - Reason fallback was triggered
 * @param {string} [data.wu_id] - Work Unit ID
 * @param {string} [data.lane] - Lane name
 * @param {string} [logPath] - Optional log path override (for testing)
 */
export function emitLLMClassificationComplete(
  data: LLMClassificationCompleteData,
  logPath = LLM_CLASSIFICATION_LOG,
) {
  // PII Protection: Explicitly exclude any user input fields
  const event: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event_type: 'llm.classification.complete',
    classification_type: data.classification_type,
    duration_ms: data.duration_ms,
    tokens_used: data.tokens_used,
    estimated_cost_usd: data.estimated_cost_usd,
    confidence: data.confidence,
    fallback_used: data.fallback_used,
    wu_id: data.wu_id || getCurrentWU(),
    lane: data.lane || getCurrentLane(),
  };

  // Add fallback_reason only if fallback was used
  if (data.fallback_used && data.fallback_reason) {
    event.fallback_reason = data.fallback_reason;
  }

  emit(logPath, event);
}

/**
 * Emit LLM classification error event
 * @param {object} data - Classification error data
 * @param {string} data.classification_type - Type of classification
 * @param {string} data.error_type - Error type (e.g., 'timeout', 'rate_limit', 'validation')
 * @param {string} data.error_message - Error message (must be PII-free)
 * @param {number} [data.duration_ms] - Duration before error occurred
 * @param {string} [data.wu_id] - Work Unit ID
 * @param {string} [data.lane] - Lane name
 * @param {string} [logPath] - Optional log path override (for testing)
 */
export function emitLLMClassificationError(
  data: LLMClassificationErrorData,
  logPath = LLM_CLASSIFICATION_LOG,
) {
  // PII Protection: Never log user input or sensitive data
  const event: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event_type: 'llm.classification.error',
    classification_type: data.classification_type,
    error_type: data.error_type,
    error_message: data.error_message, // Caller must ensure this is PII-free
    wu_id: data.wu_id || getCurrentWU(),
    lane: data.lane || getCurrentLane(),
  };

  if (data.duration_ms !== undefined) {
    event.duration_ms = data.duration_ms;
  }

  // Explicitly redact any input_text_preview to prevent PII leakage
  if (data.input_text_preview) {
    event.input_text_preview = '[REDACTED]';
  }

  emit(logPath, event);
}

/**
 * Emit WU flow telemetry event to .lumenflow/flow.log
 *
 * Used by wu-claim, wu-done, wu-unblock for workflow tracking.
 * Centralized from duplicated emitTelemetry() functions (WU-1256).
 *
 * @param {object} event - Event data (script, wu_id, lane, step, etc.)
 * @param {string} [logPath] - Optional log path override (for testing)
 */
export function emitWUFlowEvent(event: WUFlowEventData, logPath = FLOW_LOG) {
  const logDir = path.dirname(logPath);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
  try {
    appendFileSync(logPath, `${line}${STRING_LITERALS.NEWLINE}`, { encoding: 'utf-8' });
  } catch (err) {
    // Silently fail - telemetry should not block workflow
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry] Failed to emit flow event: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// eslint-disable-next-line sonarjs/function-return-type -- tag values intentionally preserve primitive type fidelity
function asPrimitiveTagValue(value: unknown): PrimitiveTagValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, endpoint.length - 1) : endpoint;
}

function normalizeTimestamp(value: unknown, fallbackIso: string): string {
  const rawTimestamp = asNonEmptyString(value);
  return rawTimestamp ?? fallbackIso;
}

function warnCloudSync(logger: Pick<Console, 'warn'> | undefined, message: string): void {
  logger?.warn?.(`${CLOUD_SYNC_LOG_PREFIX} ${message}`);
}

function createDefaultCloudSyncState(): CloudSyncState {
  return {
    version: 1,
    lastSyncAtMs: 0,
    files: {
      gates: {
        offset: 0,
      },
      flow: {
        offset: 0,
      },
    },
  };
}

function normalizeStateOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

function loadCloudSyncState(statePath: string): CloudSyncState {
  if (!existsSync(statePath)) {
    return createDefaultCloudSyncState();
  }

  try {
    const raw = readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return createDefaultCloudSyncState();
    }

    const filesRaw = Reflect.get(parsed, 'files');
    const gatesRaw = isRecord(filesRaw) ? Reflect.get(filesRaw, TELEMETRY_SOURCE.GATES) : undefined;
    const flowRaw = isRecord(filesRaw) ? Reflect.get(filesRaw, TELEMETRY_SOURCE.FLOW) : undefined;
    const gatesOffset = isRecord(gatesRaw)
      ? normalizeStateOffset(Reflect.get(gatesRaw, 'offset'))
      : 0;
    const flowOffset = isRecord(flowRaw) ? normalizeStateOffset(Reflect.get(flowRaw, 'offset')) : 0;
    const lastSyncAtMs = normalizeStateOffset(Reflect.get(parsed, 'lastSyncAtMs'));

    return {
      version: 1,
      lastSyncAtMs,
      files: {
        gates: {
          offset: gatesOffset,
        },
        flow: {
          offset: flowOffset,
        },
      },
    };
  } catch {
    return createDefaultCloudSyncState();
  }
}

function saveCloudSyncState(statePath: string, state: CloudSyncState): void {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}${STRING_LITERALS.NEWLINE}`, {
    encoding: 'utf-8',
  });
}

function getSourceOffset(state: CloudSyncState, source: TelemetrySource): number {
  if (source === TELEMETRY_SOURCE.GATES) {
    return state.files.gates.offset;
  }
  return state.files.flow.offset;
}

function setSourceOffset(state: CloudSyncState, source: TelemetrySource, offset: number): void {
  if (source === TELEMETRY_SOURCE.GATES) {
    state.files.gates.offset = offset;
    return;
  }
  state.files.flow.offset = offset;
}

function resolveTelemetryPath(workspaceRoot: string, source: TelemetrySource): string {
  if (source === TELEMETRY_SOURCE.GATES) {
    return path.join(workspaceRoot, GATES_LOG);
  }
  return path.join(workspaceRoot, FLOW_LOG);
}

function mapGatesEventToTelemetryRecord(
  payload: Record<string, unknown>,
  fallbackIso: string,
): CloudTelemetryRecord {
  const gateName = asNonEmptyString(Reflect.get(payload, 'gate_name')) ?? 'unknown';
  const passedRaw = Reflect.get(payload, 'passed');
  const passed = typeof passedRaw === 'boolean' ? passedRaw : false;
  const durationMs = asFiniteNumber(Reflect.get(payload, 'duration_ms')) ?? 0;
  const wuId = asPrimitiveTagValue(Reflect.get(payload, 'wu_id'));
  const lane = asPrimitiveTagValue(Reflect.get(payload, 'lane'));
  const tags: Record<string, PrimitiveTagValue> = {
    source: TELEMETRY_SOURCE.GATES,
    gate_name: gateName,
    passed,
  };

  if (wuId !== undefined) {
    tags.wu_id = wuId;
  }
  if (lane !== undefined) {
    tags.lane = lane;
  }

  return {
    metric: METRIC_NAME.GATES_DURATION_MS,
    value: durationMs,
    timestamp: normalizeTimestamp(Reflect.get(payload, 'timestamp'), fallbackIso),
    tags,
  };
}

function mapFlowEventToTelemetryRecord(
  payload: Record<string, unknown>,
  fallbackIso: string,
): CloudTelemetryRecord {
  const script = asNonEmptyString(Reflect.get(payload, 'script')) ?? 'unknown';
  const step =
    asNonEmptyString(Reflect.get(payload, 'step')) ??
    asNonEmptyString(Reflect.get(payload, 'event_type')) ??
    'event';
  const value = asFiniteNumber(Reflect.get(payload, 'duration_ms')) ?? 1;
  const status = asPrimitiveTagValue(Reflect.get(payload, 'status'));
  const wuId = asPrimitiveTagValue(Reflect.get(payload, 'wu_id'));
  const lane = asPrimitiveTagValue(Reflect.get(payload, 'lane'));
  const tags: Record<string, PrimitiveTagValue> = {
    source: TELEMETRY_SOURCE.FLOW,
    script,
    step,
  };

  if (status !== undefined) {
    tags.status = status;
  }
  if (wuId !== undefined) {
    tags.wu_id = wuId;
  }
  if (lane !== undefined) {
    tags.lane = lane;
  }

  return {
    metric: METRIC_NAME.FLOW_EVENT,
    value,
    timestamp: normalizeTimestamp(Reflect.get(payload, 'timestamp'), fallbackIso),
    tags,
  };
}

function mapTelemetryLineToRecord(
  source: TelemetrySource,
  payload: unknown,
  fallbackIso: string,
): CloudTelemetryRecord {
  if (!isRecord(payload)) {
    return {
      metric: source === TELEMETRY_SOURCE.GATES ? METRIC_NAME.RAW_GATES : METRIC_NAME.RAW_FLOW,
      value: 1,
      timestamp: fallbackIso,
      tags: {
        source,
      },
    };
  }

  if (source === TELEMETRY_SOURCE.GATES) {
    return mapGatesEventToTelemetryRecord(payload, fallbackIso);
  }
  return mapFlowEventToTelemetryRecord(payload, fallbackIso);
}

function readTelemetryLinesFromOffset(input: {
  filePath: string;
  source: TelemetrySource;
  initialOffset: number;
  logger?: Pick<Console, 'warn'>;
  fallbackIso: string;
}): {
  items: ParsedTelemetryLine[];
  malformedLines: number;
  effectiveOffset: number;
} {
  if (!existsSync(input.filePath)) {
    return {
      items: [],
      malformedLines: 0,
      effectiveOffset: 0,
    };
  }

  const fileBuffer = readFileSync(input.filePath);
  const fileSize = fileBuffer.byteLength;
  const effectiveOffset = Math.min(input.initialOffset, fileSize);
  const sliceBuffer = fileBuffer.subarray(effectiveOffset);
  const content = sliceBuffer.toString('utf-8');
  let malformedLines = 0;
  const items: ParsedTelemetryLine[] = [];
  let cursor = 0;
  let runningOffset = effectiveOffset;

  while (cursor < content.length) {
    const newlineIndex = content.indexOf(STRING_LITERALS.NEWLINE, cursor);
    if (newlineIndex < 0) {
      break;
    }

    const lineWithNewline = content.slice(cursor, newlineIndex + 1);
    runningOffset += Buffer.byteLength(lineWithNewline, 'utf8');
    const line = content.slice(cursor, newlineIndex).trim();
    cursor = newlineIndex + 1;

    if (line.length === 0) {
      items.push({
        record: null,
        offsetAfterLine: runningOffset,
      });
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      items.push({
        record: mapTelemetryLineToRecord(input.source, parsed, input.fallbackIso),
        offsetAfterLine: runningOffset,
      });
    } catch {
      malformedLines += 1;
      warnCloudSync(
        input.logger,
        `Skipping malformed NDJSON line in ${input.filePath} at offset ${runningOffset}.`,
      );
      items.push({
        record: null,
        offsetAfterLine: runningOffset,
      });
    }
  }

  return {
    items,
    malformedLines,
    effectiveOffset,
  };
}

function safeResponseText(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

async function pushTelemetryBatch(input: {
  endpoint: string;
  workspaceId: string;
  token: string;
  timeoutMs: number;
  records: CloudTelemetryRecord[];
  fetchFn: typeof fetch;
}): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetchFn(`${input.endpoint}${CONTROL_PLANE_API_PATH.TELEMETRY}`, {
      method: HTTP.METHOD_POST,
      headers: {
        [HTTP.HEADER_AUTHORIZATION]: `Bearer ${input.token}`,
        [HTTP.HEADER_CONTENT_TYPE]: HTTP.CONTENT_TYPE_JSON,
      },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        records: input.records,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await safeResponseText(response);
      const suffix = responseText.length > 0 ? `: ${responseText}` : '';
      throw createError(ErrorCodes.COMMAND_EXECUTION_FAILED, `HTTP ${response.status}${suffix}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === ERROR_NAME.ABORT) {
      throw createError(
        ErrorCodes.COMMAND_EXECUTION_FAILED,
        `request timed out after ${input.timeoutMs}ms`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Diagnostic warning for a config key found at the wrong nesting level */
export interface MisnestedControlPlaneWarning {
  /** Human-readable description of the misnesting */
  readonly message: string;
  /** The dotted path where the key was incorrectly found */
  readonly detectedPath: string;
  /** Remediation instruction with a specific CLI command */
  readonly remediation: string;
}

/**
 * Detect when `control_plane` is misnested under a pack block (e.g. `software_delivery`)
 * instead of being at the workspace root.
 *
 * Pure function: no I/O, no side effects. Suitable for direct unit testing.
 *
 * @param workspace - The parsed workspace.yaml as a plain record
 * @returns A diagnostic warning if misnesting is detected, otherwise null
 */
export function detectMisnestedControlPlane(
  workspace: Record<string, unknown>,
): MisnestedControlPlaneWarning | null {
  // If control_plane already exists at the root, it is correctly placed -- no warning needed
  const rootControlPlane = Reflect.get(workspace, CONTROL_PLANE_FIELD);
  if (isRecord(rootControlPlane)) {
    return null;
  }

  // Check if control_plane is misnested under software_delivery
  const softwareDelivery = Reflect.get(workspace, PACK_KEY_SOFTWARE_DELIVERY);
  if (!isRecord(softwareDelivery)) {
    return null;
  }

  const nestedControlPlane = Reflect.get(softwareDelivery, CONTROL_PLANE_FIELD);
  if (!isRecord(nestedControlPlane)) {
    return null;
  }

  const detectedPath = `${PACK_KEY_SOFTWARE_DELIVERY}.${CONTROL_PLANE_FIELD}`;

  return {
    message:
      `${CONTROL_PLANE_FIELD} is misnested under ${PACK_KEY_SOFTWARE_DELIVERY}. ` +
      `It must be a root-level key in workspace.yaml.`,
    detectedPath,
    remediation:
      `Move ${CONTROL_PLANE_FIELD} to the workspace root. ` +
      `Run: pnpm config:set --key control_plane.<sub-key> --value <value>`,
  };
}

function resolveCloudSyncConfig(input: {
  workspaceRoot: string;
  environment: NodeJS.ProcessEnv;
  logger?: Pick<Console, 'warn'>;
}): CloudSyncConfig | null {
  const workspacePath = path.join(input.workspaceRoot, WORKSPACE_FILE);
  if (!existsSync(workspacePath)) {
    return null;
  }

  let parsedWorkspace: unknown;
  try {
    parsedWorkspace = YAML.parse(readFileSync(workspacePath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnCloudSync(input.logger, `Unable to parse workspace config: ${message}`);
    return null;
  }

  if (!isRecord(parsedWorkspace)) {
    return null;
  }

  const workspaceId = asNonEmptyString(Reflect.get(parsedWorkspace, WORKSPACE_ID_FIELD));
  if (!workspaceId) {
    warnCloudSync(input.logger, 'Skipping sync: workspace id is missing in workspace.yaml.');
    return null;
  }

  const controlPlaneRaw = Reflect.get(parsedWorkspace, CONTROL_PLANE_FIELD);
  if (!isRecord(controlPlaneRaw)) {
    // Check for common misconfiguration: control_plane nested under a pack block
    const misnesting = detectMisnestedControlPlane(parsedWorkspace as Record<string, unknown>);
    if (misnesting) {
      warnCloudSync(input.logger, misnesting.message);
      warnCloudSync(input.logger, misnesting.remediation);
    }
    return null;
  }

  const endpoint = asNonEmptyString(Reflect.get(controlPlaneRaw, CONTROL_PLANE_ENDPOINT_FIELD));
  const syncIntervalSeconds = asPositiveInteger(
    Reflect.get(controlPlaneRaw, CONTROL_PLANE_SYNC_INTERVAL_FIELD),
  );
  const batchSize =
    asPositiveInteger(Reflect.get(controlPlaneRaw, CONTROL_PLANE_BATCH_SIZE_FIELD)) ??
    DEFAULT_BATCH_SIZE;
  const timeoutMs =
    asPositiveInteger(Reflect.get(controlPlaneRaw, CONTROL_PLANE_TIMEOUT_MS_FIELD)) ??
    DEFAULT_TIMEOUT_MS;

  if (!endpoint || !syncIntervalSeconds) {
    warnCloudSync(
      input.logger,
      'Skipping sync: control_plane endpoint and sync_interval must be configured.',
    );
    return null;
  }

  const authRaw = Reflect.get(controlPlaneRaw, CONTROL_PLANE_AUTH_FIELD);
  if (!isRecord(authRaw)) {
    warnCloudSync(input.logger, 'Skipping sync: control_plane.auth is missing.');
    return null;
  }

  const tokenEnv = asNonEmptyString(Reflect.get(authRaw, CONTROL_PLANE_TOKEN_ENV_FIELD));
  if (!tokenEnv || !CONTROL_PLANE_TOKEN_ENV_PATTERN.test(tokenEnv)) {
    warnCloudSync(input.logger, 'Skipping sync: control_plane.auth.token_env is invalid.');
    return null;
  }

  const tokenValue = input.environment[tokenEnv];
  const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
  if (token.length === 0) {
    warnCloudSync(input.logger, `Skipping sync: missing cloud auth token in env "${tokenEnv}".`);
    return null;
  }

  try {
    void new URL(endpoint);
  } catch {
    warnCloudSync(input.logger, `Skipping sync: invalid control_plane endpoint "${endpoint}".`);
    return null;
  }

  return {
    workspaceId,
    endpoint: normalizeEndpoint(endpoint),
    token,
    syncIntervalMs: syncIntervalSeconds * MS_PER_SECOND,
    batchSize,
    timeoutMs,
  };
}

export async function syncNdjsonTelemetryToCloud(
  options: TelemetryCloudSyncOptions = {},
): Promise<TelemetryCloudSyncResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const logger = options.logger;
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const environment = options.environment ?? process.env;
  const statePath = path.join(workspaceRoot, CLOUD_SYNC_STATE_FILE);
  const config = resolveCloudSyncConfig({
    workspaceRoot,
    environment,
    logger,
  });

  if (config === null) {
    return {
      recordsRead: 0,
      recordsSent: 0,
      malformedLines: 0,
      batchesAttempted: 0,
      batchesSucceeded: 0,
      skippedReason: 'control-plane-unavailable',
    };
  }

  const state = loadCloudSyncState(statePath);
  const nowMs = now();

  if (state.lastSyncAtMs > 0 && nowMs - state.lastSyncAtMs < config.syncIntervalMs) {
    return {
      recordsRead: 0,
      recordsSent: 0,
      malformedLines: 0,
      batchesAttempted: 0,
      batchesSucceeded: 0,
      skippedReason: 'sync-interval-not-elapsed',
    };
  }

  const fallbackIso = new Date(nowMs).toISOString();
  const nextState: CloudSyncState = {
    version: 1,
    lastSyncAtMs: state.lastSyncAtMs,
    files: {
      gates: { offset: state.files.gates.offset },
      flow: { offset: state.files.flow.offset },
    },
  };

  let malformedLines = 0;
  let recordsRead = 0;
  let recordsSent = 0;
  let batchesAttempted = 0;
  let batchesSucceeded = 0;
  let syncFailed = false;
  let stateChanged = false;

  for (const source of [TELEMETRY_SOURCE.GATES, TELEMETRY_SOURCE.FLOW] as const) {
    const filePath = resolveTelemetryPath(workspaceRoot, source);
    const sourceLines = readTelemetryLinesFromOffset({
      filePath,
      source,
      initialOffset: getSourceOffset(nextState, source),
      logger,
      fallbackIso,
    });

    malformedLines += sourceLines.malformedLines;
    let acknowledgedOffset = sourceLines.effectiveOffset;
    let index = 0;

    while (index < sourceLines.items.length) {
      const currentLine = sourceLines.items[index];

      if (currentLine?.record === null) {
        acknowledgedOffset = currentLine.offsetAfterLine;
        stateChanged = true;
        index += 1;
        continue;
      }

      const batch: CloudTelemetryRecord[] = [];
      let lastBatchOffset = acknowledgedOffset;

      while (
        index < sourceLines.items.length &&
        sourceLines.items[index]?.record !== null &&
        batch.length < config.batchSize
      ) {
        const line = sourceLines.items[index];
        if (!line || line.record === null) {
          break;
        }
        batch.push(line.record);
        lastBatchOffset = line.offsetAfterLine;
        index += 1;
      }

      recordsRead += batch.length;
      batchesAttempted += 1;

      try {
        await pushTelemetryBatch({
          endpoint: config.endpoint,
          workspaceId: config.workspaceId,
          token: config.token,
          timeoutMs: config.timeoutMs,
          records: batch,
          fetchFn,
        });
        recordsSent += batch.length;
        batchesSucceeded += 1;
        acknowledgedOffset = lastBatchOffset;
        stateChanged = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnCloudSync(logger, `Telemetry sync failed: ${message}`);
        syncFailed = true;
        break;
      }
    }

    setSourceOffset(nextState, source, acknowledgedOffset);
    if (syncFailed) {
      break;
    }
  }

  if (stateChanged) {
    if (!syncFailed) {
      nextState.lastSyncAtMs = nowMs;
    }
    saveCloudSyncState(statePath, nextState);
  } else if (!syncFailed) {
    nextState.lastSyncAtMs = nowMs;
    saveCloudSyncState(statePath, nextState);
  }

  return {
    recordsRead,
    recordsSent,
    malformedLines,
    batchesAttempted,
    batchesSucceeded,
    ...(syncFailed ? { skippedReason: 'sync-failed' as const } : {}),
  };
}
