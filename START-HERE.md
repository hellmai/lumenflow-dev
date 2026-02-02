# Start Here

Welcome to the LumenFlow repository. This document helps you find the right starting point based on your role.

---

## Quick Navigation

| I am...                              | Read this first                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| An AI agent working in this repo     | [AGENTS.md](AGENTS.md)                                                                          |
| A developer setting up LumenFlow     | [Getting Started](#getting-started)                                                             |
| Debugging an issue                   | [Troubleshooting](#troubleshooting)                                                             |
| A maintainer releasing a new version | [Release Process](docs/04-operations/_frameworks/lumenflow/agent/onboarding/release-process.md) |

---

## Getting Started

### Prerequisites

- **Node.js** >= 22 ([download](https://nodejs.org/))
- **pnpm** >= 9 (`npm install -g pnpm`)
- **Git** >= 2.x

### Add LumenFlow to Your Project

```bash
# 1. Install and initialize
pnpm add -D @lumenflow/cli
pnpm exec lumenflow

# 2. Verify it worked
pnpm exec lumenflow-doctor
```

If `lumenflow doctor` shows "LumenFlow safety: ACTIVE", you're ready to go.

### Joining an Existing LumenFlow Repo

```bash
# 1. Clone and install
git clone https://github.com/your-org/your-repo.git
cd your-repo
pnpm setup

# 2. Verify installation
pnpm exec lumenflow doctor
```

---

## Workflow Overview

LumenFlow uses a **trunk-based development** workflow with **Work Units (WUs)**:

```
1. Create WU spec      ->  pnpm wu:create --id WU-XXX ...
2. Claim WU            ->  pnpm wu:claim --id WU-XXX --lane <Lane>
3. Work in worktree    ->  cd worktrees/<lane>-wu-xxx
4. Run gates           ->  pnpm gates
5. Complete WU         ->  pnpm wu:done --id WU-XXX
```

For detailed workflow documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Troubleshooting

### Common Issues

| Issue                             | Solution                           |
| --------------------------------- | ---------------------------------- |
| `lumenflow doctor` shows failures | Run `pnpm install && pnpm prepare` |
| "Husky hooks not installed"       | Run `pnpm prepare`                 |
| "AGENTS.md missing"               | Run `pnpm exec lumenflow`          |
| WU stuck in wrong state           | Run `pnpm wu:recover --id WU-XXX`  |

### Get Help

- **Documentation**: [docs/04-operations/\_frameworks/lumenflow/](docs/04-operations/_frameworks/lumenflow/)
- **Agent Onboarding**: [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/](docs/04-operations/_frameworks/lumenflow/agent/onboarding/)
- **Troubleshooting wu:done**: [troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md)

---

## File Structure

```
.
├── AGENTS.md           # Universal agent instructions
├── CLAUDE.md           # Claude Code specific instructions
├── LUMENFLOW.md        # Main workflow documentation
├── START-HERE.md       # This file
├── .lumenflow/
│   ├── constraints.md  # Non-negotiable rules
│   └── stamps/         # WU completion stamps
├── .clinerules         # Cline AI instructions
├── .cursor/rules/      # Cursor AI instructions
├── .windsurf/rules/    # Windsurf AI instructions
└── docs/
    └── 04-operations/
        └── _frameworks/
            └── lumenflow/  # Full LumenFlow documentation
```

---

## AI Coding Assistants

**LumenFlow works with any AI coding assistant.** Just point your AI at `AGENTS.md` and `LUMENFLOW.md`.

Enhanced integrations available for popular tools:

| Assistant   | Config File                    | Enhanced Features                 |
| ----------- | ------------------------------ | --------------------------------- |
| Claude Code | `CLAUDE.md`, `.claude/`        | Skills, agents, hooks, settings   |
| Cursor      | `.cursor/rules/lumenflow.md`   | Rules integration, auto-detection |
| Windsurf    | `.windsurf/rules/lumenflow.md` | Rules integration, auto-detection |
| Cline       | `.clinerules`                  | Rules file                        |
| Codex/Aider | `AGENTS.md`                    | Uses universal files directly     |

```bash
# Add enhanced integration for your AI (optional)
pnpm exec lumenflow --client claude   # or cursor, windsurf, cline, all
```

---

## Next Steps

1. Read [LUMENFLOW.md](LUMENFLOW.md) for the complete workflow
2. Run `lumenflow doctor` to verify your setup
3. Create your first WU with `pnpm wu:create`
