# @lumenflow/cli

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

- Updated dependencies
  - @lumenflow/core@2.0.0
  - @lumenflow/agent@2.0.0
  - @lumenflow/initiatives@2.0.0
  - @lumenflow/memory@2.0.0

## 1.1.0

### Minor Changes

- Add missing CLI commands and new metrics/workflow commands

  Previously unpublished commands now included:
  - wu-delete, wu-unlock-lane
  - agent-session, agent-session-end, agent-log-issue
  - orchestrate-initiative, orchestrate-init-status, orchestrate-monitor

  New commands from WU-1018:
  - flow-report: Generate DORA/SPACE flow reports
  - flow-bottlenecks: Analyze WU dependency graph bottlenecks
  - metrics-snapshot: Capture metrics snapshots
  - initiative-bulk-assign-wus: Bulk assign orphaned WUs
  - agent-issues-query: Query agent incidents

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
  - @lumenflow/core@1.0.0
  - @lumenflow/memory@1.0.0
  - @lumenflow/agent@1.0.0
  - @lumenflow/initiatives@1.0.0
