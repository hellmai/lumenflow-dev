# @lumenflow/cli

[![npm version](https://img.shields.io/npm/v/@lumenflow/cli.svg)](https://www.npmjs.com/package/@lumenflow/cli)
[![npm downloads](https://img.shields.io/npm/dm/@lumenflow/cli.svg)](https://www.npmjs.com/package/@lumenflow/cli)
[![license](https://img.shields.io/npm/l/@lumenflow/cli.svg)](https://github.com/hellmai/lumenflow-dev/blob/main/LICENSE)
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

| Command          | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| `wu-block`       | Block WU with reason                                          |
| `wu-brief`       | Generate handoff prompt for sub-agent WU execution            |
| `wu-claim`       | Claim WU and create worktree                                  |
| `wu-cleanup`     | Cleanup after PR merge                                        |
| `wu-create`      | Create new WU spec                                            |
| `wu-delegate`    | Generate delegation prompt and record explicit lineage intent |
| `wu-delete`      | Delete WU spec and cleanup                                    |
| `wu-deps`        | Show WU dependencies                                          |
| `wu-done`        | Complete WU (merge, stamp, cleanup) from main                 |
| `wu-edit`        | Edit WU spec fields                                           |
| `wu-infer-lane`  | Infer lane from code paths/description                        |
| `wu-preflight`   | Pre-flight checks before wu:done                              |
| `wu-prep`        | Run gates in worktree, prep for wu:done                       |
| `wu-proto`       | Create WU prototype                                           |
| `wu-prune`       | Clean stale worktrees                                         |
| `wu-recover`     | Analyze and fix WU state inconsistencies                      |
| `wu-release`     | Release orphaned WU (in_progress to ready)                    |
| `wu-repair`      | Repair WU state issues                                        |
| `wu-sandbox`     | Run command through hardened WU sandbox backend               |
| `wu-status`      | Show WU status, location, valid commands                      |
| `wu-unblock`     | Unblock WU                                                    |
| `wu-unlock-lane` | Unlock stuck lane                                             |
| `wu-validate`    | Validate WU spec                                              |

### Memory & Session

| Command          | Description                                |
| ---------------- | ------------------------------------------ |
| `mem-checkpoint` | Save progress checkpoint                   |
| `mem-cleanup`    | Clean up stale memory data                 |
| `mem-context`    | Get context for current lane/WU            |
| `mem-create`     | Create memory node (bug discovery)         |
| `mem-delete`     | Delete/archive a memory node               |
| `mem-export`     | Export memory as markdown                  |
| `mem-inbox`      | Check coordination signals                 |
| `mem-init`       | Initialize memory for WU                   |
| `mem-ready`      | Check pending memory nodes                 |
| `mem-recover`    | Generate recovery context after compaction |
| `mem-signal`     | Broadcast coordination signal              |
| `mem-start`      | Start a memory session                     |
| `mem-summarize`  | Summarize memory context                   |
| `mem-triage`     | Triage discovered bugs                     |
| `signal-cleanup` | Clean up stale signals                     |

### Initiative Orchestration

| Command                      | Description                                 |
| ---------------------------- | ------------------------------------------- |
| `agent-issues-query`         | Query GitHub issues for agent work          |
| `agent-log-issue`            | Log issue during agent session              |
| `agent-session`              | Start agent session                         |
| `agent-session-end`          | End agent session                           |
| `delegation-list`            | List active delegation records              |
| `initiative-add-wu`          | Add WU to initiative                        |
| `initiative-bulk-assign-wus` | Bulk assign WUs to initiative               |
| `initiative-create`          | Create new initiative                       |
| `initiative-edit`            | Edit initiative fields and phase metadata   |
| `initiative-list`            | List all initiatives                        |
| `initiative-plan`            | Link plan to initiative                     |
| `initiative-remove-wu`       | Remove WU from initiative                   |
| `initiative-status`          | Show initiative status                      |
| `orchestrate-init-status`    | Compact initiative progress view            |
| `orchestrate-initiative`     | Orchestrate initiative execution            |
| `orchestrate-monitor`        | Monitor spawn/agent activity                |
| `task-claim`                 | Claim a task directly through KernelRuntime |

### Metrics & Analytics

| Command             | Description                   |
| ------------------- | ----------------------------- |
| `flow-bottlenecks`  | Identify flow bottlenecks     |
| `flow-report`       | Generate flow metrics report  |
| `lumenflow-metrics` | View workflow metrics (alias) |
| `metrics`           | View workflow metrics         |
| `metrics-snapshot`  | Capture metrics snapshot      |

### Lane Tooling

| Command         | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| `lane-edit`     | Edit a lane definition (rename, wip-limit, paths, description) |
| `lane-health`   | Check lane config health                                       |
| `lane-lock`     | Lock lane lifecycle for delivery WUs                           |
| `lane-setup`    | Create/update draft lane artifacts                             |
| `lane-status`   | Show lane lifecycle status and next step                       |
| `lane-suggest`  | Suggest lane for code paths                                    |
| `lane-validate` | Validate lane artifacts before lock                            |

### Verification & Gates

| Command              | Description                   |
| -------------------- | ----------------------------- |
| `gates`              | Run all quality gates         |
| `lumenflow-gates`    | Run all quality gates (alias) |
| `lumenflow-validate` | Run validation checks (alias) |
| `validate`           | Run validation checks         |

### System & Setup

| Command                    | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `backlog-prune`            | Clean stale backlog entries                                         |
| `cloud-connect`            | Connect workspace.yaml to cloud control plane                       |
| `config-get`               | Read and display a value from workspace.yaml software_delivery      |
| `config-set`               | Safely update workspace.yaml software_delivery via micro-worktree   |
| `init-plan`                | Link plan to initiative (alias)                                     |
| `lumenflow`                | Initialize LumenFlow in a project                                   |
| `lumenflow-commands`       | List all available CLI commands                                     |
| `lumenflow-docs-sync`      | Sync agent docs (for upgrades) (alias)                              |
| `lumenflow-doctor`         | Diagnose LumenFlow configuration                                    |
| `lumenflow-init`           | Initialize LumenFlow in a project (alias)                           |
| `lumenflow-integrate`      | Generate enforcement hooks for client                               |
| `lumenflow-onboard`        | Legacy entrypoint; use "npx lumenflow" for bootstrap-all onboarding |
| `lumenflow-release`        | Run release workflow                                                |
| `lumenflow-sync-templates` | Sync templates to project                                           |
| `lumenflow-upgrade`        | Upgrade LumenFlow packages                                          |
| `onboard`                  | Legacy entrypoint; use "npx lumenflow" for bootstrap-all onboarding |
| `pack-author`              | Author a secure domain pack from templates                          |
| `pack-hash`                | Compute integrity hash for a domain pack                            |
| `pack-install`             | Install a domain pack into workspace                                |
| `pack-publish`             | Publish a domain pack to a registry                                 |
| `pack-scaffold`            | Scaffold a new domain pack                                          |
| `pack-search`              | Search for domain packs in a registry                               |
| `pack-validate`            | Validate a domain pack for integrity                                |
| `plan-create`              | Create a new plan                                                   |
| `plan-edit`                | Edit plan content                                                   |
| `plan-link`                | Link plan to WU or initiative                                       |
| `plan-promote`             | Promote plan to WU                                                  |
| `state-bootstrap`          | Bootstrap state store                                               |
| `state-cleanup`            | Clean up stale state data                                           |
| `state-doctor`             | Diagnose state store issues                                         |
| `sync-templates`           | Sync templates to project (alias)                                   |
| `workspace-init`           | Legacy entrypoint; use "npx lumenflow" for bootstrap-all onboarding |

### File & Git Operations

| Command       | Description                      |
| ------------- | -------------------------------- |
| `file-delete` | Delete file with audit trail     |
| `file-edit`   | Edit file with audit trail       |
| `file-read`   | Read file with audit trail       |
| `file-write`  | Write file with audit trail      |
| `git-branch`  | Show git branch with audit trail |
| `git-diff`    | Show git diff with audit trail   |
| `git-log`     | Show git log with audit trail    |
| `git-status`  | Show git status with audit trail |

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

**Important**: Always run `docs:sync` after package changes to update agent onboarding documentation, workflow rules, and vendor-specific configurations.

For current setup guidance and troubleshooting, see [LUMENFLOW.md](https://lumenflow.dev).

## License

Apache-2.0
