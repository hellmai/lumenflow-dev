# Agent Safety Card

**Last updated:** 2026-01-19

Quick reference for AI agents working in LumenFlow projects.

---

## Stop and Ask When

- Same error repeats 3 times
- Auth or permissions changes needed
- PII/PHI/secrets involved
- Cloud spend decisions
- Policy changes required
- Anything feels irreversible

---

## Never Do

| Action                   | Why              |
| ------------------------ | ---------------- |
| `git reset --hard`       | Data loss        |
| `git push --force`       | History rewrite  |
| `--no-verify`            | Bypasses safety  |
| `git stash` (on main)    | Hides work       |
| `git clean -fd`          | Deletes files    |
| Work in main after claim | Breaks isolation |
| Skip wu:done             | Incomplete WU    |

---

## Always Do

| Action                     | Why              |
| -------------------------- | ---------------- |
| Read WU spec first         | Understand scope |
| cd to worktree after claim | Isolation        |
| Write tests before code    | TDD              |
| Run gates before wu:done   | Quality          |
| Run wu:done                | Complete WU      |
| Stay within code_paths     | Scope discipline |

---

## Error Handling

### Max 3 Attempts

If same error happens 3 times:

1. Stop trying
2. Document what happened
3. Ask for help

### Gate Failures

1. Read the error message
2. Fix the underlying issue
3. Re-run gates
4. Never use `--skip-gates` for new failures

---

## Quick Commands

```bash
# Check lane availability
cat docs/04-operations/tasks/status.md

# Claim a WU
pnpm wu:claim --id WU-XXX --lane <Lane>

# Work in worktree
cd worktrees/<lane>-wu-xxx

# Run gates
pnpm gates          # Code changes
pnpm gates --docs-only  # Docs changes

# Complete WU
cd /path/to/main
pnpm wu:done --id WU-XXX
```

---

## Completion Checklist

- [ ] Gates pass
- [ ] cd to main
- [ ] Run wu:done
- [ ] Verify success output
- [ ] Report completion

---

## When Uncertain

Choose the safer path:

- Don't modify files outside code_paths
- Don't bypass hooks
- Don't skip gates
- Ask rather than assume
