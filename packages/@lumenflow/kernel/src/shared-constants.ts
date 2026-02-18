// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

export const UTF8_ENCODING = 'utf8' as const;
export const BASE64_ENCODING = 'base64' as const;
export const SHA256_ALGORITHM = 'sha256' as const;
export const SHA256_HEX_LENGTH = 64 as const;
export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;
export const SHA256_INTEGRITY_PREFIX = 'sha256:' as const;
export const SHA256_INTEGRITY_REGEX = /^sha256:[a-f0-9]{64}$/;
export const WORKSPACE_FILE_NAME = 'workspace.yaml' as const;
export const PACKS_DIR_NAME = 'packs' as const;
export const PACK_MANIFEST_FILE_NAME = 'manifest.yaml' as const;
export const PACKAGES_DIR_NAME = 'packages' as const;
export const LUMENFLOW_SCOPE_NAME = '@lumenflow' as const;

export const LUMENFLOW_DIR_NAME = '.lumenflow' as const;
export const KERNEL_RUNTIME_ROOT_DIR_NAME = 'kernel' as const;
export const KERNEL_RUNTIME_TASKS_DIR_NAME = 'tasks' as const;
export const KERNEL_RUNTIME_EVENTS_DIR_NAME = 'events' as const;
export const KERNEL_RUNTIME_EVIDENCE_DIR_NAME = 'evidence' as const;
export const KERNEL_RUNTIME_EVENTS_FILE_NAME = 'events.jsonl' as const;
export const KERNEL_RUNTIME_EVENTS_LOCK_FILE_NAME = 'events.lock' as const;

export const RESERVED_FRAMEWORK_SCOPE_ROOT = LUMENFLOW_DIR_NAME;
export const RESERVED_FRAMEWORK_SCOPE_PREFIX = `${LUMENFLOW_DIR_NAME}/` as const;
export const RESERVED_FRAMEWORK_SCOPE_GLOB = `${LUMENFLOW_DIR_NAME}/**` as const;

export const DEFAULT_WORKSPACE_CONFIG_HASH = '0'.repeat(SHA256_HEX_LENGTH);
export const DEFAULT_KERNEL_RUNTIME_VERSION = 'kernel-dev' as const;

export const WORKSPACE_CONFIG_HASH_CONTEXT_KEYS = {
  WORKSPACE_FILE_MISSING: 'workspace_file_missing',
} as const;

export const EXECUTION_METADATA_KEYS = {
  WORKSPACE_ALLOWED_SCOPES: 'workspace_allowed_scopes',
  LANE_ALLOWED_SCOPES: 'lane_allowed_scopes',
  TASK_DECLARED_SCOPES: 'task_declared_scopes',
  WORKSPACE_CONFIG_HASH: 'workspace_config_hash',
  RUNTIME_VERSION: 'runtime_version',
  PACK_ID: 'pack_id',
  PACK_VERSION: 'pack_version',
  PACK_INTEGRITY: 'pack_integrity',
} as const;

export const KERNEL_POLICY_IDS = {
  ALLOW_ALL: 'kernel.policy.allow-all',
  RUNTIME_FALLBACK: 'kernel.policy.runtime-fallback',
  BUILTIN_DEFAULT: 'kernel.policy.builtin-default',
  PROC_EXEC_DEFAULT_DENY: 'kernel.policy.proc-exec-default-deny',
  SCOPE_RESERVED_PATH: 'kernel.scope.reserved-path',
  SCOPE_BOUNDARY: 'kernel.scope.boundary',
  RECONCILIATION: 'kernel.reconciliation',
} as const;

export type KernelPolicyId = (typeof KERNEL_POLICY_IDS)[keyof typeof KERNEL_POLICY_IDS];
