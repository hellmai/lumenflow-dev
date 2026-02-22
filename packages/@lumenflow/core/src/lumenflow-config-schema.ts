// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LumenFlow Configuration Schema - Composition File
 *
 * WU-2016: Split into per-section schemas under schemas/.
 * This file composes the full LumenFlowConfigSchema from section schemas
 * and re-exports all symbols for backward compatibility.
 *
 * Per-section schemas (independently importable):
 * - schemas/workspace-config.ts    - Workspace V2, control plane
 * - schemas/directories-config.ts  - Directories, state paths, event archival
 * - schemas/git-config.ts          - Git, push retry
 * - schemas/wu-config.ts           - WU configuration
 * - schemas/gates-section-config.ts - Gates, commands
 * - schemas/memory-config.ts       - Memory, signals, checkpoint, decay
 * - schemas/agents-config.ts       - Agents, clients, skills, enforcement
 * - schemas/lanes-config.ts        - Lanes, definitions, lock policy
 * - schemas/cloud-config.ts        - Cloud auto-detection
 * - schemas/operational-config.ts  - Experimental, cleanup, telemetry, UI, YAML
 *
 * @module lumenflow-config-schema
 */

import { z } from 'zod';

// WU-1259: Import methodology config schema for resolvePolicy()
import { MethodologyConfigSchema } from './resolve-policy.js';

// --- Re-export per-section schemas and types ---

export * from './schemas/workspace-config.js';
export * from './schemas/directories-config.js';
export * from './schemas/git-config.js';
export * from './schemas/wu-config.js';
export * from './schemas/gates-section-config.js';
export * from './schemas/memory-config.js';
export * from './schemas/agents-config.js';
export * from './schemas/lanes-config.js';
export * from './schemas/cloud-config.js';
export * from './schemas/operational-config.js';

// --- Import section schemas for composition ---

import { DirectoriesSchema, StatePathsSchema } from './schemas/directories-config.js';
import { GitConfigSchema } from './schemas/git-config.js';
import { WuConfigSchema } from './schemas/wu-config.js';
import { GatesConfigSchema } from './schemas/gates-section-config.js';
import { MemoryConfigSchema } from './schemas/memory-config.js';
import { AgentsConfigSchema } from './schemas/agents-config.js';
import { LanesConfigSchema } from './schemas/lanes-config.js';
import { CloudConfigSchema } from './schemas/cloud-config.js';
import {
  PackageManagerSchema,
  TestRunnerSchema,
  UiConfigSchema,
  YamlConfigSchema,
  ExperimentalConfigSchema,
  CleanupConfigSchema,
  TelemetryConfigSchema,
} from './schemas/operational-config.js';

// WU-1259: Re-export methodology types from resolve-policy
// WU-1899: Also re-export work classification types
export type {
  MethodologyConfig,
  MethodologyOverrides,
  WorkClassificationUi,
  WorkClassificationSchemaConfig,
} from './resolve-policy.js';

/**
 * Complete LumenFlow configuration schema
 *
 * Composed from per-section schemas via z.object composition.
 */
export const LumenFlowConfigSchema = z.object({
  /** Schema version for future migrations */
  version: z.string().default('1.0.0'),

  /** Directory paths */
  directories: DirectoriesSchema.default(() => DirectoriesSchema.parse({})),

  /** State paths (.lumenflow directory structure) */
  state: StatePathsSchema.default(() => StatePathsSchema.parse({})),

  /** Git configuration */
  git: GitConfigSchema.default(() => GitConfigSchema.parse({})),

  /** WU configuration */
  wu: WuConfigSchema.default(() => WuConfigSchema.parse({})),

  /** Gates configuration */
  gates: GatesConfigSchema.default(() => GatesConfigSchema.parse({})),

  /** Memory layer configuration */
  memory: MemoryConfigSchema.default(() => MemoryConfigSchema.parse({})),

  /** UI configuration */
  ui: UiConfigSchema.default(() => UiConfigSchema.parse({})),

  /** YAML configuration */
  yaml: YamlConfigSchema.default(() => YamlConfigSchema.parse({})),

  /** Agents configuration */
  agents: AgentsConfigSchema.default(() => AgentsConfigSchema.parse({})),

  /** Experimental features (WU-1090) */
  experimental: ExperimentalConfigSchema.default(() => ExperimentalConfigSchema.parse({})),

  /** WU-1366: Cleanup configuration */
  cleanup: CleanupConfigSchema.default(() => CleanupConfigSchema.parse({})),

  /** WU-1270: Telemetry configuration */
  telemetry: TelemetryConfigSchema.default(() => TelemetryConfigSchema.parse({})),

  /** WU-1259: Methodology configuration */
  methodology: MethodologyConfigSchema.optional(),

  /** WU-1495: Cloud auto-detection configuration */
  cloud: CloudConfigSchema.default(() => CloudConfigSchema.parse({})),

  /** WU-1345: Lanes configuration */
  lanes: LanesConfigSchema.optional(),

  /** WU-1356: Package manager for CLI operations */
  package_manager: PackageManagerSchema,

  /** WU-1356: Test runner for incremental test detection */
  test_runner: TestRunnerSchema,

  /** WU-1356: Custom build command for CLI bootstrap */
  build_command: z.string().default('pnpm build'),
});

export type LumenFlowConfig = z.infer<typeof LumenFlowConfigSchema>;

/**
 * Validate configuration data
 *
 * @param data - Configuration data to validate
 * @returns Validation result with parsed config or errors
 */
export function validateConfig(data: unknown) {
  return LumenFlowConfigSchema.safeParse(data);
}

/**
 * Parse configuration with defaults
 *
 * @param data - Partial configuration data
 * @returns Complete configuration with defaults applied
 * @throws ZodError if validation fails
 */
export function parseConfig(data: unknown = {}): LumenFlowConfig {
  return LumenFlowConfigSchema.parse(data);
}

/**
 * Get default configuration
 *
 * @returns Default LumenFlow configuration
 */
export function getDefaultConfig(): LumenFlowConfig {
  return LumenFlowConfigSchema.parse({});
}
