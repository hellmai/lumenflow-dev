# @lumenflow/cli

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
