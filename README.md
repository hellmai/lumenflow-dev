<div align="center">

# LumenFlow

**The governance layer between AI agents and the world.**

[![npm version](https://img.shields.io/npm/v/@lumenflow/cli.svg?color=0366d6)](https://www.npmjs.com/package/@lumenflow/cli)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-lumenflow.dev-8b5cf6.svg)](https://lumenflow.dev)

LumenFlow is an open-source runtime kernel for AI agents.<br/>
It controls what agents can do, proves what they did,<br/>
and enforces policies they can't bypass.

[Get Started](#quick-start) &bull; [Documentation](https://lumenflow.dev) &bull; [Medium Article](https://medium.com/@hellmai)

</div>

---

## The Problem

AI agents today operate in the wild. They call tools with no scoping, leave no audit trail, and the only safety mechanism is "trust the prompt." Every agent framework gives agents tools -- none governs _how_ those tools are used.

The more autonomous agents become, the more they need an execution boundary that's enforced by the system, not hoped for in a system prompt.

## The Solution

LumenFlow is the missing kernel between AI agents and the real world. Like an OS kernel mediates between programs and hardware, LumenFlow mediates between agents and everything they touch -- filesystem, git, APIs, databases, cloud services.

```
  Programs → OS Kernel → Hardware
  AI Agents → LumenFlow → The World
```

### Four Guarantees

| Guarantee                      | How                                                           |
| ------------------------------ | ------------------------------------------------------------- |
| **Agents can't go off-script** | 4-level scope intersection: workspace > lane > task > tool    |
| **Every action is provable**   | Immutable evidence receipts with content-addressed inputs     |
| **Policies are inescapable**   | Deny-wins cascade evaluated at every tool call                |
| **Isolation is OS-enforced**   | bwrap sandbox with write confinement and secret deny overlays |

## Architecture

```
┌───────────────────────────────────────────────┐
│              AI AGENTS                         │
│     Claude  ·  GPT  ·  Gemini  ·  Custom      │
└──────────────────────┬────────────────────────┘
                       │
              ┌────────▼────────┐
              │    SURFACES     │
              │  CLI · MCP · API │
              └────────┬────────┘
                       │
┏━━━━━━━━━━━━━━━━━━━━━━▼━━━━━━━━━━━━━━━━━━━━━━━┓
┃         LUMENFLOW KERNEL                       ┃
┃                                                ┃
┃  TaskEngine · ToolHost · PolicyEngine          ┃
┃  EvidenceStore · Sandbox · EventStore          ┃
┃                                                ┃
┗━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┛
                       │
         ┌─────────────┼─────────────┐
         │             │             │
  ┌──────▼──────┐ ┌────▼─────┐ ┌────▼─────┐
  │  SOFTWARE   │ │ CUSTOMER │ │  YOUR    │
  │  DELIVERY   │ │ SUPPORT  │ │  DOMAIN  │
  │  PACK       │ │ PACK     │ │  PACK    │
  └──────┬──────┘ └────┬─────┘ └────┬─────┘
         │             │             │
  ┌──────▼─────────────▼─────────────▼──────┐
  │            THE WORLD                     │
  │  filesystem · git · APIs · databases     │
  └─────────────────────────────────────────┘
```

The kernel is **domain-agnostic**. Software delivery is "pack #1" -- a plugin that loads git tools, worktree isolation, quality gates, and lane-based work partitioning into the kernel. You can build packs for any domain.

## Quick Start

```bash
npx lumenflow init
```

LumenFlow scaffolds into your existing repo with:

- Git hooks that enforce workflow compliance
- Quality gates (format, lint, typecheck, test)
- Work Unit templates and state management
- Agent onboarding docs that teach your AI the workflow

### Your First Work Unit

```bash
# Create a task
pnpm wu:create --lane "Framework: Core" --title "Add user authentication"

# Claim it (creates an isolated git worktree)
pnpm wu:claim --id WU-42

# Work in the worktree, then complete
pnpm wu:prep --id WU-42     # run gates, validate
pnpm wu:done --id WU-42     # merge to main, cleanup
```

## Key Features

### Scoped Tool Execution

Every tool call passes through a 4-level scope intersection: workspace, lane, task, and tool-level permissions must all agree before execution proceeds. An agent can only use tools its current task allows, in the directories its lane permits.

### Immutable Evidence

Every tool execution produces an evidence receipt -- a cryptographic record of what was requested, what was allowed, what was enforced, and the content-addressed inputs. These receipts are append-only and tamper-evident.

### Policy Engine

Policies cascade through four levels (workspace, lane, pack, task) with deny-wins semantics. A restrictive policy at any level cannot be loosened by a lower level. Policies are evaluated at every tool call, not just at task boundaries.

### OS-Level Sandbox

Tool execution runs inside a bwrap sandbox with write confinement. Secrets directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, `.env`) are blocked with deny overlays. The sandbox is enforced by the OS, not by the agent runtime.

### Worktree Isolation

Every task gets its own git worktree. Agents work in isolation without polluting `main`. Multiple agents can work in parallel on different tasks without stepping on each other.

### Memory & Context Recovery

Sessions get checkpointed automatically. When an AI agent hits context limits, LumenFlow restores the working context -- what task they're on, what's left to do, and what happened before.

### Multi-Agent Coordination

Multiple AI agents can work the same codebase simultaneously. Lane-based work partitioning, branch locking, and memory signals prevent conflicts. Agents can delegate sub-tasks to other agents with full context handoff.

## Packages

### Kernel

| Package                                                                 | Description                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`@lumenflow/kernel`](packages/@lumenflow/kernel)                       | Task engine, tool host, policy engine, evidence store, sandbox     |
| [`@lumenflow/runtime`](packages/@lumenflow/runtime)                     | Daemon process: scheduler, session manager, Unix socket transport  |
| [`@lumenflow/control-plane-sdk`](packages/@lumenflow/control-plane-sdk) | Interface for remote policy sync and fleet management (Apache 2.0) |

### Packs

| Package                                                                             | Description                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`@lumenflow/packs/software-delivery`](packages/@lumenflow/packs/software-delivery) | Git tools, worktree isolation, quality gates, lane locking |

### Surfaces

| Package                                                       | Description                                      |
| ------------------------------------------------------------- | ------------------------------------------------ |
| [`@lumenflow/surfaces/cli`](packages/@lumenflow/surfaces/cli) | CLI surface for terminal-based agent interaction |
| [`@lumenflow/surfaces/mcp`](packages/@lumenflow/surfaces/mcp) | MCP surface for IDE integration                  |

### Workflow (Software Delivery Pack)

| Package                                                     | Description                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| [`@lumenflow/core`](packages/@lumenflow/core)               | WU state machine, validators, git adapters, spawn management   |
| [`@lumenflow/cli`](packages/@lumenflow/cli)                 | 60+ CLI commands: wu:claim, wu:done, gates, metrics, and more  |
| [`@lumenflow/memory`](packages/@lumenflow/memory)           | Session tracking, context recovery, agent coordination signals |
| [`@lumenflow/agent`](packages/@lumenflow/agent)             | Agent definitions, skill loading, delegation, verification     |
| [`@lumenflow/initiatives`](packages/@lumenflow/initiatives) | Multi-phase project orchestration across WUs and lanes         |
| [`@lumenflow/metrics`](packages/@lumenflow/metrics)         | DORA metrics, flow analysis, cycle time tracking               |
| [`@lumenflow/shims`](packages/@lumenflow/shims)             | Git and pnpm safety shims for hook enforcement                 |
| [`@lumenflow/mcp`](packages/@lumenflow/mcp)                 | Model Context Protocol server for IDE integration              |
| [`lumenflow`](packages/lumenflow)                           | Convenience wrapper so `npx lumenflow init` works              |

## Agent Integrations

LumenFlow works with any AI coding agent. First-class support for:

- **Claude Code** -- hooks, skills, agents, and MCP server
- **Codex** -- worktree-based parallel execution
- **Custom agents** -- `lumenflow init --client <name>` scaffolds agent-specific config

```bash
# Scaffold for Claude Code
npx lumenflow init --client claude-code

# Scaffold for a custom agent
npx lumenflow init --client my-agent
```

## GitHub Action

Run LumenFlow gates in CI with language-specific presets:

```yaml
- uses: hellmai/lumenflow-gates@v1
  with:
    preset: node # node | python | go | rust
```

## Prerequisites

| Tool    | Version | Install                             |
| ------- | ------- | ----------------------------------- |
| Node.js | >= 22   | [nodejs.org](https://nodejs.org/)   |
| pnpm    | >= 9    | `npm install -g pnpm`               |
| Git     | >= 2.0  | [git-scm.com](https://git-scm.com/) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, CLA details, and development setup.

## License

LumenFlow uses a dual-license model:

- **Kernel, packs, surfaces, runtime** -- [AGPL-3.0](LICENSE)
- **Control Plane SDK** -- [Apache-2.0](packages/@lumenflow/control-plane-sdk/LICENSE)

---

<div align="center">

Built by [HellmAI](https://hellm.ai)

</div>
