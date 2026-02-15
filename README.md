<div align="center">

# LumenFlow

**Give your AI agent a workflow it can't break.**

[![npm version](https://img.shields.io/npm/v/@lumenflow/cli.svg?color=0366d6)](https://www.npmjs.com/package/@lumenflow/cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-lumenflow.dev-8b5cf6.svg)](https://lumenflow.dev)

LumenFlow is a workflow framework for AI-native software development.<br/>
It gives coding agents structure they can follow, guardrails they can't bypass,<br/>
and memory that survives context windows.

[Get Started](#quick-start) &bull; [Documentation](https://lumenflow.dev) &bull; [Medium Article](https://medium.com/@hellmai)

</div>

---

## The Problem

AI coding agents are powerful but chaotic. They edit the wrong branch, forget what they were doing after context compaction, skip tests, push broken code, and have no concept of "done." The more autonomous you make them, the more they need structure.

## The Solution

LumenFlow wraps your AI agent's workflow in a state machine. Every task becomes a **Work Unit (WU)** that moves through a defined lifecycle: `ready` -> `in_progress` -> `done`. The framework enforces the rules at every step through git hooks, CLI validation, and quality gates -- so the agent literally _can't_ skip steps.

```
npx lumenflow init       # scaffold into any repo
lumenflow doctor         # verify safety is active
```

## Quick Start

```bash
npx lumenflow init
```

That's it. LumenFlow scaffolds into your existing repo with:

- Git hooks that enforce workflow compliance
- Quality gates (format, lint, typecheck, test)
- WU templates and state management
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

### Workflow Enforcement

Git hooks and CLI validation ensure agents can't edit outside their worktree, push without passing gates, or skip the completion ceremony. The rules aren't suggestions -- they're walls.

### Worktree Isolation

Every WU gets its own git worktree. Agents work in isolation without polluting `main`. Multiple agents can work in parallel on different WUs without stepping on each other.

### Memory & Context Recovery

Sessions get checkpointed automatically. When an AI agent hits context limits and compacts, LumenFlow restores the working context -- what WU they're on, what's left to do, and what happened before.

### Quality Gates

Format, lint, typecheck, and test gates run before any merge to main. Agents can't skip them. Pre-existing failures are distinguished from new ones so agents aren't blocked by tech debt they didn't create.

### Multi-Agent Coordination

Multiple AI agents can work the same codebase simultaneously. Lane-based work partitioning, branch locking, and memory signals prevent conflicts. Agents can delegate sub-tasks to other agents with full context handoff.

### Initiative Orchestration

Large projects spanning multiple WUs are coordinated through Initiatives. Break down an epic into phased WUs, track progress, and maintain dependency ordering across agents.

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                     Your Repository                      │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │ wu:create │──>│ wu:claim  │──>│ worktree │           │
│  │ (spec)    │   │ (branch)  │   │ (isolated)│           │
│  └──────────┘   └──────────┘   └────┬─────┘           │
│                                      │                   │
│                                      v                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │ wu:done   │<──│ wu:prep   │<──│  gates   │           │
│  │ (merge)   │   │ (validate)│   │ (quality) │           │
│  └──────────┘   └──────────┘   └──────────┘           │
│                                                         │
│  .lumenflow/          hooks/          worktrees/        │
│  ├── state/           ├── pre-commit  ├── wu-42/        │
│  ├── stamps/          ├── pre-push    └── wu-43/        │
│  └── memory/          └── commit-msg                    │
└─────────────────────────────────────────────────────────┘
```

## Packages

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

We use LumenFlow to build LumenFlow. To contribute:

1. Fork the repo
2. `pnpm install && pnpm build`
3. Create a WU: `pnpm wu:create --lane "Framework: Core" --title "Your change"`
4. Work in the worktree, pass gates, submit via `wu:done`

Project governance and contributor guidance:

- [Contributing Guide](.github/CONTRIBUTING.md)
- [Code of Conduct](.github/CODE_OF_CONDUCT.md)
- [Security Policy](.github/SECURITY.md)

Use the GitHub templates for submissions:

- [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md)
- [Pull Request Template](.github/pull_request_template.md)

## License

[Apache-2.0](LICENSE)

---

<div align="center">

Built by [HellmAI](https://hellm.ai)

</div>
