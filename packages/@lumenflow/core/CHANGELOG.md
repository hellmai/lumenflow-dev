# @lumenflow/core

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
