// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2224: Shared literals for WU lifecycle event sync.
 *
 * @module wu-lifecycle-sync/constants
 */

export const WU_LIFECYCLE_COMMANDS = {
  CREATE: 'wu:create',
  CLAIM: 'wu:claim',
  DONE: 'wu:done',
} as const;

export type WuLifecycleCommand = (typeof WU_LIFECYCLE_COMMANDS)[keyof typeof WU_LIFECYCLE_COMMANDS];

export const WU_LIFECYCLE_EVENT_KINDS = {
  CREATE: 'task_created',
  CLAIM: 'task_claimed',
  DONE: 'task_completed',
} as const;

export const WU_LIFECYCLE_SYNC_SKIPPED_REASONS = {
  WORKSPACE_CONFIG_MISSING: 'workspace-config-missing',
  WORKSPACE_CONFIG_INVALID: 'workspace-config-invalid',
  WORKSPACE_ID_MISSING: 'workspace-id-missing',
  CONTROL_PLANE_NOT_CONFIGURED: 'control-plane-not-configured',
  CONTROL_PLANE_INVALID: 'control-plane-invalid',
  CONTROL_PLANE_SDK_UNAVAILABLE: 'control-plane-sdk-unavailable',
  MISSING_TOKEN_ENV: 'missing-token-env',
  NO_EVENTS: 'no-events',
  NO_EVENTS_ACCEPTED: 'no-events-accepted',
  PUSH_FAILED: 'push-failed',
} as const;

export type WuLifecycleSyncSkippedReason =
  (typeof WU_LIFECYCLE_SYNC_SKIPPED_REASONS)[keyof typeof WU_LIFECYCLE_SYNC_SKIPPED_REASONS];

export const WU_LIFECYCLE_SYNC_RESULT_DEFAULTS = {
  SENT: false,
  ACCEPTED: 0,
} as const;

export const WU_LIFECYCLE_SYNC_CONFIG = {
  CONTROL_PLANE_FIELD: 'control_plane',
  WORKSPACE_ID_FIELD: 'id',
  TEXT_ENCODING_UTF8: 'utf-8',
} as const;

export const WU_LIFECYCLE_SYNC_LOG_PREFIX = '[wu-lifecycle-sync]';

export const WU_LIFECYCLE_EVENT_SCHEMA_VERSION = 1 as const;

export const WU_LIFECYCLE_CLAIM_DEFAULTS = {
  ACTOR: 'wu-claim-cli',
  SESSION_ID: 'wu-claim-session',
} as const;

export const WU_LIFECYCLE_SPEC_HASH = {
  ALGORITHM: 'sha256',
  DIGEST_ENCODING: 'hex',
  HEX_256_REGEX: /^[a-f0-9]{64}$/,
} as const;
