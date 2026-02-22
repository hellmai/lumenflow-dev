// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Configuration Ports (WU-2020)
 *
 * Focused interfaces for injecting configuration sections into command
 * handlers and service functions. These replace module-level getConfig()
 * calls with explicit parameter injection (DIP compliance).
 *
 * Each interface extracts the minimum config surface needed by its
 * consumers, following the Interface Segregation Principle (ISP).
 *
 * @module ports/config
 */

/**
 * Git-related configuration for branch checks and worktree operations.
 *
 * Consumers: branch-check.ts, micro-worktree-shared.ts, micro-worktree.ts
 */
export interface IGitConfig {
  readonly mainBranch: string;
  readonly defaultRemote: string;
  readonly requireRemote: boolean;
  readonly laneBranchPrefix?: string;
  readonly agentBranchPatterns?: string[];
  readonly agentBranchPatternsOverride?: string[];
  readonly disableAgentPatternRegistry?: boolean;
  readonly pushRetry?: {
    readonly enabled: boolean;
    readonly retries: number;
    readonly min_delay_ms: number;
    readonly max_delay_ms: number;
    readonly jitter: boolean;
  };
}

/**
 * Directory paths configuration for WU file resolution.
 *
 * Consumers: wu-paths.ts, wu-list.ts, spawn-task-builder.ts
 */
export interface IDirectoriesConfig {
  readonly wuDir: string;
  readonly initiativesDir: string;
  readonly backlogPath: string;
  readonly statusPath: string;
  readonly worktrees: string;
  readonly stampsDir?: string;
  readonly plansDir: string;
  readonly templatesDir: string;
  readonly onboardingDir: string;
  readonly skillsDir: string;
  readonly agentsDir: string;
  readonly memoryBank: string;
  readonly safeGitPath: string;
}

/**
 * State paths configuration for store directory resolution.
 *
 * Consumers: wu-paths.ts, wu-backlog-updater.ts
 */
export interface IStateConfig {
  readonly base: string;
  readonly stampsDir: string;
  readonly stateDir: string;
}

/**
 * Minimal config interface for path-resolution consumers.
 *
 * Consumers that only need directory and state paths should depend
 * on this interface rather than the full LumenFlowConfig.
 */
export interface IPathsConfig {
  readonly directories: IDirectoriesConfig;
  readonly state: IStateConfig;
}

/**
 * Minimal config interface for git-operation consumers.
 *
 * Consumers that only need git configuration should depend on this
 * interface rather than the full LumenFlowConfig.
 */
export interface IGitOperationConfig {
  readonly git: IGitConfig;
}
