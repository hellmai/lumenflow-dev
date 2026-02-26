// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

/**
 * @file pack-manifest-resolver.ts
 * WU-2191: Shared pack manifest resolution for config commands
 *
 * Resolves pack manifest file paths based on pack pin source types.
 * This is a pure synchronous resolver that reads manifest files from disk
 * to discover config_key metadata. It does NOT download, clone, or fetch --
 * it only reads from locations where packs have already been installed.
 *
 * Source resolution strategy:
 * - local: monorepo layout (packages/@lumenflow/packs/<id>) or explicit path field
 * - registry: node_modules/@lumenflow/packs/<id>
 * - git: pack cache directory (~/.lumenflow/pack-cache/<id>@<version>)
 * - no source field: falls back to monorepo layout (backward compatibility)
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import YAML from 'yaml';
import {
  LUMENFLOW_DIR_NAME,
  PACK_MANIFEST_FILE_NAME,
  PACKAGES_DIR_NAME,
  LUMENFLOW_SCOPE_NAME,
  PACKS_DIR_NAME,
} from '../shared-constants.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACK_CACHE_DIR_NAME = 'pack-cache' as const;
const NODE_MODULES_DIR_NAME = 'node_modules' as const;
const DEFAULT_PACK_CACHE_DIR = path.join(homedir(), LUMENFLOW_DIR_NAME, PACK_CACHE_DIR_NAME);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackPinLike {
  id: string;
  version: string;
  integrity: string;
  source?: 'local' | 'git' | 'registry';
  path?: string;
  url?: string;
  registry_url?: string;
}

export interface PackManifestResolverInput {
  /** Absolute path to the project root directory */
  projectRoot: string;
  /** Pack pin entries from workspace.yaml */
  packs: PackPinLike[];
  /** Override pack cache directory (defaults to ~/.lumenflow/pack-cache) */
  packCacheDir?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Resolve the on-disk manifest path for a single pack pin.
 *
 * Returns the absolute path to the manifest file, or undefined if
 * the manifest cannot be found at the expected location.
 */
function resolveManifestPath(
  projectRoot: string,
  pack: PackPinLike,
  packCacheDir: string,
): string | undefined {
  const source = pack.source;

  if (source === 'registry') {
    // Registry packs are installed to node_modules
    return path.join(
      projectRoot,
      NODE_MODULES_DIR_NAME,
      LUMENFLOW_SCOPE_NAME,
      PACKS_DIR_NAME,
      pack.id,
      PACK_MANIFEST_FILE_NAME,
    );
  }

  if (source === 'git') {
    // Git packs are cloned to the pack cache directory
    return path.join(packCacheDir, `${pack.id}@${pack.version}`, PACK_MANIFEST_FILE_NAME);
  }

  // source === 'local' or missing (backward compatibility)
  if (pack.path) {
    // Explicit path field: resolve relative to project root
    return path.join(projectRoot, pack.path, PACK_MANIFEST_FILE_NAME);
  }

  // Default monorepo layout: packages/@lumenflow/packs/<id>/manifest.yaml
  return path.join(
    projectRoot,
    PACKAGES_DIR_NAME,
    LUMENFLOW_SCOPE_NAME,
    PACKS_DIR_NAME,
    pack.id,
    PACK_MANIFEST_FILE_NAME,
  );
}

/**
 * Resolve pack config_key metadata from workspace pack pins.
 *
 * Reads pinned pack manifests from their expected on-disk locations
 * (based on source type) and extracts the config_key field.
 *
 * This is a synchronous function suitable for use in CLI config commands.
 * It does NOT fetch, clone, or download anything -- packs must already be
 * installed/cached on disk.
 *
 * @param input - Project root, pack pins, and optional cache dir override
 * @returns Map of config_key to pack_id
 */
export function resolvePackManifestPaths(input: PackManifestResolverInput): Map<string, string> {
  const result = new Map<string, string>();
  const { projectRoot, packs, packCacheDir } = input;

  if (!Array.isArray(packs)) {
    return result;
  }

  const effectiveCacheDir = packCacheDir ?? DEFAULT_PACK_CACHE_DIR;

  for (const pack of packs) {
    if (!pack || typeof pack !== 'object' || !('id' in pack)) {
      continue;
    }

    const packId = String(pack.id);
    const manifestPath = resolveManifestPath(
      projectRoot,
      { ...pack, id: packId },
      effectiveCacheDir,
    );

    if (!manifestPath || !existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifestContent = readFileSync(manifestPath, 'utf8');
      const manifest = YAML.parse(manifestContent) as Record<string, unknown>;
      if (manifest && typeof manifest.config_key === 'string') {
        result.set(manifest.config_key, packId);
      }
    } catch {
      // Skip unreadable manifests
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pack schema metadata (WU-2192)
// ---------------------------------------------------------------------------

/**
 * Metadata about a pack's config schema declaration.
 *
 * @property hasSchema - Whether the pack declares a config_schema field
 * @property schemaPath - Absolute path to the JSON Schema file (if declared)
 */
export interface PackSchemaMetadata {
  /** Whether the pack declares a config_schema field in its manifest */
  hasSchema: boolean;
  /** Absolute path to the JSON Schema file, if config_schema is declared */
  schemaPath?: string;
}

/**
 * Resolve pack schema metadata from workspace pack pins.
 *
 * For each pinned pack, reads the manifest to discover config_key and
 * config_schema fields. Returns a map of pack_id -> schema metadata.
 *
 * This is a companion to resolvePackManifestPaths. While that function
 * returns config_key -> pack_id, this function returns pack_id -> schema info
 * needed for pack-aware config validation (WU-2192).
 *
 * @param input - Project root, pack pins, and optional cache dir override
 * @returns Map of pack_id -> PackSchemaMetadata
 */
export function resolvePackSchemaMetadata(
  input: PackManifestResolverInput,
): Map<string, PackSchemaMetadata> {
  const result = new Map<string, PackSchemaMetadata>();
  const { projectRoot, packs, packCacheDir } = input;

  if (!Array.isArray(packs)) {
    return result;
  }

  const effectiveCacheDir = packCacheDir ?? DEFAULT_PACK_CACHE_DIR;

  for (const pack of packs) {
    if (!pack || typeof pack !== 'object' || !('id' in pack)) {
      continue;
    }

    const packId = String(pack.id);
    const manifestPath = resolveManifestPath(
      projectRoot,
      { ...pack, id: packId },
      effectiveCacheDir,
    );

    if (!manifestPath || !existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifestContent = readFileSync(manifestPath, 'utf8');
      const manifest = YAML.parse(manifestContent) as Record<string, unknown>;

      if (!manifest) continue;

      const configSchema = manifest.config_schema;
      if (typeof configSchema === 'string' && configSchema.length > 0) {
        // config_schema is a relative path from the pack root
        const packRoot = path.dirname(manifestPath);
        const schemaAbsPath = path.join(packRoot, configSchema);
        result.set(packId, { hasSchema: true, schemaPath: schemaAbsPath });
      } else {
        // Check if this pack has a built-in schema (e.g., SD pack)
        // The SD pack has config_key but no config_schema file --
        // its Zod schema is built into the CLI. Mark it as hasSchema=true
        // so the CLI knows it can validate.
        const configKey = manifest.config_key;
        if (typeof configKey === 'string') {
          // Pack has config_key but no explicit config_schema.
          // Only the SD pack gets special treatment (built-in Zod schema).
          // Other packs without config_schema are treated as hasSchema=false.
          result.set(packId, { hasSchema: false });
        }
      }
    } catch {
      // Skip unreadable manifests
    }
  }

  return result;
}
