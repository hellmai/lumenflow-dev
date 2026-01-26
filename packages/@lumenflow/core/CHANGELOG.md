# @lumenflow/core

## 2.0.0

### Minor Changes

- ## INIT-003: ExampleApp Tools Migration

  Migrates 19 tools from ExampleApp tools/ to @lumenflow/cli following hexagonal architecture.

  ### New Commands

  **Git Operations (WU-1109)**
  - `git:status` - WU-aware git status with working tree info
  - `git:diff` - Show diffs with WU context
  - `git:log` - Display commit history with WU annotations
  - `git:branch` - List and manage branches
  - `guard:main:branch` - Prevent direct commits to main

  **Guards & Validation (WU-1111)**
  - `guard:worktree:commit` - Enforce worktree discipline
  - `guard:locked` - Check lane lock status
  - `validate` - Main WU YAML validator
  - `validate:agent:skills` - Validate agent skill definitions
  - `validate:agent:sync` - Check agent configuration sync
  - `validate:backlog:sync` - Validate backlog consistency
  - `validate:skills:spec` - Validate skill specifications

  **Utility Tools (WU-1112)**
  - `deps:add` - Add dependencies with audit
  - `deps:remove` - Remove dependencies safely
  - `session:coordinator` - Coordinate agent sessions
  - `rotate:progress` - Rotate progress logs
  - `lumenflow:upgrade` - Upgrade @lumenflow packages (now with worktree pattern)
  - `trace:gen` - Generate execution traces

  **State Management (WU-1107)**
  - `state:bootstrap` - Migrate WU YAMLs to event store

  ### Improvements
  - `lumenflow:upgrade` now uses worktree pattern for safe package.json updates
  - `lumenflow:upgrade` checks all 7 @lumenflow/\* packages (was 4)
  - All commands follow hexagonal architecture with proper port interfaces
  - > 80% test coverage on all new code

### Patch Changes

- @lumenflow/memory@2.0.0

## 1.7.0

### Minor Changes

- **WU-1094**: Added adapter classes and dependency injection for context-aware validation:
  - `SimpleGitLocationAdapter`: Implements `ILocationResolver` using simple-git
  - `SimpleGitStateAdapter`: Implements `IGitStateReader` using simple-git
  - `FileSystemWuStateAdapter`: Implements `IWuStateReader` using filesystem
  - `CommandRegistryAdapter`: Implements `ICommandRegistry`
  - `RecoveryAnalyzerAdapter`: Implements `IRecoveryAnalyzer`

- **WU-1094**: Added use case classes with constructor injection:
  - `ComputeContextUseCase`: Orchestrates context computation
  - `ValidateCommandUseCase`: Validates commands against context
  - `AnalyzeRecoveryUseCase`: Analyzes WU state for recovery

- **WU-1094**: Added DI factory functions:
  - `createContextAdapters()`: Create all context adapters
  - `createValidationAdapters()`: Create validation adapters
  - `createRecoveryAdapters()`: Create recovery adapters
  - `createComputeContextUseCase()`: Create use case with optional custom adapters
  - `createValidateCommandUseCase()`: Create use case with optional custom registry
  - `createAnalyzeRecoveryUseCase()`: Create use case with optional custom analyzer

- **WU-1094**: Added backwards compatible convenience functions:
  - `computeWuContext()`: Compute WU context with defaults
  - `validateCommand()`: Validate command with defaults
  - `analyzeRecoveryIssues()`: Analyze recovery with defaults

External users can now instantiate use cases with custom adapters for testing.

## 1.6.0

### Minor Changes

- **WU-1093**: Added port interfaces for context-aware validation system:
  - `ILocationResolver`: Detect main checkout vs worktree
  - `IGitStateReader`: Read git state (branch, dirty, ahead/behind)
  - `IWuStateReader`: Read WU state from YAML and state store
  - `ICommandRegistry`: Lookup command definitions and validation
  - `IRecoveryAnalyzer`: Analyze WU state issues and suggest recovery

- **WU-1093**: Added Zod schemas for domain types:
  - `context.schemas.ts`: `LocationContextSchema`, `GitStateSchema`, `WuStateResultSchema`, `SessionStateSchema`, `WuContextSchema`
  - `validation.schemas.ts`: `ValidationErrorSchema`, `ValidationWarningSchema`, `ValidationResultSchema`, `CommandPredicateConfigSchema`, `CommandDefinitionConfigSchema`
  - `recovery.schemas.ts`: `RecoveryIssueSchema`, `RecoveryActionSchema`, `RecoveryAnalysisSchema`

These abstractions enable external users to inject custom implementations for testing or customization.

## 1.0.0

### Minor Changes

- Initial release of LumenFlow workflow framework packages.

  LumenFlow is an agentic workflow framework for structured software development with:
  - Work Unit (WU) lifecycle management
  - Lane-based parallel development
  - Git worktree isolation
  - Quality gates and invariants
  - Memory layer for context persistence
  - DORA/SPACE metrics tracking

### Patch Changes

- Updated dependencies
  - @lumenflow/memory@1.0.0
  - @lumenflow/initiatives@1.0.0
