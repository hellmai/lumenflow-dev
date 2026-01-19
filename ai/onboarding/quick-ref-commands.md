# Quick Reference: LumenFlow Commands

**Last updated:** 2026-01-19

---

## WU Management

| Command                                                    | Description                         |
| ---------------------------------------------------------- | ----------------------------------- |
| `pnpm wu:create --id WU-XXX --lane <Lane> --title "Title"` | Create new WU                       |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`                  | Claim WU and create worktree        |
| `pnpm wu:done --id WU-XXX`                                 | Complete WU (merge, stamp, cleanup) |
| `pnpm wu:block --id WU-XXX --reason "Reason"`              | Block a WU                          |
| `pnpm wu:unblock --id WU-XXX`                              | Unblock a WU                        |

---

## Gates

| Command                  | Description                |
| ------------------------ | -------------------------- |
| `pnpm gates`             | Run all quality gates      |
| `pnpm gates --docs-only` | Run gates for docs changes |
| `pnpm format`            | Format all files           |
| `pnpm lint`              | Run linter                 |
| `pnpm typecheck`         | Run TypeScript check       |
| `pnpm test`              | Run tests                  |

---

## Memory (Session Context)

| Command                           | Description                |
| --------------------------------- | -------------------------- |
| `pnpm mem:init --wu WU-XXX`       | Initialize memory for WU   |
| `pnpm mem:checkpoint --wu WU-XXX` | Save progress checkpoint   |
| `pnpm mem:ready --wu WU-XXX`      | Check pending nodes        |
| `pnpm mem:inbox --wu WU-XXX`      | Check coordination signals |

---

## Git (Safe Operations)

| Command                              | Description               |
| ------------------------------------ | ------------------------- |
| `git status`                         | Check working tree status |
| `git add .`                          | Stage all changes         |
| `git commit -m "type: message"`      | Commit with message       |
| `git push origin lane/<lane>/wu-xxx` | Push to remote            |
| `git fetch origin`                   | Fetch remote changes      |
| `git rebase origin/main`             | Update from main          |

---

## Navigation

```bash
# After claiming, go to worktree
cd worktrees/<lane>-wu-xxx

# Return to main for wu:done
cd /path/to/main
```

---

## Workflow Sequence

```bash
# 1. Create and claim
pnpm wu:create --id WU-001 --lane Core --title "Add feature"
pnpm wu:claim --id WU-001 --lane Core
cd worktrees/core-wu-001

# 2. Work (TDD)
# ... write tests first, then code ...

# 3. Commit
git add .
git commit -m "feat: add feature"
git push origin lane/core/wu-001

# 4. Gates
pnpm gates

# 5. Complete
cd /path/to/main
pnpm wu:done --id WU-001
```

---

## Commit Message Format

```
type(scope): description

Types: feat, fix, docs, style, refactor, test, chore
```

Examples:

- `feat(api): add user endpoint`
- `fix(auth): resolve token expiry`
- `docs: update README`
- `test: add unit tests for calculator`

---

## File Paths

| Path                                      | Description          |
| ----------------------------------------- | -------------------- |
| `docs/04-operations/tasks/wu/WU-XXX.yaml` | WU specification     |
| `docs/04-operations/tasks/status.md`      | Current status board |
| `.beacon/stamps/WU-XXX.done`              | Completion stamp     |
| `worktrees/<lane>-wu-xxx/`                | Worktree directory   |
