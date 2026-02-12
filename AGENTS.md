# Universal Agent Instructions

**Last updated:** 2026-02-06

> **Works with any AI coding assistant.** This file provides instructions that work regardless of which AI tool you're using—Claude Code, Cursor, Windsurf, Cline, Codex, Aider, or any other. Just read this file and follow the workflow.

This project uses LumenFlow workflow. For complete documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Quick Start (Local Worktree -- Default)

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

## Quick Start (Cloud / Branch-PR)

Cloud agents (Codex, Claude web, CI bots) that cannot use local worktrees use the **branch-pr** mode. This is a first-class lifecycle, not a workaround.

```bash
# 1. Create in cloud mode (optional if WU already exists)
pnpm wu:create --id WU-XXXX --lane <Lane> ... --cloud

# 2. Claim in cloud mode (creates lane branch, no worktree)
pnpm wu:claim --id WU-XXXX --lane <Lane> --cloud
# Or: LUMENFLOW_CLOUD=1 pnpm wu:claim --id WU-XXXX --lane <Lane>

# 3. Work on the lane branch in your cloud environment

# 4. Prep (validates branch, runs gates)
pnpm wu:prep --id WU-XXXX

# 5. Complete (creates PR instead of merging to main)
pnpm wu:done --id WU-XXXX
# Output: PR created. After merge, run: pnpm wu:cleanup --id WU-XXXX

# 6. Post-merge cleanup (after PR is merged)
pnpm wu:cleanup --id WU-XXXX
```

**Key differences from worktree mode:**

- `wu:claim --cloud` sets `claimed_mode: branch-pr` (no worktree created)
- `wu:create --cloud` writes WU specs on the active branch (no main checkout requirement)
- `wu:done` creates a PR instead of fast-forward merging to main
- `wu:cleanup` handles post-merge stamp creation and state updates
- `wu:recover` and `wu:repair` respect branch-pr claimed branches for recovery/admin fixes

> **Complete CLI reference:** See [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md)

---

## CLI Command Reference

### WU Lifecycle

| Command                                        | Description                                    |
| ---------------------------------------------- | ---------------------------------------------- |
| `pnpm wu:create --id WU-XXX --lane <Lane> ..`  | Create new WU spec                             |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`      | Claim WU and create worktree (default)         |
| `pnpm wu:claim --id WU-XXX --lane <L> --cloud` | Claim WU in cloud/branch-pr mode (no worktree) |
| `pnpm wu:prep --id WU-XXX`                     | Run gates, prep for wu:done                    |
| `pnpm wu:done --id WU-XXX`                     | Complete WU (merge or PR, stamp, cleanup)      |
| `pnpm wu:cleanup --id WU-XXX`                  | Post-merge cleanup (branch-pr mode)            |
| `pnpm wu:status --id WU-XXX`                   | Show WU status, location, valid commands       |
| `pnpm wu:block --id WU-XXX --reason "..."`     | Block WU with reason                           |
| `pnpm wu:unblock --id WU-XXX`                  | Unblock WU                                     |
| `pnpm wu:spawn --id WU-XXX --client <client>`  | Generate sub-agent spawn prompt                |
| `pnpm wu:recover --id WU-XXX`                  | Analyze and fix WU state inconsistencies       |

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

### Local (Worktree Mode -- Default)

| Step         | Location | Command                                                                                                                                                                                |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Create WU | main     | `pnpm wu:create --id WU-XXX --lane <Lane> --title "Title" --description "..." --acceptance "..." --code-paths "..." --test-paths-unit "..." --exposure backend-only --spec-refs "..."` |
| 2. Claim     | main     | `pnpm wu:claim --id WU-XXX --lane <Lane>`                                                                                                                                              |
| 3. Work      | worktree | `cd worktrees/<lane>-wu-xxx`                                                                                                                                                           |
| 4. Prep      | worktree | `pnpm wu:prep --id WU-XXX` (runs gates)                                                                                                                                                |
| 5. Complete  | main     | `pnpm wu:done --id WU-XXX` (copy-paste from wu:prep)                                                                                                                                   |

### Cloud (Branch-PR Mode)

| Step         | Location    | Command                                                   |
| ------------ | ----------- | --------------------------------------------------------- |
| 1. Create WU | lane branch | `pnpm wu:create --id WU-XXX --lane <Lane> ... --cloud`    |
| 2. Claim     | lane branch | `pnpm wu:claim --id WU-XXX --lane <Lane> --cloud`         |
| 3. Work      | lane branch | Work on `lane/<lane>/wu-xxx` in cloud environment         |
| 4. Prep      | lane branch | `pnpm wu:prep --id WU-XXX` (validates branch, runs gates) |
| 5. Complete  | lane branch | `pnpm wu:done --id WU-XXX` (creates PR)                   |
| 6. Cleanup   | after merge | `pnpm wu:cleanup --id WU-XXX` (post-merge stamps)         |

---

## Safety Reminders

- **Worktree Discipline**: After claiming a WU, immediately `cd` to the worktree
- **Main is read-only**: Do not edit files in the main checkout after claiming
- **Gates before done**: Always run `pnpm gates` before `wu:done`
- **Never skip hooks**: The `--no-verify` flag is forbidden
