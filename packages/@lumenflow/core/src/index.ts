// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @lumenflow/core - Battle-tested LumenFlow workflow framework
 * @module @lumenflow/core
 */

// Package version
export const VERSION = '0.0.0';

// Core utilities
export * from './arg-parser.js';
export * from './date-utils.js';
export * from './error-handler.js';
export * from './retry-strategy.js';
export * from './sandbox-allowlist.js';
export * from './sandbox-profile.js';
export * from './sandbox-backend-linux.js';
export * from './sandbox-backend-macos.js';
export * from './sandbox-backend-windows.js';

// Cycle detection (WU-1088 - extracted from initiatives to break circular dependency)
export * from './cycle-detector.js';

// User normalizer (explicit exports to avoid conflicts)
export {
  DEFAULT_DOMAIN,
  inferDefaultDomain,
  normalizeToEmail,
  isValidEmail,
} from './user-normalizer.js';

// Git operations
export * from './git-adapter.js';

// State machine
export * from './state-machine.js';

// WU State Schema (explicit exports to avoid DelegationEvent conflict with delegation-registry)
export {
  WU_EVENT_TYPES,
  WU_STATUSES,
  WU_PATTERNS,
  CreateEventSchema,
  ClaimEventSchema,
  BlockEventSchema,
  UnblockEventSchema,
  CompleteEventSchema,
  CheckpointEventSchema,
  WUEventSchema,
  validateWUEvent,
  // Rename conflicting exports
  DelegationEventSchema as WUDelegationEventSchema,
  type CreateEvent,
  type ClaimEvent,
  type BlockEvent,
  type UnblockEvent,
  type CompleteEvent,
  type CheckpointEvent,
  type WUEvent,
  type DelegationEvent as WUDelegationEvent,
} from './wu-state-schema.js';

// WU State Store (explicit exports to avoid isLockStale conflict)
export {
  WU_EVENTS_FILE_NAME,
  WUStateStore,
  acquireLock,
  releaseLock,
  repairStateFile,
  isLockStale as isWULockStale,
  type WUStateEntry,
  type LockData as WULockData,
  type CheckpointOptions,
  type RepairResult,
} from './wu-state-store.js';

// WU-2020: Factory function for DIP-compliant WU state store creation
export { createWUStateStore } from './wu-state-store.js';

// Lane management
export * from './lane-checker.js';
export * from './lane-inference.js';

// Lane lock (explicit exports with proper names)
export {
  getStaleThresholdMs,
  getLocksDir,
  getLockFilePath,
  isLockStale,
  isZombieLock,
  readLockMetadata,
  acquireLaneLock,
  releaseLaneLock,
  checkLaneLock,
  forceRemoveStaleLock,
  getAllLaneLocks,
  auditedUnlock,
} from './lane-lock.js';

export * from './lane-validator.js';

// WU lifecycle
export * from './wu-yaml.js';

// WU claim helpers (skip isValidEmail which conflicts with user-normalizer)
export { getAssignedEmail } from './wu-claim-helpers.js';

export * from './wu-done-worktree.js';
// WU-1664: Extracted worktree completion services for state-machine-driven execution
export * from './wu-done-worktree-services.js';
export * from './wu-done-validators.js';
// WU-1145: Concurrent backlog merge utilities
export * from './wu-done-concurrent-merge.js';
export * from './wu-helpers.js';
export * from './wu-schema.js';
export * from './wu-validator.js';
export * from './wu-rules-engine.js';

// Delegation system
export * from './delegation-registry-store.js';
export * from './delegation-registry-schema.js';
export * from './delegation-tree.js';
export * from './delegation-recovery.js';
export * from './delegation-monitor.js';
export * from './delegation-escalation.js';

// WU-1142: Spawn prompt schema for truncation-resistant prompts
// Explicit exports to avoid ValidationResult conflict with validation/index.js
export {
  SPAWN_SENTINEL,
  SPAWN_PROMPT_VERSION,
  SpawnPromptSchema,
  computeChecksum,
  createSpawnPrompt,
  validateSpawnPrompt,
  parseSpawnPrompt,
  serializeSpawnPrompt,
  checkSentinel,
  type SpawnPrompt,
  type SpawnPromptValidationResult,
  type ParseResult as SpawnPromptParseResult,
} from './spawn-prompt-schema.js';

// Backlog management
export * from './backlog-generator.js';
export * from './backlog-parser.js';
export * from './backlog-editor.js';
export * from './backlog-sync-validator.js';
export * from './validators/claim-validation.js';

// Worktree utilities
export * from './worktree-scanner.js';
export * from './worktree-ownership.js';
export * from './micro-worktree.js';
export * from './atomic-merge.js';

// WU-1654: Orphan worktree detection (named exports for doctor integration)
export { detectOrphanWorktrees, detectMissingTrackedWorktrees } from './orphan-detector.js';

// Guards and validators
// NOTE: Configuration added below
export * from './dependency-guard.js';
export {
  getDocsOnlyPrefixes,
  DOCS_ONLY_ROOT_FILES,
  TEST_FILE_PATTERNS,
} from './file-classifiers.js';
export * from './stamp-utils.js';
// Configuration
export * from './lumenflow-config.js';
export * from './lumenflow-config-schema.js';

// WU-2124: PathFactory - shared path resolution for all packages
export { createPathFactory } from './path-factory.js';
export type { PathFactory, PathFactoryOptions, LumenflowPathKey } from './path-factory.js';
export * from './docs-layout-presets.js';

// WU Events Cleanup (WU-1207)
export * from './wu-events-cleanup.js';

// State Cleanup Orchestration (WU-1208)
export * from './state-cleanup-core.js';

// State Doctor Integrity Checking (WU-1209)
export * from './state-doctor-core.js';

// Gates configuration (WU-1067)
export * from './gates-config.js';

// Branch check utilities
export * from './branch-check.js';

// WU-1082: Agent patterns registry (fetch + cache)
export * from './agent-patterns-registry.js';

// WU-1062: External plan storage
export * from './lumenflow-home.js';

// WU-1070: Force bypass audit logging
export * from './force-bypass-audit.js';

// WU-1075: LumenFlow directory paths (exported from wu-constants)
export { LUMENFLOW_PATHS } from './wu-constants.js';

// WU-1548: Centralized status constants, directories, and shared types
export { WU_STATUS, DIRECTORIES } from './wu-constants.js';
export type { NodeFsError } from './wu-constants.js';

// WU-1233: Stream error handling (EPIPE protection)
export { STREAM_ERRORS, EXIT_CODES } from './wu-constants.js';
export * from './stream-error-handler.js';

// WU-1085: Color support for NO_COLOR/FORCE_COLOR/--no-color
export * from './color-support.js';

// WU-1090: Context-aware state machine for WU lifecycle commands
export * from './context/index.js';
export * from './validation/index.js';
export * from './recovery/index.js';
export * from './context-validation-integration.js';

// WU-1090: Context validation constants
export { CONTEXT_VALIDATION } from './wu-constants.js';
export type { ValidationErrorCode, PredicateSeverity, ValidationMode } from './wu-constants.js';

// WU-1394: Claude Code hook constants for enforcement and recovery
export { LUMENFLOW_CLIENT_IDS, CLAUDE_HOOKS, getHookCommand } from './wu-constants.js';
export type { LumenflowClientId } from './wu-constants.js';

// WU-2113: Canonical LUMENFLOW_* env var name constants
export { ENV_VARS } from './wu-constants.js';
export type { EnvVarKey, EnvVarName } from './wu-constants.js';

// WU-1126: Enum-style constants for port interfaces (const + type pairs)
// These provide named constants to avoid magic string literals in code
// The const objects serve as both runtime values AND types via TypeScript's const/type pattern
export { LocationType } from './domain/context.schemas.js';
export { RecoveryIssueCode, RecoveryActionType } from './domain/recovery.schemas.js';

// WU-1549: Slim IToolExecutor for gate consumers (ISP) + full IToolRunner
export type { IToolExecutor, IToolRunner } from './ports/core-tools.ports.js';

// WU-1093: Port interfaces for context-aware validation (external injection points)
export type { ILocationResolver, IGitStateReader, IWuStateReader } from './ports/context.ports.js';
export type { ICommandRegistry } from './ports/validation.ports.js';
export type { IRecoveryAnalyzer } from './ports/recovery.ports.js';

// WU-1102: Port interfaces for WU helper modules (hexagonal architecture)
export type {
  IWuGitAdapter,
  IWuStatusCheckResult,
  IBranchValidationResult,
  IWuYamlReader,
  IWuYamlWriter,
  IWuStateStore,
  IWuCheckpointManager,
  IWuPaths,
} from './ports/wu-helpers.ports.js';

// WU-2013: WU state port interfaces (focused decomposition)
export type { IWuEventLog, IWuLockManager, IWuStateQuery } from './ports/wu-state.ports.js';

// WU-2020: Config port interfaces for DIP-compliant injection
export type {
  IGitConfig,
  IDirectoriesConfig,
  IStateConfig,
  IPathsConfig,
  IGitOperationConfig,
} from './ports/config.ports.js';

// WU-1103: Port interfaces for git adapter (hexagonal architecture)
export type {
  IGitAdapter,
  MergeOptions,
  MergeResult,
  PushOptions,
  DeleteBranchOptions,
  WorktreeRemoveOptions,
} from './ports/git-validator.ports.js';

// WU-1093: Domain schemas for context-aware validation (Zod schemas)
// Note: Types like LocationContext, GitState are already exported from context/index.js
// so we only export the Zod schemas, not the inferred types.
export {
  // Context schemas
  LOCATION_TYPE_VALUES,
  LocationTypeSchema,
  LocationContextSchema,
  GitStateSchema,
  WuStateResultSchema,
  SessionStateSchema,
  WuContextSchema,
} from './domain/context.schemas.js';

export {
  // Validation schemas
  VALIDATION_ERROR_CODE_VALUES,
  ValidationErrorCodeSchema,
  PREDICATE_SEVERITY_VALUES,
  PredicateSeveritySchema,
  ValidationErrorSchema,
  ValidationWarningSchema,
  ValidationResultSchema,
  CommandPredicateConfigSchema,
  CommandDefinitionConfigSchema,
  type CommandPredicateConfig,
  type CommandDefinitionConfig,
} from './domain/validation.schemas.js';

export {
  // Recovery schemas
  RECOVERY_ISSUE_CODE_VALUES,
  RecoveryIssueCodeSchema,
  RECOVERY_ACTION_TYPE_VALUES,
  RecoveryActionTypeSchema,
  RecoveryIssueSchema,
  RecoveryActionSchema,
  RecoveryAnalysisSchema,
} from './domain/recovery.schemas.js';

// WU-1094: Adapters - Concrete implementations of port interfaces
export {
  // Context adapters
  SimpleGitLocationAdapter,
  SimpleGitStateAdapter,
  FileSystemWuStateAdapter,
  // Validation adapters
  CommandRegistryAdapter,
  // Recovery adapters
  RecoveryAnalyzerAdapter,
} from './adapters/index.js';

// WU-1094: Use Cases - Application layer business logic
export {
  // Context use cases
  ComputeContextUseCase,
  type ComputeContextOptions,
  // Validation use cases
  ValidateCommandUseCase,
  // Recovery use cases
  AnalyzeRecoveryUseCase,
} from './usecases/index.js';

// WU-1189: Lane suggestion prompt generation
export * from './lane-suggest-prompt.js';

// WU-1190: Git context extraction for lane suggestion
export * from './git-context-extractor.js';
export * from './pack-authoring-template-engine.js';

// WU-1094: Dependency Injection - Factory functions for wiring
export {
  // Adapter factory functions
  createContextAdapters,
  createValidationAdapters,
  createRecoveryAdapters,
  // Use case factory functions
  createComputeContextUseCase,
  createValidateCommandUseCase,
  createAnalyzeRecoveryUseCase,
  // Backwards compatible convenience functions
  computeWuContext,
  validateCommand,
  analyzeRecoveryIssues,
  // Types
  type ContextAdapters,
  type ValidationAdapters,
  type RecoveryAdapters,
  type CreateComputeContextOptions,
  type CreateValidateCommandOptions,
  type CreateAnalyzeRecoveryOptions,
} from './context-di.js';

// WU-1246: WU ID auto-generation
export * from './wu-id-generator.js';

// WU-1253: Test baseline ratchet pattern
export * from './test-baseline.js';

// WU-1253: Template loader for extracting prompt templates
export {
  loadManifest,
  loadTemplate,
  loadTemplatesWithOverrides,
  assembleTemplates,
  replaceTokens,
  evaluateCondition,
  type TemplateFrontmatter,
  type LoadedTemplate,
  type ManifestEntry,
  type TemplateManifest,
  type TemplateContext,
} from './template-loader.js';

// WU-1253: Template-based spawn prompt generation
export { tryAssembleSpawnTemplates, buildTemplateContext } from './wu-spawn.js';

// WU-1242: Patrol loop for continuous spawn monitoring
export * from './patrol-loop.js';

// WU-1259: Methodology policy resolution
// WU-1899: Work classification config schemas
export {
  resolvePolicy,
  getDefaultPolicy,
  MethodologyConfigSchema,
  MethodologyOverridesSchema,
  TestingMethodologySchema,
  ArchitectureMethodologySchema,
  CoverageModeSchema,
  WorkClassificationConfigSchema,
  WorkClassificationUiSchema,
  TESTING_METHODOLOGY,
  ARCHITECTURE_METHODOLOGY,
  COVERAGE_MODE,
  type ResolvedPolicy,
  type ResolvePolicyOptions,
  type MethodologyConfig,
  type MethodologyOverrides,
  type TestingMethodology,
  type ArchitectureMethodology,
  type CoverageMode,
  type WorkClassificationSchemaConfig,
  type WorkClassificationUi,
} from './resolve-policy.js';

// WU-1411: WU list helper for MCP server and other tools
export { listWUs, type WUListEntry, type ListWUsOptions } from './wu-list.js';

// WU-1431: Shared CLI/MCP command schemas for parity
export * from './schemas/index.js';

// WU-1899: Signal-based work classifier
export {
  classifyWork,
  WORK_DOMAINS,
  SIGNAL_WEIGHTS,
  DEFAULT_UI_CODE_PATH_PATTERNS,
  DEFAULT_UI_LANE_HINTS,
  type WorkDomain,
  type WorkSignal,
  type WorkClassification,
  type WorkClassificationConfig,
} from './work-classifier.js';

// WU-1495: Cloud auto-detection core
export {
  detectCloudMode,
  CLOUD_ACTIVATION_SOURCE,
  type CloudDetectInput,
  type CloudDetectResult,
  type CloudDetectConfig,
  type CloudEnvSignalConfig,
  type CloudActivationSource,
} from './cloud-detect.js';
