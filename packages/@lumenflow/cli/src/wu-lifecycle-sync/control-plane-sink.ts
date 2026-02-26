// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { getErrorMessage } from '@lumenflow/core/error-handler';
import { CONFIG_FILES } from '@lumenflow/core/wu-constants';
import type { KernelEvent } from '@lumenflow/kernel';
import {
  WU_LIFECYCLE_SYNC_CONFIG,
  WU_LIFECYCLE_SYNC_LOG_PREFIX,
  WU_LIFECYCLE_SYNC_RESULT_DEFAULTS,
  WU_LIFECYCLE_SYNC_SKIPPED_REASONS,
} from './constants.js';
import { createNoopSink } from './noop-sink.js';
import type {
  WuLifecycleEventSink,
  WuLifecycleSyncResult,
  WuLifecycleSyncSkippedReason,
} from './port.js';

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

function createNoopSyncResult(skippedReason: WuLifecycleSyncSkippedReason): WuLifecycleSyncResult {
  return {
    sent: WU_LIFECYCLE_SYNC_RESULT_DEFAULTS.SENT,
    accepted: WU_LIFECYCLE_SYNC_RESULT_DEFAULTS.ACCEPTED,
    skippedReason,
  };
}

function createParseInput(workspaceId: string, controlPlaneRaw: Record<string, unknown>) {
  return {
    [WU_LIFECYCLE_SYNC_CONFIG.WORKSPACE_ID_FIELD]: workspaceId,
    [WU_LIFECYCLE_SYNC_CONFIG.CONTROL_PLANE_FIELD]: controlPlaneRaw,
  } as { id: string; control_plane: Record<string, unknown> };
}

type ControlPlaneSdkModule = typeof import('@lumenflow/control-plane-sdk');

async function loadControlPlaneSdk(
  logger?: Pick<Console, 'warn'>,
): Promise<ControlPlaneSdkModule | null> {
  try {
    return await import('@lumenflow/control-plane-sdk');
  } catch (error) {
    logger?.warn?.(
      `${WU_LIFECYCLE_SYNC_LOG_PREFIX} control-plane SDK unavailable: ${getErrorMessage(error)}`,
    );
    return null;
  }
}

export interface ResolveWuLifecycleEventSinkOptions {
  workspaceRoot?: string;
  logger?: Pick<Console, 'warn'>;
  fetchFn?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export async function resolveWuLifecycleEventSink(
  options: ResolveWuLifecycleEventSinkOptions = {},
): Promise<WuLifecycleEventSink> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const workspacePath = path.join(workspaceRoot, CONFIG_FILES.WORKSPACE_CONFIG);

  let workspaceContent: string;
  try {
    workspaceContent = await readFile(workspacePath, WU_LIFECYCLE_SYNC_CONFIG.TEXT_ENCODING_UTF8);
  } catch {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.WORKSPACE_CONFIG_MISSING);
  }

  let parsedWorkspace: unknown;
  try {
    parsedWorkspace = YAML.parse(workspaceContent);
  } catch {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.WORKSPACE_CONFIG_INVALID);
  }

  if (!isRecord(parsedWorkspace)) {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.WORKSPACE_CONFIG_INVALID);
  }

  const workspaceId = asNonEmptyString(
    Reflect.get(parsedWorkspace, WU_LIFECYCLE_SYNC_CONFIG.WORKSPACE_ID_FIELD),
  );
  if (!workspaceId) {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.WORKSPACE_ID_MISSING);
  }

  const controlPlaneRaw = Reflect.get(
    parsedWorkspace,
    WU_LIFECYCLE_SYNC_CONFIG.CONTROL_PLANE_FIELD,
  );
  if (!isRecord(controlPlaneRaw)) {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.CONTROL_PLANE_NOT_CONFIGURED);
  }

  const controlPlaneSdk = await loadControlPlaneSdk(options.logger);
  if (!controlPlaneSdk) {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.CONTROL_PLANE_SDK_UNAVAILABLE);
  }

  const { parseWorkspaceControlPlaneConfig, createHttpControlPlaneSyncPort } = controlPlaneSdk;

  let runtimeConfig;
  try {
    runtimeConfig = parseWorkspaceControlPlaneConfig(
      createParseInput(workspaceId, controlPlaneRaw),
    );
  } catch {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.CONTROL_PLANE_INVALID);
  }

  const environment = options.environment ?? process.env;
  const tokenEnv = runtimeConfig.control_plane.auth.token_env;
  const token = asNonEmptyString(environment[tokenEnv]);
  if (!token) {
    return createNoopSink(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.MISSING_TOKEN_ENV);
  }

  const syncPort = createHttpControlPlaneSyncPort(runtimeConfig.control_plane, options.logger, {
    fetchFn: options.fetchFn,
    environment,
    timeoutMs: options.timeoutMs,
  });

  return {
    async push(events: KernelEvent[]): Promise<WuLifecycleSyncResult> {
      if (events.length === 0) {
        return createNoopSyncResult(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.NO_EVENTS);
      }

      try {
        const result = await syncPort.pushKernelEvents({
          workspace_id: workspaceId,
          events,
        });
        return {
          sent: result.accepted > 0,
          accepted: result.accepted,
          ...(result.accepted > 0
            ? {}
            : {
                skippedReason: WU_LIFECYCLE_SYNC_SKIPPED_REASONS.NO_EVENTS_ACCEPTED,
              }),
        };
      } catch (error) {
        options.logger?.warn?.(
          `${WU_LIFECYCLE_SYNC_LOG_PREFIX} pushKernelEvents failed: ${getErrorMessage(error)}`,
        );
        return createNoopSyncResult(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.PUSH_FAILED);
      }
    },
  };
}
