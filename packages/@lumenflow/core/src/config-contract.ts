// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared workspace config contract constants.
 *
 * This module is intentionally dependency-free so both schema and runtime
 * loaders can import canonical keys without circular imports.
 */

const WORKSPACE_CONFIG_BASENAME = 'workspace' as const;
const YAML_FILE_EXTENSION = 'yaml' as const;
export const WORKSPACE_CONFIG_FILE_NAME =
  `${WORKSPACE_CONFIG_BASENAME}.${YAML_FILE_EXTENSION}` as const;
export const GIT_DIRECTORY_NAME = '.git' as const;
const GIT_WORKTREES_DIRECTORY_NAME = 'worktrees' as const;
export const GIT_WORKTREES_SEGMENT =
  `${GIT_DIRECTORY_NAME}/${GIT_WORKTREES_DIRECTORY_NAME}` as const;
export const GIT_WORKTREES_SENTINEL = `/${GIT_WORKTREES_SEGMENT}/` as const;

export const WORKSPACE_V2_KEYS = {
  SOFTWARE_DELIVERY: 'software_delivery',
  CONTROL_PLANE: 'control_plane',
} as const;

/**
 * All kernel-owned root keys in WorkspaceSpecSchema.
 *
 * This list MUST stay in sync with the fields defined in
 * `packages/@lumenflow/kernel/src/kernel.schemas.ts` → WorkspaceSpecSchema.
 */
export const WORKSPACE_ROOT_KEYS = [
  'id',
  'name',
  'packs',
  'lanes',
  'policies',
  'security',
  'software_delivery',
  'control_plane',
  'memory_namespace',
  'event_namespace',
] as const;

export type WorkspaceRootKey = (typeof WORKSPACE_ROOT_KEYS)[number];

/**
 * Root keys that `config:set` can write directly without a dedicated command.
 *
 * Note: `software_delivery` is NOT here because it is a pack `config_key`
 * resolved dynamically from pack manifests at runtime. The config:set routing
 * table checks both this set and loaded pack manifest `config_keys`.
 */
export const WRITABLE_ROOT_KEYS: ReadonlySet<WorkspaceRootKey> = new Set<WorkspaceRootKey>([
  'control_plane',
  'memory_namespace',
  'event_namespace',
]);

/**
 * Root keys that require a dedicated command instead of `config:set`.
 *
 * Maps each managed key to the CLI command that should be used to modify it.
 */
export const MANAGED_ROOT_KEYS: Readonly<Record<string, string>> = {
  packs: 'pack:install',
  lanes: 'lane:edit',
  security: 'security:set',
  id: 'workspace-init',
  name: 'workspace-init',
  policies: 'policy:set',
} as const;
