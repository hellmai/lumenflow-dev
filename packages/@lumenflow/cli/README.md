# @lumenflow/cli

[![npm version](https://img.shields.io/npm/v/@lumenflow/cli.svg)](https://www.npmjs.com/package/@lumenflow/cli)
[![npm downloads](https://img.shields.io/npm/dm/@lumenflow/cli.svg)](https://www.npmjs.com/package/@lumenflow/cli)
[![license](https://img.shields.io/npm/l/@lumenflow/cli.svg)](https://github.com/hellmai/os/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@lumenflow/cli.svg)](https://nodejs.org)

> Command-line interface for LumenFlow workflow framework

## Installation

```bash
npm install @lumenflow/cli
```

## Quick Start

```bash
# Install the CLI
pnpm add -D @lumenflow/cli   # or: npm install -D @lumenflow/cli

# Initialize LumenFlow (works with any AI)
pnpm exec lumenflow

# Or specify your AI tool for enhanced integration
pnpm exec lumenflow --client claude    # Claude Code
pnpm exec lumenflow --client cursor    # Cursor
pnpm exec lumenflow --client windsurf  # Windsurf
pnpm exec lumenflow --client cline     # Cline
pnpm exec lumenflow --client aider     # Aider
pnpm exec lumenflow --client all       # All integrations
```

The default `lumenflow` command creates `AGENTS.md` and `LUMENFLOW.md` which work with **any AI coding assistant**. The `--client` flag adds vendor-specific configuration files for deeper integration.

See [AI Integrations](https://lumenflow.dev/guides/ai-integrations) for details on each tool.

## Overview

This package provides CLI commands for the LumenFlow workflow framework, including:

- **WU (Work Unit) management**: Claim, complete, block, and track work units
- **Memory layer**: Session tracking, context recovery, and agent coordination
- **Initiative orchestration**: Multi-phase project coordination
- **Quality gates**: Pre-merge validation and checks

## Commands

### Work Unit Management

| Command          | Description                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `wu-block`       | Block a work unit and move it from in-progress to blocked status                                            |
| `wu-claim`       | Claim a work unit by creating a worktree/branch and updating status                                         |
| `wu-cleanup`     | Clean up worktree and branch after PR merge (PR-based completion workflow)                                  |
| `wu-create`      | Create a new Work Unit with micro-worktree isolation (race-safe). Auto-generates ID if `--id` not provided. |
| `wu-delete`      | Safely delete WU YAML files with micro-worktree isolation                                                   |
| `wu-deps`        | Visualize WU dependency graph                                                                               |
| `wu-done`        | Complete a WU (runs gates, merges, creates stamp)                                                           |
| `wu-edit`        | Edit WU spec files with micro-worktree isolation                                                            |
| `wu-infer-lane`  | Suggest sub-lane for a WU based on content                                                                  |
| `wu-preflight`   | Fast validation of code paths and test paths before gates                                                   |
| `wu-prune`       | Maintain worktree hygiene (prune stale worktrees, detect orphans)                                           |
| `wu-recover`     | Analyze and fix WU state inconsistencies                                                                    |
| `wu-release`     | Release an orphaned WU from in_progress back to ready state                                                 |
| `wu-repair`      | Unified WU repair tool - detect and fix WU state issues                                                     |
| `wu-spawn`       | Generate Task tool invocation for sub-agent WU execution                                                    |
| `wu-status`      | Show WU status, location, and valid commands                                                                |
| `wu-unblock`     | Unblock a work unit and move it from blocked to in-progress status                                          |
| `wu-unlock-lane` | Safely unlock a lane lock with audit logging                                                                |
| `wu-validate`    | Validate WU YAML files against schema                                                                       |

### Memory & Session

| Command               | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `agent-issues-query`  | Show summary of logged issues                               |
| `agent-log-issue`     | Log a workflow issue or incident                            |
| `agent-session`       | Start an agent session                                      |
| `agent-session-end`   | End the current agent session                               |
| `mem-checkpoint`      | Create a checkpoint node for context snapshots              |
| `mem-cleanup`         | Prune closed memory nodes based on lifecycle policy and TTL |
| `mem-create`          | Create a memory node with optional provenance tracking      |
| `mem-export`          | Export memory nodes as markdown or JSON                     |
| `mem-inbox`           | Read coordination signals from other agents                 |
| `mem-init`            | Initialize memory layer in repository                       |
| `mem-ready`           | Query ready nodes for a WU (deterministic ordering)         |
| `mem-signal`          | Send a coordination signal to other agents                  |
| `mem-start`           | Create a session node linked to a WU                        |
| `mem-summarize`       | Rollup older memory nodes into summary nodes for compaction |
| `mem-triage`          | Review discovery nodes and promote to WUs or archive        |
| `session-coordinator` | Manage agent sessions for WU work coordination              |
| `signal-cleanup`      | Prune old signals based on TTL policy to prevent growth     |

### Initiative Orchestration

| Command                      | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `init-plan`                  | Link a plan file to an initiative                             |
| `initiative-add-wu`          | Link a WU to an initiative bidirectionally                    |
| `initiative-bulk-assign-wus` | Bulk-assign orphaned WUs to initiatives based on lane rules   |
| `initiative-create`          | Create a new Initiative with micro-worktree isolation         |
| `initiative-edit`            | Edit Initiative YAML files with micro-worktree isolation      |
| `initiative-list`            | List all initiatives with progress percentages                |
| `initiative-status`          | Show detailed initiative view with phases and WUs             |
| `orchestrate-init-status`    | Show initiative progress status                               |
| `orchestrate-initiative`     | Orchestrate initiative execution with parallel agent spawning |
| `orchestrate-monitor`        | Monitor spawned agent progress                                |
| `rotate-progress`            | Move completed WUs from status.md to Completed section        |
| `spawn-list`                 | Display spawn trees for WUs or initiatives                    |

### Metrics & Analytics

| Command             | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `flow-bottlenecks`  | Analyze WU dependency graph for bottlenecks and critical paths |
| `flow-report`       | Generate DORA/SPACE flow report from telemetry and WU data     |
| `lumenflow-metrics` | LumenFlow metrics CLI (lanes, dora, flow)                      |
| `metrics`           | Alias for `lumenflow-metrics`                                  |
| `metrics-snapshot`  | Capture DORA metrics, lane health, and flow state snapshot     |
| `trace-gen`         | Generate traceability reports linking WUs to code changes      |

### Lane Tooling

| Command        | Description                                                           |
| -------------- | --------------------------------------------------------------------- |
| `lane-health`  | Check lane configuration health (overlaps, coverage gaps)             |
| `lane-suggest` | LLM-driven lane suggestions based on codebase context and git history |

### Verification & Gates

| Command                 | Description                                               |
| ----------------------- | --------------------------------------------------------- |
| `gates`                 | Run quality gates (format, lint, typecheck, tests)        |
| `guard-locked`          | Check if a WU is locked (exits 1 if locked)               |
| `guard-main-branch`     | Check if current branch is protected and block operations |
| `guard-worktree-commit` | Check if a WU commit should be blocked from main checkout |
| `lumenflow-gates`       | Alias for `gates`                                         |
| `lumenflow-validate`    | Validate WU YAML files for schema and quality             |
| `validate`              | Alias for `lumenflow-validate`                            |
| `validate-agent-skills` | Validate agent skill definitions                          |
| `validate-agent-sync`   | Validate agent configuration and sync state               |
| `validate-backlog-sync` | Validate that backlog.md is in sync with WU YAML files    |
| `validate-skills-spec`  | Validate skill specification format                       |

### System & Setup

| Command                    | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `backlog-prune`            | Maintain backlog hygiene (archive old WUs)                |
| `deps-add`                 | Add dependencies with worktree discipline enforcement     |
| `deps-remove`              | Remove dependencies with worktree discipline enforcement  |
| `lumenflow`                | CLI entry point (scaffold/init)                           |
| `lumenflow-docs-sync`      | Sync agent onboarding docs to existing projects           |
| `lumenflow-init`           | Initialize LumenFlow in a project                         |
| `lumenflow-release`        | Release @lumenflow/\* packages to npm                     |
| `lumenflow-sync-templates` | Sync internal docs to CLI templates                       |
| `lumenflow-upgrade`        | Upgrade all @lumenflow/\* packages to a specified version |
| `state-bootstrap`          | One-time migration utility for state sourcing             |
| `state-cleanup`            | Unified cleanup: signals, memory, and event archival      |
| `state-doctor`             | Check state integrity and detect inconsistencies          |
| `lumenflow-doctor`         | Alias for `state-doctor`                                  |
| `sync-templates`           | Alias for `lumenflow-sync-templates`                      |

### File & Git Operations

| Command       | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `file-delete` | Delete a file or directory with audit logging                  |
| `file-edit`   | Edit file by replacing exact string matches with audit logging |
| `file-read`   | Read file content with audit logging                           |
| `file-write`  | Write content to a file with audit logging                     |
| `git-branch`  | List, create, or delete branches                               |
| `git-diff`    | Show changes between commits, commit and working tree          |
| `git-log`     | Show commit logs                                               |
| `git-status`  | Show the working tree status                                   |

## Usage

Commands are typically invoked via pnpm scripts in your project:

```bash
# WU workflow
pnpm wu:claim --id WU-123 --lane operations
pnpm wu:done --id WU-123

# Memory operations
pnpm mem:checkpoint "Completed port definitions" --wu WU-123
pnpm mem:inbox --unread

# Initiative management
pnpm initiative:status INIT-007

# Quality gates
pnpm gates
```

### Direct CLI Usage

```bash
# After installing the package
npx wu-claim --id WU-123 --lane operations
npx gates
```

## Global Flags

All commands support these flags:

| Flag              | Description               |
| ----------------- | ------------------------- |
| `--help`, `-h`    | Show help for the command |
| `--version`, `-V` | Show version number       |
| `--no-color`      | Disable colored output    |

## Environment Variables

| Variable      | Description                                                                            |
| ------------- | -------------------------------------------------------------------------------------- |
| `NO_COLOR`    | Disable colored output when set (any value, per [no-color.org](https://no-color.org/)) |
| `FORCE_COLOR` | Override color level: `0` (disabled), `1` (basic), `2` (256 colors), `3` (16m colors)  |

## Integration

The CLI integrates with other LumenFlow packages:

- `@lumenflow/core` - Git operations, worktree management
- `@lumenflow/memory` - Session and context persistence
- `@lumenflow/agent` - Agent session management
- `@lumenflow/initiatives` - Initiative tracking

## Documentation

For complete documentation, see [lumenflow.dev](https://lumenflow.dev/reference/cli).

## Upgrading

To upgrade LumenFlow packages:

```bash
# Check for available updates
pnpm outdated @lumenflow/*

# Update all LumenFlow packages
pnpm update @lumenflow/cli @lumenflow/core @lumenflow/memory @lumenflow/agent @lumenflow/initiatives

# Sync documentation and templates
pnpm exec lumenflow docs:sync
```

**Important**: Always run `docs:sync` after upgrading to update agent onboarding documentation, workflow rules, and vendor-specific configurations.

For detailed upgrade instructions, migration guides, and troubleshooting, see [UPGRADING.md](https://lumenflow.dev/upgrading).

## License

Apache-2.0
