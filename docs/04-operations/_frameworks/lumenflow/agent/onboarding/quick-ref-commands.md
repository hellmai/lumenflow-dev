# Quick Reference: LumenFlow Commands

**Last updated:** 2026-02-25

Reference for CLI commands. Organized by category for quick discovery.

> **Rule (WU-1358, WU-1530):** Always run `<command> --help` before first use of any unfamiliar command.
> This document may not include all available options or may contain outdated examples.
>
> ```bash
> # Examples
> pnpm wu:edit --help      # See all wu:edit options
> npm run wu:claim -- --help
> yarn wu:create --help
> ```

## Help-First Usage Examples By Category

Run `--help` first, then run the real command with explicit flags.

| Category            | Help-First Example                    | Real Command Example                                                     |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Setup & Development | `pnpm bootstrap --help`               | `pnpm bootstrap`                                                         |
| Tooling Operations  | `pnpm lumenflow:upgrade --help`       | `pnpm lumenflow:upgrade --latest`                                        |
| WU Lifecycle        | `pnpm wu:claim --help`                | `pnpm wu:claim --id WU-1561 --lane "Operations: Tooling"`                |
| WU Maintenance      | `pnpm wu:recover --help`              | `pnpm wu:recover --id WU-1561`                                           |
| Gates & Quality     | `pnpm gates --help`                   | `pnpm gates --docs-only`                                                 |
| Memory & Sessions   | `pnpm mem:checkpoint --help`          | `pnpm mem:checkpoint --wu WU-1561`                                       |
| State Management    | `pnpm state:doctor --help`            | `pnpm state:doctor --json`                                               |
| Dependencies        | `pnpm deps:add --help`                | `pnpm deps:add --pkg zod`                                                |
| Plans               | `pnpm plan:link --help`               | `pnpm plan:link --id INIT-021 --plan lumenflow://plans/INIT-021-plan.md` |
| Initiatives         | `pnpm initiative:status --help`       | `pnpm initiative:status --id INIT-021`                                   |
| Orchestration       | `pnpm orchestrate:init-status --help` | `pnpm orchestrate:init-status --id INIT-021`                             |
| Metrics & Flow      | `pnpm flow:report --help`             | `pnpm flow:report`                                                       |
| Documentation       | `pnpm docs:validate --help`           | `pnpm docs:validate`                                                     |
| Release             | `pnpm pre-release:check --help`       | `pnpm pre-release:check`                                                 |
| Configuration       | `pnpm config:set --help`              | `pnpm config:set --key methodology.testing --value test-after`           |
| Agent Utilities     | `pnpm agent:session --help`           | `pnpm agent:session`                                                     |
| Packs               | `pnpm pack:install --help`            | `pnpm pack:install --name software-delivery`                             |

---

## Setup & Development

**For this monorepo (development):**

| Command                    | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `pnpm setup`               | Install deps and build CLI (first time)           |
| `pnpm bootstrap`           | Build CLI with dependency closure (worktree-safe) |
| `pnpm build`               | Build all packages                                |
| `pnpm build:dist`          | Build distribution packages                       |
| `pnpm dev`                 | Start development mode                            |
| `pnpm clean`               | Clean build artifacts and caches                  |
| `pnpm pack:all`            | Pack all packages for distribution                |
| `pnpm lumenflow:init`      | Scaffold LumenFlow in a project                   |
| `pnpm docs:sync`           | Sync agent docs (for upgrades)                    |
| `pnpm sync:templates`      | Sync templates to project                         |
| `pnpm lumenflow:upgrade`   | Upgrade LumenFlow packages                        |
| `pnpm lumenflow:doctor`    | Diagnose LumenFlow configuration                  |
| `pnpm lumenflow:integrate` | Generate enforcement hooks for client             |
| `pnpm cloud:connect`       | Configure cloud control-plane access              |
| `npx lumenflow commands`   | List all available CLI commands                   |

**For external projects (end users):**

```bash
# Install CLI
pnpm add -D @lumenflow/cli  # or: npm install -D @lumenflow/cli

# Initialize LumenFlow
pnpm exec lumenflow

# With client-specific overlays
pnpm exec lumenflow --client claude   # Claude Code
pnpm exec lumenflow --client cursor   # Cursor IDE
pnpm exec lumenflow --client all      # All clients
```

---

## Tooling Operations (No WU Required)

These commands use **micro-worktree isolation** internally — they handle their own
commit and push atomically. Do NOT wrap them in a WU or use raw `pnpm update`/`git commit`.

| Command                                           | Description                               |
| ------------------------------------------------- | ----------------------------------------- |
| `pnpm lumenflow:upgrade --version 3.5.0`          | Upgrade all 7 @lumenflow/\* packages      |
| `pnpm lumenflow:upgrade --latest`                 | Upgrade to latest version                 |
| `pnpm lumenflow:upgrade --latest --dry-run`       | Preview upgrade without executing         |
| `pnpm config:set --key <dotpath> --value <value>` | Set workspace.yaml config (Zod-validated) |
| `pnpm config:get --key <dotpath>`                 | Read workspace.yaml config                |
| `pnpm cloud:connect`                              | Configure cloud control-plane access      |
| `pnpm docs:sync`                                  | Sync agent docs after upgrade             |
| `pnpm sync:templates`                             | Sync templates to project                 |

**Key principle:** If a LumenFlow CLI command exists for the operation, use it instead of
raw pnpm/git. These tooling commands commit directly to main via micro-worktree — no dirty
files, no manual git, no WU ceremony. Only actual **code changes** need WUs.

> **Anti-pattern:** Do NOT use `pnpm update @lumenflow/*` to upgrade packages.
> This leaves dirty `package.json` and `pnpm-lock.yaml` on main.
> Use `pnpm lumenflow:upgrade` instead — it handles everything atomically.

---

## WU Lifecycle

| Command                                         | Description                                                  |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `pnpm wu:create --lane <Lane> --title "..." ..` | Create new WU spec (ID auto-generated; see fields below)     |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`       | Claim WU and create worktree (default)                       |
| `pnpm wu:claim --id WU-XXX --lane <L> --cloud`  | Claim WU in cloud/branch-pr mode (no worktree)               |
| `pnpm wu:prep --id WU-XXX [--full-tests]`       | Run gates, prep for wu:done (`tests.unit` scoped by default) |
| `pnpm wu:done --id WU-XXX`                      | Complete WU (merge or PR, stamp, cleanup)                    |
| `pnpm wu:edit --id WU-XXX --description "..."`  | Edit WU spec fields (run --help for all flags)               |
| `pnpm wu:block --id WU-XXX --reason "..."`      | Block WU with reason                                         |
| `pnpm wu:unblock --id WU-XXX`                   | Unblock WU                                                   |
| `pnpm wu:release --id WU-XXX`                   | Release orphaned WU (in_progress to ready)                   |
| `pnpm wu:status --id WU-XXX`                    | Show WU status, location, valid commands                     |
| `pnpm wu:brief --id WU-XXX --client <client>`   | Generate handoff prompt + record evidence (worktree only)    |
| `pnpm wu:brief --id WU-XXX --no-context`        | Generate prompt without memory context injection             |
| `pnpm wu:delegate --id WU-XXX --parent-wu <P>`  | Generate prompt and record delegation lineage                |
| `pnpm wu:sandbox --id WU-XXX -- <cmd>`          | Run command through hardened WU sandbox backend              |

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
| `pnpm wu:proto --lane <Lane>`    | Create WU prototype (lightweight draft)  |

---

## Gates & Quality

| Command                           | Description                                     |
| --------------------------------- | ----------------------------------------------- |
| `pnpm gates`                      | Run all quality gates                           |
| `pnpm gates --docs-only`          | Run gates for docs changes                      |
| `pnpm format`                     | Format all files (Prettier)                     |
| `pnpm format:check`               | Check formatting without changes                |
| `pnpm lint`                       | Run ESLint                                      |
| `pnpm typecheck`                  | Run TypeScript type checking                    |
| `pnpm test`                       | Run all tests (Vitest)                          |
| `pnpm spec:linter`                | Validate WU specs (all) ¹                       |
| `pnpm lane:health`                | Check lane config health                        |
| `pnpm lane:suggest --paths "..."` | Suggest lane for code paths                     |
| `pnpm lane:status`                | Show lane lifecycle status                      |
| `pnpm lane:setup`                 | Create/update draft lane config                 |
| `pnpm lane:validate`              | Validate lane draft artifacts                   |
| `pnpm lane:lock`                  | Lock lane lifecycle for WU create               |
| `pnpm lane:edit --lane <L>`       | Edit lane definition (rename, wip-limit, paths) |

¹ **Script aliases:** `spec:linter` and `tasks:validate` are pnpm script aliases
for `wu:validate --all`. They are not standalone CLI commands.

Before rerunning `wu:prep` after docs-heavy edits, format touched docs first:
`pnpm prettier --write <changed-doc-paths...>`.

---

## Memory & Sessions

| Command                              | Description                                                              |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm mem:init --wu WU-XXX`          | Initialize memory for WU                                                 |
| `pnpm mem:start --wu WU-XXX`         | Start a memory session (surfaces unread signals, INIT-015)               |
| `pnpm mem:checkpoint --wu WU-XXX`    | Save progress checkpoint (also created by auto-checkpoint hooks)         |
| `pnpm mem:recover --wu WU-XXX`       | Generate recovery context (WU-1390)                                      |
| `pnpm mem:ready --wu WU-XXX`         | Check pending nodes                                                      |
| `pnpm mem:export --wu WU-XXX`        | Export memory as markdown                                                |
| `pnpm mem:create "msg" --wu WU-XXX`  | Create memory node (bug discovery)                                       |
| `pnpm mem:signal "msg" --wu WU-XXX`  | Broadcast coordination signal (append-only receipts, INIT-015)           |
| `pnpm mem:inbox --wu WU-XXX`         | Check coordination signals (receipt-aware read state, INIT-015)          |
| `pnpm mem:inbox --no-mark`           | Read signals without marking as read                                     |
| `pnpm mem:summarize --wu WU-XXX`     | Summarize memory context                                                 |
| `pnpm mem:triage --wu WU-XXX`        | Triage discovered bugs                                                   |
| `pnpm mem:context --wu WU-XXX`       | Get context for current lane/WU                                          |
| `pnpm mem:context ... --lane <L>`    | Filter context by lane (WU-1292)                                         |
| `pnpm mem:delete --id <node-id>`     | Delete/archive a memory node                                             |
| `pnpm mem:cleanup`                   | Clean up stale memory data (respects `memory.decay` policy when enabled) |
| `pnpm mem:cleanup --decay`           | Run decay-based archival (archive stale nodes below threshold)           |
| `pnpm mem:cleanup --decay --dry-run` | Preview decay archival without changes                                   |

### Memory Enforcement (INIT-015)

Auto-checkpoint and decay enforcement are configured in `workspace.yaml` under `memory.enforcement` and `memory.decay`. When enabled:

- **Auto-checkpoint hooks** create checkpoints automatically via PostToolUse (counter-based) and SubagentStop (always) events
- **wu:done checkpoint gate** warns or blocks if no checkpoints exist for the WU
- **Decay archival** prunes stale memory during wu:done when `memory.decay.enabled=true`

Generate enforcement hooks after configuration:

```bash
pnpm lumenflow:integrate --client claude-code
```

See [Configuration Reference](/reference/config) for all `memory.enforcement` and `memory.decay` keys.

---

## State Management

| Command                       | Description                            |
| ----------------------------- | -------------------------------------- |
| `pnpm state:doctor`           | Diagnose state store issues            |
| `pnpm state:doctor --fix`     | Auto-repair safe issues                |
| `pnpm state:doctor --dry-run` | Preview repairs without making changes |
| `pnpm state:doctor --json`    | Output as JSON                         |
| `pnpm state:cleanup`          | Clean up stale state data              |
| `pnpm signal:cleanup`         | Clean up stale signals                 |
| `pnpm state:bootstrap`        | Bootstrap state store                  |
| `pnpm backlog:prune`          | Clean stale backlog entries            |

### state:doctor Issue Types (WU-1420)

The `state:doctor` command detects and can auto-fix these issues:

| Issue Type      | Description                                            | Auto-Fix Action        |
| --------------- | ------------------------------------------------------ | ---------------------- |
| Orphaned WU     | WU YAML status is 'done' but no stamp file exists      | Creates stamp file     |
| Dangling Signal | Signal references a WU that doesn't exist              | Removes signal         |
| Broken Event    | Events exist for a WU that doesn't exist               | Removes events         |
| Status Mismatch | WU YAML status differs from state store derived status | Emits corrective event |

**Status Mismatch Detection (WU-1420):**

When WU YAML says 'ready' but the state store (derived from events) says 'in_progress',
`wu:claim` fails with 'already in_progress'. The `state:doctor --fix` command will emit
a `release` event to reconcile the state.

Supported mismatch fixes:

- YAML=ready, state=in_progress: Emits `release` event
- YAML=done, state=in_progress: Emits `complete` event

---

## Configuration

See **Tooling Operations** section above for `config:set` and `config:get` commands.

`config:set` validates against the Zod schema before writing and uses the micro-worktree
pattern for atomic commits. Always use these commands instead of raw Write/Edit on
`workspace.yaml`. See [Constraint 9](../../../../../.lumenflow/constraints.md)
and [YAML editing policy](../../../../../.lumenflow/rules/yaml-editing-policy.md).

**Common dotpaths:**

| Dotpath                           | Type    | Example Values              |
| --------------------------------- | ------- | --------------------------- |
| `methodology.testing`             | enum    | `tdd`, `test-after`, `none` |
| `gates.minCoverage`               | number  | `0`-`100`                   |
| `gates.enableCoverage`            | boolean | `true`, `false`             |
| `experimental.context_validation` | boolean | `true`, `false`             |
| `git.requireRemote`               | boolean | `true`, `false`             |

---

## Dependencies

| Command                         | Description                    |
| ------------------------------- | ------------------------------ |
| `pnpm deps:add --pkg <name>`    | Add dependency to package      |
| `pnpm deps:remove --pkg <name>` | Remove dependency from package |

---

## Plans

Plans are markdown documents that capture goals, scope, approach, and success criteria before implementation begins. They link to WUs (via the `plan` field, WU-1683) and initiatives (via `related_plan`).

### Plan Storage

Plans are stored in the repo at `docs/plans/` by default (configurable via `directories.plansDir` in `workspace.yaml`).

If the plan exists only in conversation, use `--plan` on `wu:create` to generate a lightweight
stub in `$LUMENFLOW_HOME/plans/` and automatically set the WU's `plan` field to the
`lumenflow://plans/` URI. Feature WUs should have a `plan` field; notes do not replace the plan link.

| Command                                                                  | Description                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `pnpm plan:create --id INIT-XXX --title "..."`                           | Create a repo-native plan file in configured `directories.plansDir` |
| `pnpm plan:edit --id INIT-XXX --section Goal --content "..."`            | Edit a section in a plan file                                       |
| `pnpm plan:link --id INIT-XXX --plan lumenflow://plans/INIT-XXX-plan.md` | Link plan URI to initiative or WU                                   |
| `pnpm plan:promote --id INIT-XXX`                                        | Promote plan status to approved                                     |
| `pnpm initiative:plan --initiative INIT-XXX --plan <path>`               | Legacy-compatible initiative linking command                        |
| `pnpm initiative:plan --initiative INIT-XXX --create`                    | Legacy-compatible create-and-link flow                              |

### Linking Plans

**To an initiative (canonical):**

```bash
# Create a plan
pnpm plan:create --id INIT-001 --title "Auth System Rollout"

# Link plan URI to initiative
pnpm plan:link --id INIT-001 --plan lumenflow://plans/INIT-001-plan.md
```

**Legacy-compatible initiative command:**

```bash
# Create a new plan template
pnpm initiative:plan --initiative INIT-001 --create

# Link an existing plan file
pnpm initiative:plan --initiative INIT-001 --plan docs/plans/my-plan.md
```

**To a WU (via `plan` field, WU-1683):**

```bash
# When creating a WU (--plan auto-generates and links)
pnpm wu:create --lane "Framework: Core" --title "Feature" --plan

# Or edit an existing WU with a specific plan URI
pnpm wu:edit --id WU-123 --plan "lumenflow://plans/WU-123-plan.md"

# Or use plan:link
pnpm plan:link --id WU-123 --plan lumenflow://plans/WU-123-plan.md
```

### Plan URI Format

Plans use the `lumenflow://plans/` URI scheme for references:

- `lumenflow://plans/INIT-001-auth-system.md` - Initiative plan
- `lumenflow://plans/WU-123-plan.md` - WU-specific plan

---

## Initiatives

| Command                                                       | Description                   |
| ------------------------------------------------------------- | ----------------------------- |
| `pnpm initiative:create --id INIT-XXX ...`                    | Create new initiative         |
| `pnpm initiative:edit --id INIT-XXX ...`                      | Edit initiative fields/phases |
| `pnpm initiative:list`                                        | List all initiatives          |
| `pnpm initiative:status --id INIT-XXX`                        | Show initiative status        |
| `pnpm initiative:add-wu --initiative INIT-XXX --wu WU-XXX`    | Add WU to initiative          |
| `pnpm initiative:remove-wu --initiative INIT-XXX --wu WU-XXX` | Remove WU from initiative     |
| `pnpm initiative:bulk-assign --id INIT-XXX`                   | Bulk assign WUs to initiative |

Common phase metadata updates:

```bash
# Rename a specific phase title
pnpm initiative:edit --id INIT-025 --phase-id 1 --phase-title "Phase 1: State-Machine Foundation"

# Update a specific phase status
pnpm initiative:edit --id INIT-025 --phase-id 1 --phase-status in_progress
```

---

## Orchestration

| Command                                      | Description                       |
| -------------------------------------------- | --------------------------------- |
| `pnpm orchestrate:initiative --id INIT-XXX`  | Orchestrate initiative execution  |
| `pnpm orchestrate:init-status --id INIT-XXX` | Compact initiative progress view  |
| `pnpm orchestrate:monitor`                   | Monitor delegation/agent activity |
| `pnpm delegation:list`                       | List active delegation records    |

For the complete orchestration workflow (delegation, memory coordination, failure recovery, checkpoint-per-wave mechanics), see [initiative-orchestration.md](initiative-orchestration.md).

---

## Metrics & Flow

| Command                 | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `pnpm flow:report`      | Generate flow metrics report                           |
| `pnpm flow:bottlenecks` | Identify flow bottlenecks                              |
| `pnpm metrics:snapshot` | Capture metrics snapshot                               |
| `pnpm metrics`          | View workflow metrics                                  |
| `pnpm strict:progress`  | Report strict TypeScript backlog and guard regressions |

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

| Command                   | Description                                  |
| ------------------------- | -------------------------------------------- |
| `pnpm agent:session`      | Start agent session (registers active agent) |
| `pnpm agent:session-end`  | End agent session                            |
| `pnpm agent:log-issue`    | Log issue during agent session               |
| `pnpm agent:issues-query` | Query GitHub issues for agent work           |
| `pnpm task:claim`         | Claim a task directly through KernelRuntime  |

---

## Packs

| Command                            | Description                          |
| ---------------------------------- | ------------------------------------ |
| `pnpm pack:author`                 | Author a secure domain pack          |
| `pnpm pack:scaffold --name <name>` | Scaffold a new domain pack           |
| `pnpm pack:validate --path <path>` | Validate a domain pack for integrity |
| `pnpm pack:hash --path <path>`     | Compute integrity hash for a pack    |
| `pnpm pack:publish --path <path>`  | Publish a domain pack to registry    |
| `pnpm pack:install --name <name>`  | Install a domain pack into workspace |
| `pnpm pack:search --query <query>` | Search for packs in registry         |

---

## Audited File & Git Wrappers

These commands wrap standard file/git operations with audit trail logging.
Use them when audit evidence is required (e.g., during WU execution).

| Command                          | Description                      |
| -------------------------------- | -------------------------------- |
| `pnpm file:read --path <path>`   | Read file with audit trail       |
| `pnpm file:write --path <path>`  | Write file with audit trail      |
| `pnpm file:edit --path <path>`   | Edit file with audit trail       |
| `pnpm file:delete --path <path>` | Delete file with audit trail     |
| `pnpm git:status`                | Show git status with audit trail |
| `pnpm git:diff`                  | Show git diff with audit trail   |
| `pnpm git:log`                   | Show git log with audit trail    |
| `pnpm git:branch`                | Show git branch with audit trail |

---

## Worktree Bootstrap (Dependency-Closure Build)

Fresh worktrees don't have built `dist/` directories. Dist-backed CLI commands
(e.g., `lane:health`, `gates`, `wu:status`) require `@lumenflow/cli` and its
workspace dependencies to be built first.

**`pnpm bootstrap`** builds `@lumenflow/cli` plus its full dependency closure
(core, memory, metrics, initiatives, agent) in one command using turbo's
`--filter` with topological dependency resolution.

```bash
# After wu:claim and cd into worktree:
pnpm bootstrap          # Builds CLI + all workspace deps
pnpm lane:health        # Now works
pnpm gates              # Now works
```

**When to use:**

- After `wu:claim` in a fresh worktree before running dist-backed commands
- After `pnpm install` if dist directories were cleaned
- As a lighter alternative to `pnpm build` (builds only CLI closure, not all packages)

**How it differs from other build commands:**

| Command          | Scope                                  | Use case           |
| ---------------- | -------------------------------------- | ------------------ |
| `pnpm setup`     | Install + build CLI + integrate hooks  | First-time setup   |
| `pnpm bootstrap` | Build CLI with dependency closure only | Worktree preflight |
| `pnpm build`     | Build all packages                     | Full rebuild       |

---

## Workflow Sequence (Quick Reference)

```bash
# 0. Check available options (do this before first use of any command)
pnpm wu:create --help

# 1. Create WU (ID auto-generated)
pnpm wu:create --lane "Framework: Core" --title "Add feature" \
  --description "Context: ... Problem: ... Solution: ..." \
  --acceptance "Criterion 1" --acceptance "Criterion 2" \
  --code-paths "src/file.ts" \
  --test-paths-unit "src/__tests__/file.test.ts" \
  --exposure backend-only
# Output: Created WU-1990 at docs/.../wu/WU-1990.yaml

# 2. Claim (creates worktree) -- use the ID from wu:create output
pnpm wu:claim --id WU-1990 --lane "Framework: Core"
cd worktrees/framework-core-wu-1990

# 2b. Bootstrap (build CLI for dist-backed commands)
pnpm bootstrap

# 3. Implement (TDD)
# ... write tests first, then code ...

# 4. Commit
git add . && git commit -m "feat: description"

# 5. Prep (runs gates in worktree)
pnpm wu:prep --id WU-1990

# 6. Complete (from main - copy from wu:prep output)
cd /path/to/main && pnpm wu:done --id WU-1990
```

---

## wu:create Required Fields (Code WUs)

For code changes, you must include **all** of the following (or wu:create will fail):

- `--description`
- `--acceptance` (repeatable, at least one)
- `--code-paths` (repeatable)
- `--test-paths-unit` or `--test-paths-e2e` (automated tests required)
- `--exposure` (ui | api | backend-only | documentation)
- `--spec-refs` (required for type: feature)
- `--plan` (optional, auto-generates plan file and sets `plan` field — WU-1683)

Documentation WUs can omit code/test paths but should set `--type documentation` and `--exposure documentation`.

**Auto-generated IDs (recommended):** Omit `--id` and let `wu:create` assign the next sequential ID. Capture the output for dependency chaining:

```bash
# Create first WU (ID auto-generated)
pnpm wu:create --lane "Framework: Core" --title "First WU" ...
# Output: Created WU-1990

# Create second WU blocked by the first
pnpm wu:create --lane "Framework: Core" --title "Second WU" --blocked-by WU-1990 ...
# Output: Created WU-1991
```

> **Note:** Use `--id` only when re-creating a specific WU or for migration tooling.

---

## Strict WU Validation (WU-1329)

**WU validation is strict by default.** Commands validate that code paths and test paths actually exist on disk.

### Affected Commands

| Command             | Strict Behavior                                     |
| ------------------- | --------------------------------------------------- |
| `wu:create`         | Validates `--code-paths` and `--test-paths-*` exist |
| `wu:edit`           | Validates edited paths exist                        |
| `wu:validate`       | Treats warnings as errors by default                |
| `initiative:add-wu` | Validates WU schema and completeness before linking |

### Strict Mode (Default)

When strict validation runs:

- Non-existent `code_paths` cause **failure**
- Non-existent `test_paths` cause **failure**
- Validation warnings are treated as **errors**

This prevents WU specs from referencing files that do not exist, improving spec quality and reducing broken WUs.

### Bypassing Strict Validation

Use `--no-strict` to bypass path existence checks (not recommended):

```bash
# Create WU with paths that don't exist yet (planning ahead)
pnpm wu:create --lane "Framework: Core" --title "New feature" \
  --code-paths "src/new-file.ts" \
  --no-strict

# Validate with warnings as advisory only
pnpm wu:validate --id WU-XXX --no-strict
```

**When to use `--no-strict`:**

- Planning WUs before implementation (paths don't exist yet)
- Migrating specs from external systems
- Emergency situations (logged for audit)

**Usage is logged** for accountability.

### Agent Expectations

Agents should:

1. **Prefer strict mode** (default) for all WU operations
2. **Avoid `--no-strict`** unless explicitly necessary
3. **Fix path issues** rather than bypassing validation
4. **Create files first** before referencing them in WU specs

---

## Lane Lifecycle Requirement

Before the first delivery WU, complete lane lifecycle once per project:

```bash
pnpm lane:setup
pnpm lane:validate
pnpm lane:lock
```

Lifecycle states:

- `unconfigured` -> next step `pnpm lane:setup`
- `draft` -> next step `pnpm lane:lock`
- `locked` -> delivery WUs can be created

Check current lifecycle state any time:

```bash
pnpm lane:status
```

---

## Local / Offline Behavior (No Remote)

By default, `wu:create` and `wu:claim` expect an `origin` remote and will fetch `origin/main`.

For local-only or offline development, add this to `workspace.yaml`:

```yaml
git:
  requireRemote: false
```

When `requireRemote: false`:

- `wu:create` skips remote fetch operations
- `wu:claim` works without pushing to origin
- Useful for air-gapped environments, testing/evaluation, or pre-remote development

When `requireRemote: true` (default):

- Operations fail with a clear error if no `origin` remote exists
- Ensures team visibility via remote branches

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

### Cloud Lifecycle (Branch-PR Mode)

For cloud agents that cannot use local worktrees:

```bash
# 1. Claim in cloud mode
pnpm wu:claim --id WU-XXX --lane "<Lane>" --cloud
# Or: LUMENFLOW_CLOUD=1 pnpm wu:claim --id WU-XXX --lane "<Lane>"

# 2. Work on lane branch, push commits

# 3. Prep (validates branch, runs gates in-place)
pnpm wu:prep --id WU-XXX

# 4. Complete (creates PR, does NOT merge to main)
pnpm wu:done --id WU-XXX

# 5. After PR is reviewed and merged, run cleanup
pnpm wu:cleanup --id WU-XXX
```

**Post-merge cleanup (`wu:cleanup`):**

- Creates `.lumenflow/stamps/WU-XXX.done`
- Updates WU YAML to `status: done`
- Regenerates backlog.md and status.md
- Deletes the lane branch (local and remote)

**Cloud auto-detection (opt-in):**

```yaml
# workspace.yaml
cloud:
  auto_detect: true # default: false
  env_signals:
    - name: CI
    - name: CODEX
    - name: GITHUB_ACTIONS
      equals: 'true'
```

### Enforcement Hooks (WU-1367)

Configure hooks that enforce workflow compliance for Claude Code:

```yaml
# In workspace.yaml
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
        require_wu_for_edits: true
        warn_on_stop_without_wu_done: true
```

```bash
# Generate hooks after configuration
pnpm lumenflow:integrate --client claude-code
```

Hooks provide automatic enforcement at the tool level:

- **block_outside_worktree**: Blocks Write/Edit to main when worktrees exist
- **require_wu_for_edits**: Requires a claimed WU for Write/Edit operations
- **warn_on_stop_without_wu_done**: Warns when session ends with active worktrees

---

## Lifecycle Map and Troubleshooting

For a complete picture of how all WU commands, memory tools, and orchestration tools fit together, and for remediation of common failure modes, see:

- **[Canonical Lifecycle Map](../../lumenflow-complete.md#26-canonical-lifecycle-map-wu-1635)** -- Command-mode matrix (worktree vs cloud/branch-PR), expected locations, and handoff points
- **[Failure-Mode Runbook](../../lumenflow-complete.md#appendix-a-failure-mode-runbook-wu-1635)** -- Concrete remediation for main-behind-origin, partial-claim state, spawn-provenance enforcement, and wu:recover usage
- **[Troubleshooting wu:done](./troubleshooting-wu-done.md)** -- Most common agent mistake (two-step wu:prep + wu:done workflow)
- **[First WU Mistakes](./first-wu-mistakes.md)** -- Common first-time pitfalls and how to avoid them
- **[WU Sizing Guide](../../wu-sizing-guide.md)** -- Context safety triggers, complexity assessment, and session strategies
