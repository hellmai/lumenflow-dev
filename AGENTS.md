# Universal Agent Instructions

**Last updated:** 2026-01-30

> **Works with any AI coding assistant.** This file provides instructions that work regardless of which AI tool you're using—Claude Code, Cursor, Windsurf, Cline, Codex, Aider, or any other. Just read this file and follow the workflow.

This project uses LumenFlow workflow. For complete documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Quick Start

```bash
# 1. Claim a WU
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 2. Work in worktree

# 3. Prep (WU-1223: runs gates in worktree)
pnpm wu:prep --id WU-XXXX
# This prints a copy-paste command for step 4

# 4. Complete (from main - copy-paste from wu:prep output)
cd <project-root> && pnpm wu:done --id WU-XXXX
```

> **Complete CLI reference:** See [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md)

---

## CLI Command Reference

### WU Lifecycle

| Command                                       | Description                                   |
| --------------------------------------------- | --------------------------------------------- |
| `pnpm wu:create --id WU-XXX --lane <Lane> ..` | Create new WU spec                            |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`     | Claim WU and create worktree                  |
| `pnpm wu:prep --id WU-XXX`                    | Run gates in worktree, prep for wu:done       |
| `pnpm wu:done --id WU-XXX`                    | Complete WU (merge, stamp, cleanup) from main |
| `pnpm wu:status --id WU-XXX`                  | Show WU status, location, valid commands      |
| `pnpm wu:block --id WU-XXX --reason "..."`    | Block WU with reason                          |
| `pnpm wu:unblock --id WU-XXX`                 | Unblock WU                                    |
| `pnpm wu:spawn --id WU-XXX --client <client>` | Generate sub-agent spawn prompt               |
| `pnpm wu:recover --id WU-XXX`                 | Analyze and fix WU state inconsistencies      |

### Gates & Quality

| Command                  | Description                  |
| ------------------------ | ---------------------------- |
| `pnpm gates`             | Run all quality gates        |
| `pnpm gates --docs-only` | Run gates for docs changes   |
| `pnpm format`            | Format all files (Prettier)  |
| `pnpm lint`              | Run ESLint                   |
| `pnpm typecheck`         | Run TypeScript type checking |
| `pnpm test`              | Run all tests (Vitest)       |

### Memory & Coordination

| Command                             | Description                        |
| ----------------------------------- | ---------------------------------- |
| `pnpm mem:checkpoint --wu WU-XXX`   | Save progress checkpoint           |
| `pnpm mem:inbox --since 30m`        | Check coordination signals         |
| `pnpm mem:signal "msg" --wu WU-XXX` | Broadcast coordination signal      |
| `pnpm mem:create "msg" --wu WU-XXX` | Create memory node (bug discovery) |
| `pnpm mem:context --wu WU-XXX`      | Get context for current lane/WU    |
| `pnpm mem:delete --id <node-id>`    | Delete/archive a memory node       |

### Orchestration & Initiatives

| Command                                    | Description                      |
| ------------------------------------------ | -------------------------------- |
| `pnpm orchestrate:init-status -i INIT-XXX` | Compact initiative progress view |
| `pnpm orchestrate:initiative -i INIT-XXX`  | Orchestrate initiative execution |
| `pnpm orchestrate:monitor`                 | Monitor spawn/agent activity     |
| `pnpm initiative:status --id INIT-XXX`     | Show initiative status           |

### State & Maintenance

| Command                          | Description                 |
| -------------------------------- | --------------------------- |
| `pnpm wu:prune`                  | Clean stale worktrees       |
| `pnpm wu:unlock-lane --lane <L>` | Unlock stuck lane           |
| `pnpm state:doctor`              | Diagnose state store issues |
| `pnpm backlog:prune`             | Clean stale backlog entries |

---

## Critical: Use wu:prep Then wu:done (WU-1223)

**Two-step completion:**

1. From worktree: `pnpm wu:prep --id WU-XXXX` (runs gates, prints copy-paste instruction)
2. From main: `pnpm wu:done --id WU-XXXX` (merge + cleanup only)

Do NOT run `wu:done` from a worktree (it will error). See [LUMENFLOW.md](LUMENFLOW.md) for details.

---

## Core Principles

1. **TDD**: Write tests first, then implementation
2. **Worktree Discipline**: After `wu:claim`, work ONLY in the worktree
3. **Gates Before Done**: Run `pnpm gates` before `wu:done`
4. **Never Bypass Hooks**: No `--no-verify`

---

## Forbidden Commands

**Destructive Git Operations** (never use directly):

- `git reset --hard`
- `git push --force`
- `git clean -fd` or `git clean -f`
- `git checkout .` (discards all changes)
- `git stash` (on main)
- `--no-verify`

**Worktree Management** (use `wu:` commands instead):

- `git worktree remove` (use `wu:done` or `wu:prune`)
- `git worktree prune` (use `wu:prune`)
- `git branch -D` on lane branches (use `wu:done`)

---

## Safe Alternatives

When you need to recover from problems, use these `wu:` commands instead of raw git:

| Instead of...                | Use...                            |
| ---------------------------- | --------------------------------- |
| `git worktree remove`        | `pnpm wu:done` or `pnpm wu:prune` |
| `git branch -D lane/...`     | `pnpm wu:done --id WU-XXX`        |
| Manually fixing WU state     | `pnpm wu:recover --id WU-XXX`     |
| Abandoning an in-progress WU | `pnpm wu:release --id WU-XXX`     |
| Cleaning stale worktrees     | `pnpm wu:prune`                   |

These commands handle the full cleanup safely (worktree removal, branch deletion, state updates).

---

## Vendor-Specific Overlays

This file provides universal guidance for all AI agents. Additional vendor-specific configuration:

- **Claude Code**: See `CLAUDE.md` (if present)
- **Cursor**: See `.cursor/rules/lumenflow.md` (if present)
- **Windsurf**: See `.windsurf/rules/lumenflow.md` (if present)
- **Cline**: See `.clinerules` (if present)

---

## Workflow Summary

| Step         | Location | Command                                                                                                                                                                                |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Create WU | main     | `pnpm wu:create --id WU-XXX --lane <Lane> --title "Title" --description "..." --acceptance "..." --code-paths "..." --test-paths-unit "..." --exposure backend-only --spec-refs "..."` |
| 2. Claim     | main     | `pnpm wu:claim --id WU-XXX --lane <Lane>`                                                                                                                                              |
| 3. Work      | worktree | `cd worktrees/<lane>-wu-xxx`                                                                                                                                                           |
| 4. Prep      | worktree | `pnpm wu:prep --id WU-XXX` (runs gates)                                                                                                                                                |
| 5. Complete  | main     | `pnpm wu:done --id WU-XXX` (copy-paste from wu:prep)                                                                                                                                   |

---

## Safety Reminders

- **Worktree Discipline**: After claiming a WU, immediately `cd` to the worktree
- **Main is read-only**: Do not edit files in the main checkout after claiming
- **Gates before done**: Always run `pnpm gates` before `wu:done`
- **Never skip hooks**: The `--no-verify` flag is forbidden
