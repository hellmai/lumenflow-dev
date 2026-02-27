# LumenFlow Workflow Guide

**Last updated:** 2026-02-27

LumenFlow is a vendor-agnostic workflow framework for AI-native software development.

> **Context Safety**: When approaching context limits (80% usage, 50+ tool calls), spawn a fresh agent instead of continuing after compaction. See [wu-sizing-guide.md](docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md).

---

## Critical Rule: Use wu:prep Then wu:done

Completion is a **two-step process**: run `wu:prep` from the worktree (runs gates, prints copy-paste instruction), then run `wu:done` from main (merge + cleanup only). Do NOT run `wu:done` from a worktree, skip `wu:prep`, or forget to run `wu:done` after `wu:prep`.

For detailed troubleshooting, common mistakes, and recovery steps, see [troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md).

---

## Quick Start

```bash
# 1. Setup (first time only)
pnpm setup

# 2. Configure lane lifecycle once per project (after context/plan is clear)
pnpm lane:setup
pnpm lane:validate
pnpm lane:lock

# 3. Create a WU (--id is optional, auto-generates next sequential ID if omitted)
pnpm wu:create --lane <Lane> --title "Title" \
  --description "..." --acceptance "..." --code-paths "..." \
  --test-paths-unit "..." --exposure backend-only \
  --spec-refs "lumenflow://plans/WU-XXXX-plan.md"

# 4. Claim (auto-merges spec branch to main if needed)
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 5. Implement in worktree

# 6. Prepare (runs gates in worktree) - WU-1223 NEW
pnpm wu:prep --id WU-XXXX
# This prints a copy-paste instruction for the next step

# 7. Complete (from main checkout - copy-paste from wu:prep output)
cd /path/to/main && pnpm wu:done --id WU-XXXX
```

---

## When to Use Initiatives

Use **Initiatives** for multi-phase work spanning multiple WUs:

- **Product visions**: "Build a task management app"
- **Larger features**: Work requiring multiple WUs across lanes
- **Complex projects**: Anything that needs phased delivery

```bash
# Create an initiative for multi-phase work
pnpm initiative:create --id INIT-001 --title "Feature Name" \
  --description "..." --phase "Phase 1: MVP" --phase "Phase 2: Polish"

# Add WUs to the initiative
pnpm initiative:add-wu --initiative INIT-001 --wu WU-XXX --phase 1

# Track progress
pnpm initiative:status --id INIT-001
```

**Skip initiatives** for: single-file bug fixes, small docs updates, isolated refactoring.

---

## Setup Notes (Common First-Run Failures)

### Lane lifecycle (deferred setup)

`lumenflow init` no longer finalizes delivery lanes. Lane setup is an explicit process:

```bash
pnpm lane:setup      # creates/updates draft lane artifacts
pnpm lane:validate   # validates draft lane artifacts
pnpm lane:lock       # finalizes lane lifecycle for delivery WUs
```

`wu:create` requires lane lifecycle status `locked` and prints a deterministic next step when lanes are `unconfigured` or `draft`.

### Local-only / no remote

By default, `wu:create` expects an `origin` remote and will fetch `origin/main`.

For local-only or offline development, add this to `workspace.yaml`:

```yaml
software_delivery:
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

## Core Principles

1. **Design-First** (feature/refactor WUs): Load `/skill design-first` before implementation. Question requirements, delete unnecessary, simplify before optimizing
2. **TDD**: Failing test -> implementation -> passing test (>=90% coverage on new code)
3. **Library-First**: Search existing libraries before custom code
4. **DRY/SOLID/KISS/YAGNI**: No magic numbers, no hardcoded strings
5. **Worktree Discipline**: After `wu:claim`, work ONLY in the worktree
6. **Branch Safety**: NEVER edit files on main branch. Run `git branch --show-current` before edits.
7. **Command Clarity**: If you are unsure about a command, run `<command> --help` first. Do not guess.
8. **Gates Before Done**: All gates must pass before `wu:done`
9. **Do Not Bypass Hooks**: No `--no-verify`, fix issues properly
10. **Always wu:done**: Complete every WU by running `pnpm wu:done`

---

## Universal Agent Safety (WU-1170)

LumenFlow enforces safety at the repository level via git wrappers, Husky hooks, and audit logs. All worktree management MUST use `wu:` commands (not raw git). For the complete list of forbidden commands, safe alternatives, and enforcement details, see [.lumenflow/constraints.md](.lumenflow/constraints.md).

---

## Global State

Canonical global state is defined by:

- `origin/main` (WU YAML + status.md + backlog.md + state store)
- Remote lane branches (e.g., `origin/lane/<lane>/wu-<id>`)

`wu:claim` updates canonical claim state on `origin/main` using a push-only micro-worktree, then
creates the lane branch and pushes it by default for global visibility. Use `--no-push` only for
air-gapped/offline work; it creates a local-only claim and warns explicitly.

### Cloud Branch-PR Lifecycle

For cloud agents (Codex/Claude web/CI) operating on feature branches:

- `wu:create --cloud` writes WU specs on the active branch (no main checkout requirement)
- `wu:claim --cloud` sets `claimed_mode: branch-pr` and persists `claimed_branch`
- `wu:done` completes via PR flow; run `wu:cleanup` after merge for stamps/state cleanup
- `wu:recover` and `wu:repair --admin` apply branch-pr fixes on the claimed branch (not `origin/main`)

---

## Documentation Structure

### Core (Vendor-Agnostic)

- **AGENTS.md** - Universal entry point for AI agents (Codex, Cursor, Windsurf)
- **LUMENFLOW.md** - This file, main workflow documentation
- **.lumenflow/constraints.md** - Non-negotiable workflow constraints
- **.lumenflow/rules/** - Workflow rules (git-safety.md, wu-workflow.md, etc.)
- **docs/04-operations/\_frameworks/lumenflow/agent/onboarding/** - Agent onboarding documentation

### Public Starlight Docs (Kernel/Packs IA)

- **apps/docs/src/content/docs/kernel/** - Kernel-only user docs
- **apps/docs/src/content/docs/packs/software-delivery/** - Software Delivery Pack docs
- **apps/docs/src/content/docs/packs/software-delivery/languages/** - Pack-scoped language guides
- **apps/docs/src/data/version-policy.yaml** - Published stable version source of truth
- **apps/docs/src/data/language-support.yaml** - Language guide support metadata
- **apps/docs/src/data/example-repos.yaml** - Companion example-repo mapping

### Client/Vendor Overlays

- **CLAUDE.md** - Claude Code overlay (single file at root)
- **.claude/** - Claude Code settings, hooks, skills, agents
- **.cursor/rules/lumenflow.md** - Cursor rules overlay
- **.windsurf/rules/lumenflow.md** - Windsurf rules overlay

Use `lumenflow init --client <type>` to generate client-specific files:

```bash
lumenflow init                     # Creates AGENTS.md + LUMENFLOW.md (universal)
lumenflow init --client claude     # + CLAUDE.md, .claude/
lumenflow init --client cursor     # + .cursor/rules/lumenflow.md
lumenflow init --client windsurf   # + .windsurf/rules/lumenflow.md
lumenflow init --client all        # All of the above
lumenflow init --merge             # Safe merge into existing files
```

The `--merge` flag uses bounded markers (`LUMENFLOW:START`/`END`) to safely insert or update LumenFlow config in existing files without overwriting user content.

---

## Worktree Discipline (IMMUTABLE LAW)

After claiming a WU, immediately `cd worktrees/<lane>-wu-xxx` and work exclusively in the worktree. Main checkout becomes read-only -- hooks will block WU commits from main. Return to main only to run `wu:done`.

For the full worktree lifecycle (parallel execution, bootstrap, isolation guarantees), see [lumenflow-complete.md section 2.4](docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md). For the mandatory pre-write check, see [.lumenflow/constraints.md](.lumenflow/constraints.md).

### Vendor-Agnostic Dirty-Main Guard

`wu:prep` and `wu:done` enforce a runtime guard (not just hooks) across all clients and tools:

- In worktree mode, commands block if main checkout has non-allowlisted dirty files
- This includes writes from MCP tools or any vendor client that bypasses hook execution
- Allowed dirty prefixes on main: `docs/04-operations/tasks/wu/`, `.lumenflow/`, `.claude/`, `plan/`
- `branch-pr` mode is exempt (no local worktree/main split)

---

## Definition of Done

- Acceptance criteria satisfied
- Gates green (`pnpm gates` or `pnpm gates --docs-only`)
- WU YAML status = `done`
- `.lumenflow/stamps/WU-<id>.done` exists
- **wu:done has been run** (not just documented as "to do")

---

## Core Commands

> **Complete CLI reference (60+ commands):** See [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md). Always run `<command> --help` for the authoritative option list.

| Command                   | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `pnpm wu:create`          | Create new WU spec                                     |
| `pnpm wu:claim`           | Claim WU, update canonical state, create worktree      |
| `pnpm wu:prep`            | Run gates in worktree, prep for wu:done                |
| `pnpm wu:done`            | Complete WU (merge, stamp, cleanup)                    |
| `pnpm wu:status`          | Show WU status, location, and valid commands           |
| `pnpm wu:recover`         | Analyze and fix WU state inconsistencies               |
| `pnpm wu:block`           | Block WU (transitions to blocked, frees lane)          |
| `pnpm wu:unblock`         | Unblock WU (transitions to in_progress)                |
| `pnpm wu:release`         | Release orphaned WU (in_progress to ready for reclaim) |
| `pnpm wu:brief`           | Generate handoff prompt + record evidence              |
| `pnpm wu:delegate`        | Generate prompt + record delegation lineage            |
| `pnpm wu:escalate`        | Show or resolve WU escalation status                   |
| `pnpm wu:delete`          | Delete WU spec and cleanup                             |
| `pnpm gates`              | Run quality gates (`--docs-only` for docs WUs)         |
| `pnpm lumenflow:commands` | List all public commands (primary + alias + legacy)    |
| `pnpm docs:generate`      | Regenerate CLI/config reference docs from source       |
| `pnpm docs:validate`      | Verify generated docs are up-to-date                   |
| `pnpm lane:status`        | Show lane lifecycle status + next step                 |
| `pnpm lane:setup`         | Create/update draft lane artifacts                     |
| `pnpm lane:validate`      | Validate lane artifacts before lock                    |
| `pnpm lane:lock`          | Lock lane lifecycle for delivery WUs                   |
| `pnpm mem:checkpoint`     | Save memory checkpoint                                 |

Commands include **context-aware validation** that checks location, WU status, and git state. When validation fails, commands provide copy-paste ready fix commands. Configure in `workspace.yaml` under `software_delivery.experimental.context_validation`.
The Starlight CLI reference page is intentionally curated to primary commands; use `pnpm lumenflow:commands` for complete discovery.

For recovery commands, state management, memory coordination, and orchestration tools, see [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md).

---

## Constraints

See [.lumenflow/constraints.md](.lumenflow/constraints.md) for the 9 non-negotiable rules:

1. Worktree discipline and git safety
2. WUs are specs, not code
3. Docs-only vs code WUs
4. LLM-first deterministic inference
5. Gates and skip-gates
6. Safety and governance
7. Test ratchet pattern
8. Lane-fit reasoning
9. YAML files must be modified via CLI tooling only

---

## Agent Onboarding

If you're an AI agent, read the onboarding docs:

1. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md) - Most common mistake
2. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/first-wu-mistakes.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/first-wu-mistakes.md) - First WU pitfalls
3. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/agent-safety-card.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-safety-card.md) - Safety guardrails
4. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md) - Command reference
5. [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/test-ratchet.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/test-ratchet.md) - Test baseline ratchet pattern

---

## Skills & Agents

LumenFlow provides modular skills and agent definitions for AI assistants.

### Skills

Skills are knowledge bundles in `.claude/skills/` (Claude Code) or `.lumenflow/skills/` (vendor-agnostic):

| Skill                 | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `wu-lifecycle`        | WU claim/block/done automation              |
| `worktree-discipline` | Prevent absolute path trap                  |
| `tdd-workflow`        | RED-GREEN-REFACTOR, test-driven development |
| `lumenflow-gates`     | Gate troubleshooting                        |
| `bug-classification`  | P0-P3 triage, fix-in-place decisions        |

Load skills in Claude Code: `/skill wu-lifecycle`

### Agents

Pre-configured agent definitions in `.claude/agents/`:

| Agent             | Purpose                    |
| ----------------- | -------------------------- |
| `general-purpose` | Standard WU implementation |
| `lumenflow-pm`    | Backlog & lifecycle        |
| `test-engineer`   | TDD, coverage              |
| `code-reviewer`   | Quality checks             |
| `bug-triage`      | Bug classification         |

Generate handoff prompts (prompt-only, execution is a separate step): `pnpm wu:brief --id WU-XXX --client <client>`
Record explicit delegation lineage when needed: `pnpm wu:delegate --id WU-XXX --parent-wu WU-YYY --client <client>`

Supported clients: `claude-code`, `codex-cli`, `cursor`, `gemini-cli`, `windsurf`

---

## References

- [LumenFlow Complete Guide](docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md) -- Full framework reference (lifecycle, lanes, gates, DoD)
- [Quick Reference: Commands](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md) -- Complete CLI reference (60+ commands)
- [Troubleshooting wu:done](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md) -- Most common completion mistakes
- [.lumenflow/constraints.md](.lumenflow/constraints.md) -- Non-negotiable rules and forbidden commands
- [WU Sizing Guide](docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md) -- Scoping work and context safety
- [Skills Index](.claude/skills/INDEX.md)
- [Agents README](.claude/agents/README.md)
