/**
 * LumenFlow Configuration Loader
 *
 * Loads and manages LumenFlow configuration from .lumenflow.config.yaml
 * Falls back to sensible defaults if no config file exists.
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
} from './lumenflow-config-schema.js';

/** Default config file name */
const CONFIG_FILE_NAME = '.lumenflow.config.yaml';

/** Cached config instance */
let cachedConfig: LumenFlowConfig | null = null;

/** Cached project root */
let cachedProjectRoot: string | null = null;

/**
 * Find project root by looking for .lumenflow.config.yaml or .git
 *
 * @param startDir - Directory to start searching from
 * @returns Project root path or current working directory
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    // Check for config file first
    if (fs.existsSync(path.join(currentDir, CONFIG_FILE_NAME))) {
      return currentDir;
    }
    // Fall back to .git directory
    if (fs.existsSync(path.join(currentDir, '.git'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return process.cwd();
}

/**
 * Load configuration from file
 *
 * @param projectRoot - Project root directory
 * @returns Parsed configuration or null if file doesn't exist
 */
function loadConfigFile(projectRoot: string): Partial<LumenFlowConfig> | null {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);
    return data || {};
  } catch (error) {
    console.warn(`Warning: Failed to parse ${CONFIG_FILE_NAME}:`, error);
    return null;
  }
}

/**
 * Get LumenFlow configuration
 *
 * Loads config from .lumenflow.config.yaml if present, otherwise uses defaults.
 * Configuration is cached for performance.
 *
 * @param options - Options for loading config
 * @param options.projectRoot - Override project root detection
 * @param options.reload - Force reload from disk (bypass cache)
 * @returns LumenFlow configuration
 */
export function getConfig(
  options: {
    projectRoot?: string;
    reload?: boolean;
  } = {},
): LumenFlowConfig {
  const { projectRoot: overrideRoot, reload = false } = options;

  // Use cached config if available and not reloading
  if (cachedConfig && !reload && !overrideRoot) {
    return cachedConfig;
  }

  // Find or use provided project root
  const projectRoot = overrideRoot || findProjectRoot();

  // Load config file if exists
  const fileConfig = loadConfigFile(projectRoot);

  // Parse with defaults
  const config = parseConfig(fileConfig || {});

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
 * Clear cached configuration
 *
 * Useful for testing or when config file changes
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
export function getResolvedPaths(options: { projectRoot?: string } = {}): {
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
  /** WU-1654: Safe-git wrapper absolute path */
  safeGitPath: string;
} {
  const projectRoot = options.projectRoot || getProjectRoot();
  const config = getConfig({ projectRoot });

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
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);
    const result = validateConfig(data);

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

  fs.writeFileSync(outputPath, configContent, 'utf8');
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
