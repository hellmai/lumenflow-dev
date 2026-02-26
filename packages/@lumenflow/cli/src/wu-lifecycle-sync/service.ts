// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createError, ErrorCodes, getErrorMessage } from '@lumenflow/core/error-handler';
import type { KernelEvent } from '@lumenflow/kernel';
import {
  resolveWuLifecycleEventSink,
  type ResolveWuLifecycleEventSinkOptions,
} from './control-plane-sink.js';
import {
  WU_LIFECYCLE_CLAIM_DEFAULTS,
  WU_LIFECYCLE_COMMANDS,
  WU_LIFECYCLE_EVENT_KINDS,
  WU_LIFECYCLE_EVENT_SCHEMA_VERSION,
  WU_LIFECYCLE_SPEC_HASH,
  WU_LIFECYCLE_SYNC_CONFIG,
  WU_LIFECYCLE_SYNC_LOG_PREFIX,
  WU_LIFECYCLE_SYNC_RESULT_DEFAULTS,
  WU_LIFECYCLE_SYNC_SKIPPED_REASONS,
  type WuLifecycleCommand,
} from './constants.js';
import type { WuLifecycleEventSink, WuLifecycleSyncResult } from './port.js';

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createSha256Hex(input: string): string {
  return createHash(WU_LIFECYCLE_SPEC_HASH.ALGORITHM)
    .update(input)
    .digest(WU_LIFECYCLE_SPEC_HASH.DIGEST_ENCODING);
}

function resolveSpecHash(input: FlushWuLifecycleSyncInput): string {
  const explicitSpecHash = asNonEmptyString(input.specHash);
  if (explicitSpecHash && WU_LIFECYCLE_SPEC_HASH.HEX_256_REGEX.test(explicitSpecHash)) {
    return explicitSpecHash;
  }

  const specPath = asNonEmptyString(input.specPath);
  if (specPath) {
    try {
      const fileContent = readFileSync(specPath, WU_LIFECYCLE_SYNC_CONFIG.TEXT_ENCODING_UTF8);
      return createSha256Hex(fileContent);
    } catch {
      // Fall back to deterministic hash from WU metadata.
    }
  }

  return createSha256Hex(`${WU_LIFECYCLE_COMMANDS.CREATE}:${input.wuId}`);
}

function resolveTimestamp(input: FlushWuLifecycleSyncInput): string {
  return input.timestamp ?? new Date().toISOString();
}

export interface FlushWuLifecycleSyncInput {
  command: WuLifecycleCommand;
  wuId: string;
  timestamp?: string;
  by?: string;
  sessionId?: string;
  evidenceRefs?: string[];
  specHash?: string;
  specPath?: string;
}

export interface FlushWuLifecycleSyncOptions extends ResolveWuLifecycleEventSinkOptions {
  sink?: WuLifecycleEventSink;
}

export function buildWuLifecycleKernelEvent(input: FlushWuLifecycleSyncInput): KernelEvent {
  const timestamp = resolveTimestamp(input);

  switch (input.command) {
    case WU_LIFECYCLE_COMMANDS.CREATE:
      return {
        schema_version: WU_LIFECYCLE_EVENT_SCHEMA_VERSION,
        kind: WU_LIFECYCLE_EVENT_KINDS.CREATE,
        task_id: input.wuId,
        timestamp,
        spec_hash: resolveSpecHash(input),
      };

    case WU_LIFECYCLE_COMMANDS.CLAIM:
      return {
        schema_version: WU_LIFECYCLE_EVENT_SCHEMA_VERSION,
        kind: WU_LIFECYCLE_EVENT_KINDS.CLAIM,
        task_id: input.wuId,
        timestamp,
        by: asNonEmptyString(input.by) ?? WU_LIFECYCLE_CLAIM_DEFAULTS.ACTOR,
        session_id: asNonEmptyString(input.sessionId) ?? WU_LIFECYCLE_CLAIM_DEFAULTS.SESSION_ID,
      };

    case WU_LIFECYCLE_COMMANDS.DONE:
      return {
        schema_version: WU_LIFECYCLE_EVENT_SCHEMA_VERSION,
        kind: WU_LIFECYCLE_EVENT_KINDS.DONE,
        task_id: input.wuId,
        timestamp,
        ...(input.evidenceRefs && input.evidenceRefs.length > 0
          ? { evidence_refs: input.evidenceRefs }
          : {}),
      };

    default: {
      const exhaustiveCheck: never = input.command;
      throw createError(
        ErrorCodes.INVALID_ARGUMENT,
        `Unsupported WU lifecycle command: ${exhaustiveCheck}`,
      );
    }
  }
}

export async function flushWuLifecycleSync(
  input: FlushWuLifecycleSyncInput,
  options: FlushWuLifecycleSyncOptions = {},
): Promise<WuLifecycleSyncResult> {
  const logger = options.logger;

  try {
    const sink = options.sink ?? (await resolveWuLifecycleEventSink(options));
    const event = buildWuLifecycleKernelEvent(input);
    return await sink.push([event]);
  } catch (error) {
    logger?.warn?.(`${WU_LIFECYCLE_SYNC_LOG_PREFIX} fail-open: ${getErrorMessage(error)}`);
    return {
      sent: WU_LIFECYCLE_SYNC_RESULT_DEFAULTS.SENT,
      accepted: WU_LIFECYCLE_SYNC_RESULT_DEFAULTS.ACCEPTED,
      skippedReason: WU_LIFECYCLE_SYNC_SKIPPED_REASONS.PUSH_FAILED,
    };
  }
}
