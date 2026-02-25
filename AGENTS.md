# Universal Agent Instructions

**Last updated:** 2026-02-13

> **Works with any AI coding assistant.** This file provides instructions that work regardless of which AI tool you're using -- Claude Code, Cursor, Windsurf, Cline, Codex, Aider, or any other. Just read this file and follow the workflow.

This project uses LumenFlow workflow. For complete documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Quick Start (Local Worktree -- Default)

First-time lane setup (once per project, after plan/context is known):

```bash
pnpm lane:setup
pnpm lane:validate
pnpm lane:lock
```

```bash
# 1. Claim a WU
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 2. Work in worktree

# 3. Prep (runs gates in worktree)
pnpm wu:prep --id WU-XXXX
# This prints a copy-paste command for step 4

# 4. Complete (from main - copy-paste from wu:prep output)
cd <project-root> && pnpm wu:done --id WU-XXXX
```

## Quick Start (Cloud / Branch-PR)

Cloud agents (Codex, Claude web, CI bots) that cannot use local worktrees use the **branch-pr** mode. This is a first-class lifecycle, not a workaround.

**Activation is explicit-only:** cloud mode is enabled only by `--cloud` or `LUMENFLOW_CLOUD=1`. Runtime identity env vars such as `CLAUDECODE`, `CODEX`, or `CI` do not activate cloud mode.

```bash
# 1. Create in cloud mode (ID auto-generated; optional if WU already exists)
pnpm wu:create --lane <Lane> --title "..." ... --cloud
# Output: Created WU-XXXX

# 2. Claim in cloud mode (creates lane branch, no worktree)
pnpm wu:claim --id WU-XXXX --lane <Lane> --cloud
# Or: LUMENFLOW_CLOUD=1 pnpm wu:claim --id WU-XXXX --lane <Lane>

# 3. Work on the lane branch in your cloud environment

# 4. Prep (validates branch, runs gates)
pnpm wu:prep --id WU-XXXX

# 5. Complete (creates PR instead of merging to main)
pnpm wu:done --id WU-XXXX
# Output: PR created. After merge, run: pnpm wu:cleanup --id WU-XXXX

# 6. Post-merge cleanup (after PR is merged)
pnpm wu:cleanup --id WU-XXXX
```

**Key differences from worktree mode:**

- `wu:claim --cloud` sets `claimed_mode: branch-pr` (no worktree created)
- `wu:create --cloud` writes WU specs on the active branch (no main checkout requirement)
- `wu:done` creates a PR instead of fast-forward merging to main
- `wu:cleanup` handles post-merge stamp creation and state updates
- `wu:recover` and `wu:repair` respect branch-pr claimed branches for recovery/admin fixes
- Cloud mode is never auto-enabled by runtime identity env vars (`CLAUDECODE`, `CODEX`, `CI`)

---

## CLI Commands and Lifecycle Reference

For complete CLI command documentation (60+ commands), see [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md).

**Essential commands:**

| Command                   | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `pnpm wu:claim`           | Claim WU and create worktree (or `--cloud`)           |
| `pnpm wu:prep`            | Run gates in worktree, prep for wu:done               |
| `pnpm wu:done`            | Complete WU (merge or PR, stamp, cleanup)             |
| `pnpm wu:status`          | Show WU status, location, valid commands              |
| `pnpm wu:recover`         | Analyze and fix WU state inconsistencies              |
| `pnpm gates`              | Run all quality gates (`--docs-only` for docs)        |
| `pnpm lumenflow:commands` | List all public commands (primary + aliases + legacy) |
| `pnpm lane:status`        | Show lane lifecycle status and next step              |
| `pnpm lane:setup`         | Create/update draft lane artifacts                    |
| `pnpm lane:lock`          | Lock lane lifecycle for delivery WUs                  |
| `pnpm mem:checkpoint`     | Save progress checkpoint                              |

**Two-step completion (wu:prep then wu:done):**

The completion workflow is a two-step process. Run `wu:prep` from the worktree (runs gates, prints copy-paste instruction), then run `wu:done` from main (merge + cleanup). Do NOT run `wu:done` from a worktree.

For detailed troubleshooting, see [troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md).

---

## Core Principles

1. **TDD**: Write tests first, then implementation
2. **Worktree Discipline**: After `wu:claim`, work ONLY in the worktree
3. **Gates Before Done**: Run `pnpm gates` before `wu:done`
4. **Never Bypass Hooks**: No `--no-verify`
5. **Vendor-Agnostic Dirty-Main Guard**: `wu:prep` and `wu:done` hard-block when main has non-allowlisted dirty files during worktree WUs (including MCP/tool-originated writes). `branch-pr` mode is exempt.

For the complete set of non-negotiable constraints (git safety, forbidden commands, skip-gates policy, and more), see [.lumenflow/constraints.md](.lumenflow/constraints.md).

---

## Safety: Forbidden Commands and Safe Alternatives

LumenFlow enforces safety at the repository level via git wrappers and hooks. For the full list of forbidden commands and their safe `wu:` alternatives, see [.lumenflow/constraints.md](.lumenflow/constraints.md).

**Key rule:** Always use `wu:` commands for worktree and branch management -- never raw `git worktree` or `git branch -D` commands. Use `wu:recover` for state inconsistencies, `wu:release` for abandoned WUs, and `wu:prune` for stale worktrees.

---

## Vendor-Specific Overlays

This file provides universal guidance for all AI agents. Additional vendor-specific configuration:

- **Claude Code**: See `CLAUDE.md` (if present)
- **Cursor**: See `.cursor/rules/lumenflow.md` (if present)
- **Windsurf**: See `.windsurf/rules/lumenflow.md` (if present)
- **Cline**: See `.clinerules` (if present)

---

## Workflow Summary

### Local (Worktree Mode -- Default)

| Step         | Location | Command                                                                                                                                                                      |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Create WU | main     | `pnpm wu:create --lane <Lane> --title "Title" --description "..." --acceptance "..." --code-paths "..." --test-paths-unit "..." --exposure backend-only` (ID auto-generated) |
| 2. Claim     | main     | `pnpm wu:claim --id WU-XXX --lane <Lane>`                                                                                                                                    |
| 3. Work      | worktree | `cd worktrees/<lane>-wu-xxx`                                                                                                                                                 |
| 4. Prep      | worktree | `pnpm wu:prep --id WU-XXX` (runs gates)                                                                                                                                      |
| 5. Complete  | main     | `pnpm wu:done --id WU-XXX` (copy-paste from wu:prep)                                                                                                                         |

### Cloud (Branch-PR Mode)

| Step         | Location    | Command                                                                      |
| ------------ | ----------- | ---------------------------------------------------------------------------- |
| 1. Create WU | lane branch | `pnpm wu:create --lane <Lane> --title "..." ... --cloud` (ID auto-generated) |
| 2. Claim     | lane branch | `pnpm wu:claim --id WU-XXX --lane <Lane> --cloud`                            |
| 3. Work      | lane branch | Work on `lane/<lane>/wu-xxx` in cloud environment                            |
| 4. Prep      | lane branch | `pnpm wu:prep --id WU-XXX` (validates branch, runs gates)                    |
| 5. Complete  | lane branch | `pnpm wu:done --id WU-XXX` (creates PR)                                      |
| 6. Cleanup   | after merge | `pnpm wu:cleanup --id WU-XXX` (post-merge stamps)                            |

---

## Public Docs IA (Kernel + Packs)

- Kernel docs source: `apps/docs/src/content/docs/kernel/**`
- Software Delivery Pack docs source: `apps/docs/src/content/docs/packs/software-delivery/**`
- Language guides (pack-scoped): `apps/docs/src/content/docs/packs/software-delivery/languages/**`
- Docs truth YAML files:
  - `apps/docs/src/data/version-policy.yaml`
  - `apps/docs/src/data/language-support.yaml`
  - `apps/docs/src/data/example-repos.yaml`

---

## Further Reading

- [LUMENFLOW.md](LUMENFLOW.md) -- Main workflow documentation (principles, setup, initiatives, skills)
- [.lumenflow/constraints.md](.lumenflow/constraints.md) -- Non-negotiable rules and forbidden commands
- [Quick Reference: Commands](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md) -- Complete CLI reference (60+ commands)
- [Troubleshooting wu:done](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md) -- Most common completion mistakes
- [LumenFlow Complete Guide](docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md) -- Full framework reference (lifecycle, lanes, gates, DoD)

---

## Context Recovery (WU-2157)

If you are resuming work or have lost context, check for recovery files:

```bash
# Check for pending recovery
ls .lumenflow/state/recovery-pending-*.md 2>/dev/null

# Generate fresh recovery context
pnpm mem:recover --wu WU-XXX

# Or generate a full handoff prompt
pnpm wu:brief --id WU-XXX --client codex-cli
```

Recovery files contain your last checkpoint, acceptance criteria, code paths, and changed files.
Always save checkpoints before long operations: `pnpm mem:checkpoint "progress note" --wu WU-XXX`
