#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telemetry Module - DORA/SPACE Metrics Emission
 *
 * Emits structured NDJSON telemetry for gates execution and WU flow metrics.
 * Used by gates-local.ts and flow-report.ts.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { LUMENFLOW_PATHS, FILE_EXTENSIONS, STDIO, STRING_LITERALS } from './wu-constants.js';

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
