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

<!-- AUTO-GENERATED SECTION - DO NOT EDIT DIRECTLY -->
<!-- Run `pnpm docs:generate` to regenerate from source -->

### Work Unit Management

| Command          | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `wu-block`       | Block a work unit and move it from in-progress to blocked status            |
| `wu-claim`       | Claim a work unit by creating a worktree/branch and updating status         |
| `wu-cleanup`     | Clean up worktree and branch after PR merge (PR-based completion workflow)  |
| `wu-create`      | Create a new Work Unit with micro-worktree isolation (race-safe)            |
| `wu-delete`      | Safely delete WU YAML files with micro-worktree isolation                   |
| `wu-deps`        | Visualize WU dependency graph                                               |
| `wu-done`        | WU Done Helper                                                              |
| `wu-edit`        | Edit WU spec files with micro-worktree isolation                            |
| `wu-infer-lane`  | WU Lane Inference CLI (WU-908)                                              |
| `wu-preflight`   | Fast validation of code_paths and test paths before gates run.              |
| `wu-prep`        | Prepare WU for completion (run gates in worktree)                           |
| `wu-proto`       | Create and claim a prototype WU with relaxed validation (rapid prototyping) |
| `wu-prune`       | WU Prune Utility                                                            |
| `wu-recover`     | Analyze and fix WU state inconsistencies (WU-1090)                          |
| `wu-release`     | Release an orphaned WU from in_progress back to ready state for reclaiming  |
| `wu-repair`      | WU State Repair Tool (Unified - WU-1826, WU-2240)                           |
| `wu-spawn`       | Generate Task tool invocation for sub-agent WU execution                    |
| `wu-status`      | Show WU status, location, and valid commands (WU-1090)                      |
| `wu-unblock`     | Unblock a work unit and move it from blocked to in-progress status          |
| `wu-unlock-lane` | Safely unlock a lane lock with audit logging                                |
| `wu-validate`    | Validate WU YAML files against schema (strict mode by default, WU-1329)     |

### Memory & Session

| Command              | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `agent-issues-query` | Query logged issues from agent sessions                       |
| `agent-log-issue`    | Log an issue encountered during agent work                    |
| `agent-session`      | Start an agent session for a WU                               |
| `agent-session-end`  | End an agent session                                          |
| `mem-checkpoint`     | Create a checkpoint node for context snapshots                |
| `mem-cleanup`        | Prune closed memory nodes based on lifecycle policy and TTL   |
| `mem-context`        | Generate context injection block for wu:spawn prompts         |
| `mem-create`         | Create a memory node with optional provenance tracking        |
| `mem-delete`         | Delete memory nodes (soft delete via metadata.status=deleted) |
| `mem-export`         | Export memory nodes as markdown or JSON                       |
| `mem-inbox`          | Read coordination signals from other agents                   |
| `mem-init`           | Initialize memory layer in repository                         |
| `mem-ready`          | Query ready nodes for a WU (deterministic ordering)           |
| `mem-signal`         | Send a coordination signal to other agents                    |
| `mem-start`          | Create a session node linked to a WU                          |
| `mem-summarize`      | Rollup older memory nodes into summary nodes for compaction   |
| `mem-triage`         | Review discovery nodes and promote to WUs or archive          |

### Initiative Orchestration

| Command                      | Description                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `initiative-add-wu`          | Link a WU to an initiative bidirectionally                         |
| `initiative-bulk-assign-wus` | Bulk-assign orphaned WUs to initiatives based on lane prefix rules |
| `initiative-create`          | Create a new Initiative with micro-worktree isolation (race-safe)  |
| `initiative-edit`            | Edit Initiative YAML files with micro-worktree isolation           |
| `initiative-list`            | List all initiatives with progress percentages                     |
| `initiative-plan`            | Link a plan file to an initiative                                  |
| `initiative-status`          | Show detailed initiative view with phases and WUs                  |
| `orchestrate-init-status`    | Show initiative orchestration status                               |
| `orchestrate-initiative`     | Orchestrate initiative execution with agents                       |
| `orchestrate-monitor`        | Monitor spawned agent progress and signals                         |
| `spawn-list`                 | Display spawn trees for WUs or initiatives                         |

### Metrics & Analytics

| Command            | Description                                     |
| ------------------ | ----------------------------------------------- |
| `flow-bottlenecks` | Identify workflow bottlenecks and critical path |
| `flow-report`      | Generate DORA metrics flow report               |
| `metrics`          | Unified Metrics CLI with subcommands (WU-1110)  |
| `metrics-snapshot` | Capture current metrics snapshot for dashboards |

### Lane Tooling

| Command        | Description                                        |
| -------------- | -------------------------------------------------- |
| `lane-health`  | Check lane configuration health (WU-1188)          |
| `lane-suggest` | Suggest lane definitions based on codebase context |

### Verification & Gates

| Command | Description                                                                                |
| ------- | ------------------------------------------------------------------------------------------ |
| `gates` | Run quality gates with support for docs-only mode, incremental linting, and tiered testing |

### System & Setup

| Command                    | Description                                                                       |
| -------------------------- | --------------------------------------------------------------------------------- |
| `backlog-prune`            | Backlog Prune Command                                                             |
| `deps-add`                 | Deps Add CLI Command                                                              |
| `deps-remove`              | Deps Remove CLI Command                                                           |
| `init-plan`                | Link a plan file to an initiative                                                 |
| `lumenflow`                | Initialize LumenFlow in a project\n\n                                             |
| `lumenflow-commands`       | List all available LumenFlow CLI commands                                         |
| `lumenflow-docs-sync`      | Sync agent onboarding docs to existing projects (skips existing files by default) |
| `lumenflow-doctor`         | Check LumenFlow safety components and configuration                               |
| `lumenflow-init`           | Initialize LumenFlow in a project\n\n                                             |
| `lumenflow-integrate`      | Integrate LumenFlow enforcement with AI client tools                              |
| `lumenflow-metrics`        | Unified Metrics CLI with subcommands (WU-1110)                                    |
| `lumenflow-release`        | Release Command                                                                   |
| `lumenflow-sync-templates` | Sync internal docs to CLI templates for release-cycle maintenance                 |
| `lumenflow-upgrade`        | LumenFlow Upgrade CLI Command                                                     |
| `lumenflow-validate`       |                                                                                   |
| `plan-create`              | Create a new plan file in repo plansDir                                           |
| `plan-edit`                | Edit a section in a plan file                                                     |
| `plan-link`                | Link a plan file to a WU or initiative                                            |
| `plan-promote`             | Promote a plan to approved status                                                 |
| `signal-cleanup`           | Prune old signals based on TTL policy to prevent unbounded growth                 |
| `state-bootstrap`          | State Bootstrap Command                                                           |
| `state-cleanup`            | Orchestrate all state cleanup: signals, memory, events                            |
| `state-doctor`             | Check state integrity and optionally repair issues                                |
| `sync-templates`           | Sync internal docs to CLI templates for release-cycle maintenance                 |
| `validate`                 |                                                                                   |

### File & Git Operations

| Command       | Description          |
| ------------- | -------------------- |
| `file-delete` | File Delete CLI Tool |
| `file-edit`   | File Edit CLI Tool   |
| `file-read`   | File Read CLI Tool   |
| `file-write`  | File Write CLI Tool  |
| `git-branch`  | Git Branch CLI Tool  |
| `git-diff`    | Git Diff CLI Tool    |
| `git-log`     | Git Log CLI Tool     |
| `git-status`  | Git Status CLI Tool  |

<!-- END AUTO-GENERATED SECTION -->

## Usage

Commands are typically invoked via pnpm scripts in your project:

```bash
# WU workflow
pnpm wu:claim --id WU-123 --lane operations
pnpm wu:done --id WU-123

# Memory operations
pnpm mem:checkpoint "Completed port definitions" --wu WU-123
pnpm mem:inbox --since 10m

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

## MCP Server Setup (Claude Code)

LumenFlow provides an MCP (Model Context Protocol) server for deep integration with Claude Code.

When you run `lumenflow init --client claude`, a `.mcp.json` is automatically created:

```json
{
  "mcpServers": {
    "lumenflow": {
      "command": "npx",
      "args": ["@lumenflow/mcp"]
    }
  }
}
```

The `@lumenflow/mcp` server provides tools for WU lifecycle, memory coordination, and lane management directly within Claude Code.

See [AI Integrations](https://lumenflow.dev/guides/ai-integrations) for full MCP documentation.

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
