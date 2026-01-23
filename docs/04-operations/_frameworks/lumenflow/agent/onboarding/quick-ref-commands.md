# Quick Reference: LumenFlow Commands

**Last updated:** 2026-01-23

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

| Command                                                                                                                                                                                                               | Description                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm wu:create --id WU-XXX --lane <Lane> --title "Title" --description "..." --acceptance "..." --code-paths "path" --test-paths-unit "path" --exposure backend-only --spec-refs "lumenflow://plans/WU-XXX-plan.md"` | Create new WU (default: spec branch mode)            |
| `pnpm wu:create ... --direct`                                                                                                                                                                                         | Create WU directly on main (legacy/emergency)        |
| `pnpm wu:create ... --plan`                                                                                                                                                                                           | Also create plan template in $LUMENFLOW_HOME/plans/  |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`                                                                                                                                                                             | Claim WU (auto-merges spec branch if needed)         |
| `pnpm wu:spawn --id WU-XXX --client <client>`                                                                                                                                                                         | Spawn sub-agent prompt with client guidance          |
| `pnpm wu:edit --id WU-1039 --exposure backend-only`                                                                                                                                                                   | Edit WU spec (supports exposure updates on done WUs) |
| `pnpm wu:done --id WU-XXX`                                                                                                                                                                                            | Complete WU (merge, stamp, cleanup) - primary method |
| `pnpm wu:block --id WU-XXX --reason "Reason"`                                                                                                                                                                         | Block a WU                                           |
| `pnpm wu:unblock --id WU-XXX`                                                                                                                                                                                         | Unblock a WU                                         |
| `pnpm wu:cleanup --id WU-XXX`                                                                                                                                                                                         | PR-only: cleanup after PR merge (see note below)     |
| `pnpm wu:cleanup --artifacts`                                                                                                                                                                                         | Remove build artifacts in current worktree           |

### wu:done vs wu:cleanup

**IMPORTANT:** Use `wu:done` for completing WUs. `wu:cleanup` is NOT a replacement for `wu:done`.

| Command        | Purpose                                      | When to Use                              |
| -------------- | -------------------------------------------- | ---------------------------------------- |
| `wu:done`      | Complete WU: run gates, merge, stamp, push   | Always use this to finish a WU           |
| `wu:cleanup`   | Remove worktree/branch after PR merge        | PR-based workflows only (rare)           |

**wu:cleanup is PR-only:** When `gh` CLI is available, `wu:cleanup` requires the PR to be merged before it will run. It checks the PR merge status via GitHub API and blocks if the PR is not merged. This prevents accidental cleanup of work-in-progress WUs.

**Common mistake:** Agents sometimes try to run `wu:cleanup` after `wu:done` fails. This is incorrect. If `wu:done` fails:
1. Fix the underlying issue (gate failures, merge conflicts, etc.)
2. Re-run `wu:done --id WU-XXX`

Do NOT use `wu:cleanup` to work around `wu:done` failures.

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
# 1. Create (default: spec branch mode, never writes to main)
pnpm wu:create --id WU-001 --lane "Framework: Core" --title "Add feature" \
  --description "Context: ...\nProblem: ...\nSolution: ..." \
  --acceptance "Criterion 1" --acceptance "Criterion 2" \
  --code-paths "packages/@lumenflow/core/src/example.ts" \
  --test-paths-unit "packages/@lumenflow/core/__tests__/example.test.ts" \
  --exposure backend-only \
  --spec-refs "lumenflow://plans/WU-001-plan.md"

# 2. Claim (auto-merges spec/wu-001 to main, creates worktree)
pnpm wu:claim --id WU-001 --lane "Framework: Core"
cd worktrees/framework-core-wu-001

# 3. Work (TDD)
# ... write tests first, then code ...

# 4. Commit
git add .
git commit -m "feat: add feature"
git push origin lane/framework-core/wu-001

# 5. Gates
pnpm gates

# 6. Complete
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
