# Technical Documentation

Architecture, implementation guides, and package documentation for LumenFlow.

---

## Packages

LumenFlow is a monorepo with 7 packages:

| Package | Path | Description |
|---------|------|-------------|
| `@lumenflow/core` | `packages/@lumenflow/core` | Core WU types, validation, configuration |
| `@lumenflow/cli` | `packages/@lumenflow/cli` | 30+ CLI commands |
| `@lumenflow/memory` | `packages/@lumenflow/memory` | Session tracking, context recovery |
| `@lumenflow/agent` | `packages/@lumenflow/agent` | Agent coordination primitives |
| `@lumenflow/metrics` | `packages/@lumenflow/metrics` | Flow metrics and reporting |
| `@lumenflow/initiatives` | `packages/@lumenflow/initiatives` | Multi-WU project tracking |
| `@lumenflow/shims` | `packages/@lumenflow/shims` | Git safety shims |

---

## Apps

| App | Path | Description |
|-----|------|-------------|
| GitHub App | `apps/github-app` | Vercel-deployed webhook handler for PR validation |

---

## Architecture

See [architecture/](architecture/) for:

- System design
- Package relationships
- Data flow

---

## CLI Commands

The `@lumenflow/cli` package provides 30+ commands:

### WU Workflow

| Command | Description |
|---------|-------------|
| `wu-claim` | Claim a WU and create worktree |
| `wu-done` | Complete WU, run gates, merge |
| `wu-create` | Create new WU spec |
| `wu-edit` | Edit WU spec safely |
| `wu-block` | Block WU with reason |
| `wu-unblock` | Unblock WU |
| `wu-validate` | Validate WU spec |
| `wu-preflight` | Pre-claim validation |
| `wu-repair` | Repair broken WU state |
| `wu-prune` | Prune old worktrees |
| `wu-cleanup` | Clean up completed WUs |
| `wu-deps` | Show WU dependencies |
| `wu-spawn` | Spawn sub-agent for WU |
| `wu-infer-lane` | Infer lane from file paths |

### Memory Layer

| Command | Description |
|---------|-------------|
| `mem-init` | Initialize memory layer |
| `mem-checkpoint` | Create progress checkpoint |
| `mem-start` | Start new session |
| `mem-ready` | Query pending work |
| `mem-signal` | Send coordination signal |
| `mem-cleanup` | Clean up old memory |
| `mem-create` | Create memory node |
| `mem-inbox` | Check coordination inbox |
| `mem-summarize` | Summarize session |
| `mem-triage` | Triage discovered bugs |

### Initiatives

| Command | Description |
|---------|-------------|
| `initiative-create` | Create multi-WU initiative |
| `initiative-edit` | Edit initiative |
| `initiative-list` | List initiatives |
| `initiative-status` | Show initiative status |
| `initiative-add-wu` | Add WU to initiative |

### Other

| Command | Description |
|---------|-------------|
| `gates` | Run quality gates |
| `lumenflow-gates` | Alias for gates |
| `spawn-list` | List spawned agents |

---

**Last Updated:** 2026-01-18
