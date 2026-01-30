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
cd /home/USER/source/hellmai/os && pnpm wu:done --id WU-XXXX
```

> **Complete CLI reference:** See [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md)

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

- `git reset --hard`
- `git push --force`
- `git stash` (on main)
- `--no-verify`

---

## Vendor-Specific Overlays

This file provides universal guidance for all AI agents. Additional vendor-specific configuration:

- **Claude Code**: See `CLAUDE.md` (if present)
- **Cursor**: See `.cursor/rules/lumenflow.md` (if present)
- **Windsurf**: See `.windsurf/rules/lumenflow.md` (if present)
- **Cline**: See `.clinerules` (if present)

---

## Workflow Summary

| Step         | Location | Command                                                    |
| ------------ | -------- | ---------------------------------------------------------- |
| 1. Create WU | main     | `pnpm wu:create --id WU-XXX --lane <Lane> --title "Title"` |
| 2. Claim     | main     | `pnpm wu:claim --id WU-XXX --lane <Lane>`                  |
| 3. Work      | worktree | `cd worktrees/<lane>-wu-xxx`                               |
| 4. Prep      | worktree | `pnpm wu:prep --id WU-XXX` (runs gates)                    |
| 5. Complete  | main     | `pnpm wu:done --id WU-XXX` (copy-paste from wu:prep)       |

---

## Safety Reminders

- **Worktree Discipline**: After claiming a WU, immediately `cd` to the worktree
- **Main is read-only**: Do not edit files in the main checkout after claiming
- **Gates before done**: Always run `pnpm gates` before `wu:done`
- **Never skip hooks**: The `--no-verify` flag is forbidden
