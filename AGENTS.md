# Universal Agent Instructions

**Last updated:** 2026-01-29

> **Works with any AI coding assistant.** This file provides instructions that work regardless of which AI tool you're using—Claude Code, Cursor, Windsurf, Cline, Codex, Aider, or any other. Just read this file and follow the workflow.

This project uses LumenFlow workflow. For complete documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Quick Start

```bash
# 1. Claim a WU
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 2. Work in worktree, run gates
pnpm gates

# 3. Complete (ALWAYS run this!)
cd /home/tom/source/hellmai/os
pnpm wu:done --id WU-XXXX
```

---

## Critical: Always wu:done

After completing work, ALWAYS run `pnpm wu:done --id WU-XXXX` from the main checkout.

This is the single most forgotten step. See [LUMENFLOW.md](LUMENFLOW.md) for details.

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

| Step         | Command                                                    |
| ------------ | ---------------------------------------------------------- |
| 1. Create WU | `pnpm wu:create --id WU-XXX --lane <Lane> --title "Title"` |
| 2. Claim     | `pnpm wu:claim --id WU-XXX --lane <Lane>`                  |
| 3. Work      | `cd worktrees/<lane>-wu-xxx`                               |
| 4. Gates     | `pnpm gates`                                               |
| 5. Complete  | `pnpm wu:done --id WU-XXX`                                 |

---

## Safety Reminders

- **Worktree Discipline**: After claiming a WU, immediately `cd` to the worktree
- **Main is read-only**: Do not edit files in the main checkout after claiming
- **Gates before done**: Always run `pnpm gates` before `wu:done`
- **Never skip hooks**: The `--no-verify` flag is forbidden
