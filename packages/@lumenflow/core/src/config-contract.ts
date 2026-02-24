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

export const WORKSPACE_V2_KEYS = {
  SOFTWARE_DELIVERY: 'software_delivery',
  CONTROL_PLANE: 'control_plane',
} as const;
