# {{VENDOR_NAME}} LumenFlow Rules

This project uses LumenFlow workflow. See [LUMENFLOW.md]({{LUMENFLOW_PATH}}).

## Critical Rules

1. **Always run wu:done** - After gates pass, run `pnpm wu:done --id WU-XXX`
2. **Work in worktrees** - After `wu:claim`, work only in the worktree
3. **Never bypass hooks** - No `--no-verify`
4. **TDD** - Write tests first

## Forbidden Commands

- `git reset --hard`
- `git push --force`
- `git stash` (on main)
- `--no-verify`

## Quick Reference

```bash
# Claim WU
pnpm wu:claim --id WU-XXX --lane <Lane>
cd worktrees/<lane>-wu-xxx

# Run gates
pnpm gates

# Complete (from main)
cd {{PROJECT_ROOT}}
pnpm wu:done --id WU-XXX
```

> **Complete CLI reference (60+ commands):** See [quick-ref-commands.md]({{QUICK_REF_PATH}})

## CLI Commands

### WU Lifecycle

| Command                                        | Description                                 |
| ---------------------------------------------- | ------------------------------------------- |
| `pnpm wu:status --id WU-XXX`                   | Show WU status, location, valid commands    |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`      | Claim WU and create worktree                |
| `pnpm wu:prep --id WU-XXX`                     | Run gates in worktree                       |
| `pnpm wu:done --id WU-XXX`                     | Complete WU (from main)                     |
| `pnpm wu:brief --id WU-XXX --client <client>`  | Generate handoff prompt (no execution)      |
| `pnpm wu:delegate --id WU-XXX --parent-wu <P>` | Generate prompt + record delegation lineage |
| `pnpm wu:recover --id WU-XXX`                  | Fix WU state inconsistencies                |
| `pnpm wu:escalate --id WU-XXX`                 | Show or resolve WU escalation status        |
| `pnpm wu:delete --id WU-XXX`                   | Delete WU spec and cleanup                  |

### Gates & Orchestration

| Command                                    | Description                                        |
| ------------------------------------------ | -------------------------------------------------- |
| `pnpm gates`                               | Run all quality gates                              |
| `pnpm lumenflow:commands`                  | List all public commands (primary + alias + legacy) |
| `pnpm mem:checkpoint --wu WU-XXX`          | Save progress checkpoint                           |
| `pnpm mem:recover --wu WU-XXX`             | Generate recovery context                          |

---

## Workflow Summary

| Step         | Command                                                          |
| ------------ | ---------------------------------------------------------------- |
| 1. Create WU | `pnpm wu:create --lane <Lane> --title "..."` (ID auto-generated) |
| 2. Claim     | `pnpm wu:claim --id WU-XXX --lane <Lane>`                        |
| 3. Work      | `cd worktrees/<lane>-wu-xxx`                                     |
| 4. Gates     | `pnpm gates`                                                     |
| 5. Complete  | `pnpm wu:done --id WU-XXX`                                       |

## Safety Reminders

- **Worktree Discipline**: After claiming a WU, immediately `cd` to the worktree
- **Main is read-only**: Do not edit files in the main checkout after claiming
- **Gates before done**: Always run `pnpm gates` before `wu:done`
- **Never skip hooks**: The `--no-verify` flag is forbidden
