# @lumenflow/cli

Command-line interface for LumenFlow workflow management.

## Installation

```bash
npm install @lumenflow/cli
```

## Overview

This package provides CLI commands for the LumenFlow workflow framework, including:

- **WU (Work Unit) management**: Claim, complete, block, and track work units
- **Memory layer**: Session tracking, context recovery, and agent coordination
- **Initiative orchestration**: Multi-phase project coordination
- **Quality gates**: Pre-merge validation and checks

## Commands

### Work Unit Commands

| Command | Description |
|---------|-------------|
| `wu-claim` | Claim a WU and create a worktree |
| `wu-done` | Complete a WU (runs gates, merges, creates stamp) |
| `wu-block` | Mark a WU as blocked with reason |
| `wu-unblock` | Remove blocked status from a WU |
| `wu-create` | Create a new WU specification |
| `wu-edit` | Edit an existing WU specification |
| `wu-spawn` | Generate spawn prompt for delegating WU to sub-agent |
| `wu-validate` | Validate WU YAML against schema |
| `wu-preflight` | Pre-claim validation checks |
| `wu-repair` | Repair corrupted WU state |
| `wu-prune` | Clean up stale worktrees |
| `wu-cleanup` | Post-merge cleanup for a WU |
| `wu-deps` | Display WU dependency graph |
| `wu-infer-lane` | Infer lane from WU content |

### Memory Commands

| Command | Description |
|---------|-------------|
| `mem-init` | Initialize memory directory structure |
| `mem-start` | Start a new memory session |
| `mem-checkpoint` | Create a progress checkpoint |
| `mem-ready` | Query pending nodes for a WU |
| `mem-signal` | Send coordination signal to other agents |
| `mem-inbox` | Check incoming coordination signals |
| `mem-create` | Create a memory node |
| `mem-summarize` | Roll up nodes for context compaction |
| `mem-triage` | Triage discovered bugs |
| `mem-cleanup` | Clean up expired memory nodes |

### Initiative Commands

| Command | Description |
|---------|-------------|
| `initiative-create` | Create a new initiative |
| `initiative-edit` | Edit an existing initiative |
| `initiative-list` | List all initiatives |
| `initiative-status` | Show initiative status and progress |
| `initiative-add-wu` | Link a WU to an initiative |

### Other Commands

| Command | Description |
|---------|-------------|
| `gates` | Run quality gates (format, lint, typecheck, tests) |
| `spawn-list` | List active spawned agents |

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

## Integration

The CLI integrates with other LumenFlow packages:

- `@lumenflow/core` - Git operations, worktree management
- `@lumenflow/memory` - Session and context persistence
- `@lumenflow/agent` - Agent session management
- `@lumenflow/initiatives` - Initiative tracking

## Documentation

For complete documentation, see the [LumenFlow documentation](https://github.com/hellmai/os).

## License

Apache-2.0
