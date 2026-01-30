# Quick Reference: LumenFlow Commands

**Last updated:** 2026-01-30

Complete reference for all CLI commands. Organized by category for quick discovery.

---

## Setup & Development

| Command               | Description                             |
| --------------------- | --------------------------------------- |
| `pnpm setup`          | Install deps and build CLI (first time) |
| `pnpm build`          | Build all packages                      |
| `pnpm build:dist`     | Build distribution packages             |
| `pnpm dev`            | Start development mode                  |
| `pnpm clean`          | Clean build artifacts and caches        |
| `pnpm pack:all`       | Pack all packages for distribution      |
| `pnpm lumenflow:init` | Scaffold LumenFlow in a project         |
| `pnpm docs:sync`        | Sync agent docs (for upgrades)          |
| `pnpm sync:templates`   | Sync templates to project               |
| `pnpm lumenflow:upgrade`| Upgrade LumenFlow packages              |
| `pnpm lumenflow:doctor` | Diagnose LumenFlow configuration        |
| `pnpm init:plan`        | Initialize planning workspace           |

---

## WU Lifecycle

| Command                                       | Description                                   |
| --------------------------------------------- | --------------------------------------------- |
| `pnpm wu:create --id WU-XXX --lane <Lane> ..` | Create new WU spec                            |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`     | Claim WU and create worktree                  |
| `pnpm wu:prep --id WU-XXX`                    | Run gates in worktree, prep for wu:done       |
| `pnpm wu:done --id WU-XXX`                    | Complete WU (merge, stamp, cleanup) from main |
| `pnpm wu:edit --id WU-XXX --field value`      | Edit WU spec fields                           |
| `pnpm wu:block --id WU-XXX --reason "..."`    | Block WU with reason                          |
| `pnpm wu:unblock --id WU-XXX`                 | Unblock WU                                    |
| `pnpm wu:release --id WU-XXX`                 | Release orphaned WU (in_progress to ready)    |
| `pnpm wu:status --id WU-XXX`                  | Show WU status, location, valid commands      |
| `pnpm wu:spawn --id WU-XXX --client <client>` | Generate sub-agent spawn prompt               |

### WU Maintenance

| Command                          | Description                              |
| -------------------------------- | ---------------------------------------- |
| `pnpm wu:validate --id WU-XXX`   | Validate WU spec                         |
| `pnpm wu:preflight --id WU-XXX`  | Pre-flight checks before wu:done         |
| `pnpm wu:recover --id WU-XXX`    | Analyze and fix WU state inconsistencies |
| `pnpm wu:repair --id WU-XXX`     | Repair WU state issues                   |
| `pnpm wu:prune`                  | Clean stale worktrees                    |
| `pnpm wu:cleanup --id WU-XXX`    | Cleanup after PR merge (PR-only)         |
| `pnpm wu:deps --id WU-XXX`       | Show WU dependencies                     |
| `pnpm wu:infer-lane --id WU-XXX` | Infer lane from code paths/description   |
| `pnpm wu:delete --id WU-XXX`     | Delete WU spec and cleanup               |
| `pnpm wu:unlock-lane --lane <L>` | Unlock stuck lane                        |

---

## Gates & Quality

| Command                  | Description                      |
| ------------------------ | -------------------------------- |
| `pnpm gates`             | Run all quality gates            |
| `pnpm gates --docs-only` | Run gates for docs changes       |
| `pnpm format`            | Format all files (Prettier)      |
| `pnpm format:check`      | Check formatting without changes |
| `pnpm lint`              | Run ESLint                       |
| `pnpm typecheck`         | Run TypeScript type checking     |
| `pnpm test`              | Run all tests (Vitest)           |
| `pnpm spec:linter`       | Validate WU specs (all)          |
| `pnpm lane:health`                | Check lane config health            |
| `pnpm lane:suggest --paths "..."` | Suggest lane for code paths         |

---

## Memory & Sessions

| Command                             | Description                        |
| ----------------------------------- | ---------------------------------- |
| `pnpm mem:init --wu WU-XXX`         | Initialize memory for WU           |
| `pnpm mem:start --wu WU-XXX`        | Start a memory session             |
| `pnpm mem:checkpoint --wu WU-XXX`   | Save progress checkpoint           |
| `pnpm mem:ready --wu WU-XXX`        | Check pending nodes                |
| `pnpm mem:export --wu WU-XXX`       | Export memory as markdown          |
| `pnpm mem:create "msg" --wu WU-XXX` | Create memory node (bug discovery) |
| `pnpm mem:signal "msg" --wu WU-XXX` | Broadcast coordination signal      |
| `pnpm mem:inbox --wu WU-XXX`        | Check coordination signals         |
| `pnpm mem:summarize --wu WU-XXX`    | Summarize memory context           |
| `pnpm mem:triage --wu WU-XXX`       | Triage discovered bugs             |
| `pnpm mem:cleanup`                  | Clean up stale memory data         |

---

## State Management

| Command               | Description                 |
| --------------------- | --------------------------- |
| `pnpm state:doctor`   | Diagnose state store issues |
| `pnpm state:cleanup`  | Clean up stale state data   |
| `pnpm signal:cleanup` | Clean up stale signals      |
| `pnpm state:bootstrap`| Bootstrap state store       |
| `pnpm backlog:prune`  | Clean stale backlog entries |

---

## Dependencies

| Command                          | Description                    |
| -------------------------------- | ------------------------------ |
| `pnpm deps:add --pkg <name>`     | Add dependency to package      |
| `pnpm deps:remove --pkg <name>`  | Remove dependency from package |

---

## Initiatives

| Command                                     | Description                   |
| ------------------------------------------- | ----------------------------- |
| `pnpm initiative:create --id INIT-XXX ...`  | Create new initiative         |
| `pnpm initiative:edit --id INIT-XXX ...`    | Edit initiative fields        |
| `pnpm initiative:list`                      | List all initiatives          |
| `pnpm initiative:status --id INIT-XXX`      | Show initiative status        |
| `pnpm initiative:add-wu --id INIT-XXX ...`  | Add WU to initiative          |
| `pnpm initiative:plan --id INIT-XXX`        | Generate initiative plan      |
| `pnpm initiative:bulk-assign --id INIT-XXX` | Bulk assign WUs to initiative |

---

## Orchestration

| Command                                      | Description                      |
| -------------------------------------------- | -------------------------------- |
| `pnpm orchestrate:initiative --id INIT-XXX`  | Orchestrate initiative execution |
| `pnpm orchestrate:init-status --id INIT-XXX` | Compact initiative progress view |
| `pnpm orchestrate:monitor`                   | Monitor spawn/agent activity     |
| `pnpm spawn:list`                            | List active spawned agents       |

---

## Metrics & Flow

| Command                 | Description                  |
| ----------------------- | ---------------------------- |
| `pnpm flow:report`      | Generate flow metrics report |
| `pnpm flow:bottlenecks` | Identify flow bottlenecks    |
| `pnpm metrics:snapshot` | Capture metrics snapshot     |

---

## Documentation

| Command              | Description                |
| -------------------- | -------------------------- |
| `pnpm docs:generate` | Generate CLI documentation |
| `pnpm docs:validate` | Validate CLI documentation |

---

## Release

| Command                  | Description                     |
| ------------------------ | ------------------------------- |
| `pnpm release`           | Run release workflow            |
| `pnpm pre-release:check` | Pre-release validation checks   |
| `pnpm changeset`         | Create changeset for versioning |
| `pnpm version`           | Apply changeset versions        |
| `pnpm release:changeset` | Build and publish via changeset |

---

## Agent Utilities

| Command                   | Description                        |
| ------------------------- | ---------------------------------- |
| `pnpm agent:issues-query` | Query GitHub issues for agent work |

---

## Workflow Sequence (Quick Reference)

```bash
# 1. Create WU
pnpm wu:create --id WU-XXX --lane "Framework: Core" --title "Add feature" \
  --description "Context: ... Problem: ... Solution: ..." \
  --acceptance "Criterion 1" --code-paths "src/file.ts"

# 2. Claim (creates worktree)
pnpm wu:claim --id WU-XXX --lane "Framework: Core"
cd worktrees/framework-core-wu-xxx

# 3. Implement (TDD)
# ... write tests first, then code ...

# 4. Commit
git add . && git commit -m "feat: description"

# 5. Prep (runs gates in worktree)
pnpm wu:prep --id WU-XXX

# 6. Complete (from main - copy from wu:prep output)
cd /path/to/main && pnpm wu:done --id WU-XXX
```

---

## Key File Paths

| Path                                      | Description          |
| ----------------------------------------- | -------------------- |
| `docs/04-operations/tasks/wu/WU-XXX.yaml` | WU specification     |
| `docs/04-operations/tasks/status.md`      | Current status board |
| `docs/04-operations/tasks/backlog.md`     | Backlog summary      |
| `.lumenflow/stamps/WU-XXX.done`           | Completion stamp     |
| `worktrees/<lane>-wu-xxx/`                | Worktree directory   |

---

## Common Patterns

### wu:prep + wu:done (Two-Step Completion)

```bash
# From worktree: run gates, get instruction
pnpm wu:prep --id WU-XXX
# Output: cd /path/to/main && pnpm wu:done --id WU-XXX

# From main: merge, stamp, cleanup
cd /path/to/main && pnpm wu:done --id WU-XXX
```

### Memory Checkpoint (Progress Safety)

```bash
pnpm mem:checkpoint --wu WU-XXX  # Before risky operations
pnpm mem:inbox --since 30m       # Check for signals (NOT TaskOutput)
```

### Bug Discovery (Mid-WU)

```bash
# Capture bug, don't fix out-of-scope
pnpm mem:create 'Bug: description' --type discovery --tags bug --wu WU-XXX
```
