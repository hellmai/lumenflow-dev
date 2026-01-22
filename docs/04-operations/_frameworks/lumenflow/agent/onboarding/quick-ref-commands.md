# Quick Reference: LumenFlow Commands

**Last updated:** 2026-01-21

---

## Project Setup

| Command                                       | Description                             |
| --------------------------------------------- | --------------------------------------- |
| `pnpm exec lumenflow init`                    | Scaffold minimal LumenFlow core         |
| `pnpm exec lumenflow init --full`             | Add docs/04-operations task scaffolding |
| `pnpm exec lumenflow init --framework <name>` | Add framework hint + overlay docs       |
| `pnpm exec lumenflow init --force`            | Overwrite existing files                |

---

## WU Management

| Command                                                                                                                                                                                                                      | Description                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm wu:create --id WU-XXX --lane <Lane> --title "Title" --description "..." --acceptance "..." --code-paths "path" --test-paths-unit "path" --exposure backend-only --spec-refs "docs/04-operations/plans/WU-XXX-plan.md"` | Create new WU (fully specified)                      |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`                                                                                                                                                                                    | Claim WU, update canonical state, create worktree    |
| `pnpm wu:spawn --id WU-XXX --client <client>`                                                                                                                                                                                | Spawn agent prompt with client guidance              |
| `pnpm wu:edit --id WU-1039 --exposure backend-only`                                                                                                                                                                          | Edit WU spec (supports exposure updates on done WUs) |
| `pnpm wu:done --id WU-XXX`                                                                                                                                                                                                   | Complete WU (merge, stamp, cleanup)                  |
| `pnpm wu:block --id WU-XXX --reason "Reason"`                                                                                                                                                                                | Block a WU                                           |
| `pnpm wu:unblock --id WU-XXX`                                                                                                                                                                                                | Unblock a WU                                         |
| `pnpm wu:cleanup --artifacts`                                                                                                                                                                                                | Remove build artifacts in current worktree           |

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
pnpm wu:create --id WU-001 --lane "Framework: Core" --title "Add feature" \
  --description "Context: ...\nProblem: ...\nSolution: ..." \
  --acceptance "Criterion 1" --acceptance "Criterion 2" \
  --code-paths "packages/@lumenflow/core/src/example.ts" \
  --test-paths-unit "packages/@lumenflow/core/__tests__/example.test.ts" \
  --exposure backend-only \
  --spec-refs "docs/04-operations/plans/WU-001-plan.md"
pnpm wu:claim --id WU-001 --lane "Framework: Core"
cd worktrees/framework-core-wu-001

# 2. Work (TDD)
# ... write tests first, then code ...

# 3. Commit
git add .
git commit -m "feat: add feature"
git push origin lane/framework-core/wu-001

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
