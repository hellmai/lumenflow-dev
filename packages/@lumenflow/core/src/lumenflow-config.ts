// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LumenFlow Configuration Loader
 *
 * Loads and manages LumenFlow configuration from workspace.yaml
 * (`software_delivery` block).
 *
 * @module lumenflow-config
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import {
  type LumenFlowConfig,
  parseConfig,
  getDefaultConfig,
  validateConfig,
  WorkspaceV2ExtensionsSchema,
  WORKSPACE_V2_KEYS,
} from './lumenflow-config-schema.js';
import { GIT_DIRECTORY_NAME, WORKSPACE_CONFIG_FILE_NAME } from './config-contract.js';
import { normalizeConfigKeys } from './normalize-config-keys.js';
import { asRecord } from './object-guards.js';
import { createError, ErrorCodes } from './error-handler.js';

/** Canonical workspace config file name (workspace-first architecture) */
export {
  GIT_DIRECTORY_NAME,
  GIT_WORKTREES_SENTINEL,
  WORKSPACE_CONFIG_FILE_NAME,
} from './config-contract.js';

/** Shared UTF-8 encoding literal for file reads/writes */
const UTF8_ENCODING = 'utf8';

/** Warning prefix for config-loading diagnostics */
const WARNING_PREFIX = '[lumenflow-config]';

/** Actionable command to scaffold canonical workspace config */
const WORKSPACE_INIT_COMMAND = 'pnpm workspace-init --yes';

/** Canonical workspace section that stores software-delivery config */
const WORKSPACE_CONFIG_SECTION = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

/** Presence of canonical workspace config in a project root. */
export interface ConfigFilePresence {
  workspaceConfigExists: boolean;
}

/**
 * Detect whether canonical workspace config file exists.
 *
 * @param projectRoot - Project root directory
 * @returns File presence booleans for canonical workspace config file
 */
export function getConfigFilePresence(projectRoot: string): ConfigFilePresence {
  return {
    workspaceConfigExists: fs.existsSync(path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME)),
  };
}

/** Cached config instance */
let cachedConfig: LumenFlowConfig | null = null;

/** Cached project root */
let cachedProjectRoot: string | null = null;

/**
 * Parse YAML content and coerce it to a plain record.
 *
 * @param content - Raw YAML text
 * @returns Parsed object record, or null when parsed content is not an object
 */
function parseYamlRecord(content: string): Record<string, unknown> | null {
  return asRecord(yaml.parse(content));
}

/**
 * Find project root by looking for workspace.yaml, then .git
 *
 * @param startDir - Directory to start searching from
 * @returns Project root path or current working directory
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = path.resolve(startDir);
  const filesystemRoot = path.parse(currentDir).root;

  while (true) {
    if (fs.existsSync(path.join(currentDir, WORKSPACE_CONFIG_FILE_NAME))) {
      return currentDir;
    }

    if (fs.existsSync(path.join(currentDir, GIT_DIRECTORY_NAME))) {
      return currentDir;
    }

    if (currentDir === filesystemRoot) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  return process.cwd();
}

/**
 * Load config from canonical workspace.yaml `software_delivery` block.
 *
 * @param projectRoot - Project root directory
 * @returns Parsed software-delivery config object, or null when unavailable/invalid
 */
function loadWorkspaceSoftwareDeliveryConfig(projectRoot: string): Partial<LumenFlowConfig> | null {
  const workspacePath = path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);
  if (!fs.existsSync(workspacePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(workspacePath, UTF8_ENCODING);
    const workspaceData = parseYamlRecord(content);
    if (!workspaceData) {
      console.warn(
        `${WARNING_PREFIX} ${WORKSPACE_CONFIG_FILE_NAME} does not contain a valid object root.`,
      );
      return null;
    }

    const parsedExtensions = WorkspaceV2ExtensionsSchema.safeParse(workspaceData);
    if (!parsedExtensions.success) {
      const hasSoftwareDeliveryError = parsedExtensions.error.issues.some(
        (issue) => issue.path[0] === WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY,
      );
      if (hasSoftwareDeliveryError) {
        console.warn(
          `${WARNING_PREFIX} ${WORKSPACE_CONFIG_FILE_NAME} is missing a valid ${WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY} block.`,
        );
      }
      return null;
    }

    // WU-1765: Normalize snake_case YAML keys to camelCase before Zod parsing.
    return normalizeConfigKeys(parsedExtensions.data[WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY]);
  } catch (error) {
    console.warn(
      `${WARNING_PREFIX} Failed to parse ${WORKSPACE_CONFIG_FILE_NAME}:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Get LumenFlow configuration
 *
 * Resolution order:
 * 1. `workspace.yaml` → `software_delivery` block (canonical)
 * 2. defaults from schema
 *
 * @param options - Options for loading config
 * @param options.projectRoot - Override project root detection
 * @param options.reload - Force reload from disk (bypass cache)
 * @param options.strictWorkspace - Enforce workspace.yaml-only mode (hard cut)
 * @returns LumenFlow configuration
 */
export function getConfig(
  options: {
    projectRoot?: string;
    reload?: boolean;
    strictWorkspace?: boolean;
  } = {},
): LumenFlowConfig {
  const { projectRoot: overrideRoot, reload = false, strictWorkspace = false } = options;

  // Use cached config if available and not reloading
  if (cachedConfig && !reload && !overrideRoot) {
    return cachedConfig;
  }

  // Find or use provided project root
  const projectRoot = overrideRoot || findProjectRoot();
  const { workspaceConfigExists } = getConfigFilePresence(projectRoot);

  if (strictWorkspace && !workspaceConfigExists) {
    throw createError(
      ErrorCodes.CONFIG_ERROR,
      `${WARNING_PREFIX} Missing ${WORKSPACE_CONFIG_FILE_NAME}. ` +
        `Run \`${WORKSPACE_INIT_COMMAND}\` to scaffold workspace config.`,
    );
  }

  // Canonical workspace-first load path (INIT-033 hard cut)
  const workspaceConfig = loadWorkspaceSoftwareDeliveryConfig(projectRoot);

  if (strictWorkspace && workspaceConfigExists && !workspaceConfig) {
    throw createError(
      ErrorCodes.CONFIG_ERROR,
      `${WARNING_PREFIX} ${WORKSPACE_CONFIG_FILE_NAME} exists but is invalid. ` +
        `Ensure \`${WORKSPACE_CONFIG_SECTION}\` contains valid configuration values.`,
    );
  }

  // Parse with defaults
  const config = parseConfig(workspaceConfig ?? {});

  // Cache if using default project root
  if (!overrideRoot) {
    cachedConfig = config;
    cachedProjectRoot = projectRoot;
  }

  return config;
}

/**
 * Get the project root directory
 *
 * @returns Cached project root or finds it
 */
export function getProjectRoot(): string {
  if (cachedProjectRoot) {
    return cachedProjectRoot;
  }
  cachedProjectRoot = findProjectRoot();
  return cachedProjectRoot;
}

/**
 * Clear cached configuration and project root.
 *
 * Called by config-mutating lifecycle operations (wu:done, config:set) so that
 * subsequent calls to {@link getConfig} within the same process re-read from
 * disk instead of returning stale cached values.
 *
 * Also useful in tests that manipulate workspace.yaml between assertions.
 *
 * @see WU-2126
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  cachedProjectRoot = null;
}

/**
 * Resolve a path relative to project root
 *
 * @param relativePath - Relative path from config
 * @param projectRoot - Optional project root override
 * @returns Absolute path
 */
export function resolvePath(relativePath: string, projectRoot?: string): string {
  const root = projectRoot || getProjectRoot();
  return path.join(root, relativePath);
}

/**
 * Get resolved paths for common directories
 *
 * Convenience function that resolves all directory paths to absolute paths
 *
 * @param options - Options
 * @param options.projectRoot - Override project root
 * @returns Object with absolute paths
 */
export function getResolvedPaths(
  options: { projectRoot?: string; strictWorkspace?: boolean } = {},
): {
  wuDir: string;
  initiativesDir: string;
  backlogPath: string;
  statusPath: string;
  worktrees: string;
  stampsDir: string;
  stateDir: string;
  skillsDir: string;
  agentsDir: string;
  memoryBank: string;
  plansDir: string;
  templatesDir: string;
  onboardingDir: string;
  completeGuidePath: string;
  quickRefPath: string;
  startingPromptPath: string;
  governancePath: string;
  /** WU-1654: Safe-git wrapper absolute path */
  safeGitPath: string;
} {
  const projectRoot = options.projectRoot || getProjectRoot();
  const config = getConfig({
    projectRoot,
    strictWorkspace: options.strictWorkspace,
  });

  return {
    wuDir: path.join(projectRoot, config.directories.wuDir),
    initiativesDir: path.join(projectRoot, config.directories.initiativesDir),
    backlogPath: path.join(projectRoot, config.directories.backlogPath),
    statusPath: path.join(projectRoot, config.directories.statusPath),
    worktrees: path.join(projectRoot, config.directories.worktrees),
    stampsDir: path.join(projectRoot, config.state.stampsDir),
    stateDir: path.join(projectRoot, config.state.stateDir),
    skillsDir: path.join(projectRoot, config.directories.skillsDir),
    agentsDir: path.join(projectRoot, config.directories.agentsDir),
    memoryBank: path.join(projectRoot, config.directories.memoryBank),
    plansDir: path.join(projectRoot, config.directories.plansDir),
    templatesDir: path.join(projectRoot, config.directories.templatesDir),
    onboardingDir: path.join(projectRoot, config.directories.onboardingDir),
    completeGuidePath: path.join(projectRoot, config.directories.completeGuidePath),
    quickRefPath: path.join(projectRoot, config.directories.quickRefPath),
    startingPromptPath: path.join(projectRoot, config.directories.startingPromptPath),
    governancePath: path.join(projectRoot, config.directories.governancePath),
    safeGitPath: path.join(projectRoot, config.directories.safeGitPath),
  };
}

/**
 * Validate a config file
 *
 * @param configPath - Path to config file
 * @returns Validation result
 */
export function validateConfigFile(configPath: string): {
  valid: boolean;
  errors: string[];
  config?: LumenFlowConfig;
} {
  if (!fs.existsSync(configPath)) {
    return { valid: false, errors: ['Config file not found'] };
  }

  try {
    const content = fs.readFileSync(configPath, UTF8_ENCODING);
    const parsedRecord = parseYamlRecord(content);
    if (!parsedRecord) {
      return { valid: false, errors: ['Root YAML value must be an object'] };
    }

    const isWorkspaceFile = path.basename(configPath) === WORKSPACE_CONFIG_FILE_NAME;
    let sourceConfig: Record<string, unknown>;

    if (isWorkspaceFile) {
      const workspaceParse = WorkspaceV2ExtensionsSchema.safeParse(parsedRecord);
      if (!workspaceParse.success) {
        const workspaceErrors = workspaceParse.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        );
        return { valid: false, errors: workspaceErrors };
      }

      sourceConfig = workspaceParse.data[WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY];
    } else {
      sourceConfig = parsedRecord;
    }

    const result = validateConfig(normalizeConfigKeys(sourceConfig));

    if (result.success) {
      return { valid: true, errors: [], config: result.data };
    }

    const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { valid: false, errors };
  } catch (error) {
    return {
      valid: false,
      errors: [`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * Create a sample config file
 *
 * @param outputPath - Path to write config file
 * @param options - Options for sample config
 */
export function createSampleConfig(
  outputPath: string,
  options: { includeComments?: boolean } = {},
): void {
  const { includeComments = true } = options;

  const defaultConfig = getDefaultConfig();

  const configContent = includeComments
    ? `# LumenFlow Configuration
# This file configures paths and settings for the LumenFlow workflow framework.
# All paths are relative to the project root.

version: "${defaultConfig.version}"

# Directory paths
directories:
  # WU YAML files directory
  wuDir: "${defaultConfig.directories.wuDir}"
  # Initiatives directory
  initiativesDir: "${defaultConfig.directories.initiativesDir}"
  # Backlog file path
  backlogPath: "${defaultConfig.directories.backlogPath}"
  # Status file path
  statusPath: "${defaultConfig.directories.statusPath}"
  # Worktrees directory
  worktrees: "${defaultConfig.directories.worktrees}"
  # Skills directory
  skillsDir: "${defaultConfig.directories.skillsDir}"
  # Agents directory
  agentsDir: "${defaultConfig.directories.agentsDir}"
  # Plans directory
  plansDir: "${defaultConfig.directories.plansDir}"
  # Templates directory
  templatesDir: "${defaultConfig.directories.templatesDir}"
  # Onboarding directory
  onboardingDir: "${defaultConfig.directories.onboardingDir}"

# State paths (.lumenflow directory structure)
state:
  base: "${defaultConfig.state.base}"
  stampsDir: "${defaultConfig.state.stampsDir}"
  stateDir: "${defaultConfig.state.stateDir}"

# Git configuration
git:
  mainBranch: "${defaultConfig.git.mainBranch}"
  defaultRemote: "${defaultConfig.git.defaultRemote}"
  maxBranchDrift: ${defaultConfig.git.maxBranchDrift}

# WU configuration
wu:
  minDescriptionLength: ${defaultConfig.wu.minDescriptionLength}
  maxCommitSubject: ${defaultConfig.wu.maxCommitSubject}
  defaultPriority: "${defaultConfig.wu.defaultPriority}"
  defaultStatus: "${defaultConfig.wu.defaultStatus}"

# Gates configuration
gates:
  maxEslintWarnings: ${defaultConfig.gates.maxEslintWarnings}
  enableCoverage: ${defaultConfig.gates.enableCoverage}
  minCoverage: ${defaultConfig.gates.minCoverage}
`
    : yaml.stringify(defaultConfig);

  fs.writeFileSync(outputPath, configContent, UTF8_ENCODING);
}

// Re-export types and utilities from schema
export type {
  LumenFlowConfig,
  Directories,
  StatePaths,
  PushRetryConfig,
  GitConfig,
  WuConfig,
  GatesConfig,
  MemoryConfig,
  UiConfig,
  YamlConfig,
} from './lumenflow-config-schema.js';

// Re-export getDefaultConfig for consumers
export { getDefaultConfig } from './lumenflow-config-schema.js';

// WU-2020: Re-export config port interfaces for DIP-compliant injection.
// Consumers migrating from getConfig() can import focused interfaces here.
export type {
  IGitConfig,
  IDirectoriesConfig,
  IStateConfig,
  IPathsConfig,
  IGitOperationConfig,
} from './ports/config.ports.js';
