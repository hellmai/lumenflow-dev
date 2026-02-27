# LumenFlow OS Development Guide

**Last updated:** 2026-02-25

This repo contains LumenFlow source code. We dogfood LumenFlow to build LumenFlow.

For complete workflow documentation, see [LUMENFLOW.md](LUMENFLOW.md).

---

## Critical Rule: Use wu:prep Then wu:done (WU-1223)

**NEW WORKFLOW - Two-step completion:**

1. From worktree: `pnpm wu:prep --id WU-XXXX` (runs gates, prints copy-paste instruction)
2. From main: `pnpm wu:done --id WU-XXXX` (merge + cleanup only)

See [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/troubleshooting-wu-done.md).

---

## Quick Start

```bash
# 1. Setup (first time only)
pnpm setup

# 2. Create a WU (ID auto-generated)
pnpm wu:create --lane <Lane> --title "Title"
# Output: Created WU-XXXX at docs/.../wu/WU-XXXX.yaml
# Note: --id is for explicit re-creation only. Omit it for normal use.

# 3. Edit WU spec with acceptance criteria
# Then claim:
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 3b. Bootstrap CLI for dist-backed commands (WU-1480)
pnpm bootstrap

# 4. Implement in worktree

# 5. Run wu:prep (gates + docs in worktree) - WU-1223 NEW
pnpm wu:prep --id WU-XXXX
# This prints a copy-paste instruction for step 6

# 6. Complete (from main) - copy-paste from wu:prep output
cd /home/USER/source/hellmai/os && pnpm wu:done --id WU-XXXX
```

---

## Core Principles

1. **Always `--help` First**: Run `<command> --help` before first use of any unfamiliar CLI command
2. **Dogfood LumenFlow**: Use LumenFlow workflow for all changes
3. **Design-First** (feature/refactor WUs): Load `/skill design-first` before implementation. Question requirements, delete unnecessary, simplify before optimizing
4. **TDD**: Failing test -> implementation -> passing test (>=90% coverage on new code)
5. **Library-First**: Search context7 before custom code
6. **DRY/SOLID/KISS/YAGNI**: No magic numbers, no hardcoded strings
7. **Worktree Discipline**: After `wu:claim`, work ONLY in the worktree
8. **Gates Before Done**: All gates must pass before `wu:done`
9. **Do Not Bypass Hooks**: No `--no-verify`, fix issues properly
10. **ALWAYS wu:done**: Complete every WU by running `pnpm wu:done`

## Lanes

Use "Parent: Sublane" format (e.g., `Framework: CLI WU Commands`). Lanes are defined in `workspace.yaml` under `software_delivery.lanes` — that file is the canonical source. Add new lanes as needed via `pnpm lane:edit` or `pnpm config:set`.

To find the right lane for your work:

```bash
pnpm wu:infer-lane --paths "packages/@lumenflow/cli/src/init.ts" --desc "Fix init scaffolding"
```

---

## Commands Reference

| Command                   | Description                                         |
| ------------------------- | --------------------------------------------------- |
| `pnpm setup`              | Install deps and build CLI                          |
| `pnpm bootstrap`          | Build CLI with dependency closure (worktree-safe)   |
| `pnpm wu:create`          | Create new WU spec                                  |
| `pnpm wu:claim`           | Claim WU and create worktree                        |
| `pnpm wu:prep`            | Run gates in worktree, prep for wu:done             |
| `pnpm wu:done`            | Complete WU (merge, stamp, cleanup)                 |
| `pnpm wu:status`          | Show WU status, location, valid commands            |
| `pnpm wu:recover`         | Analyze and fix WU state inconsistencies            |
| `pnpm wu:escalate`        | Show or resolve WU escalation status                |
| `pnpm gates`              | Run quality gates                                   |
| `pnpm lumenflow:commands` | List all public commands (primary + alias + legacy) |
| `pnpm docs:generate`      | Regenerate CLI/config reference docs from source    |
| `pnpm docs:validate`      | Verify generated docs are up-to-date                |
| `pnpm mem:init`           | Initialize memory layer                             |
| `pnpm mem:checkpoint`     | Save memory checkpoint                              |

### Tooling Operations (No WU Required)

These commands use micro-worktree isolation — they commit and push atomically.
Do NOT wrap them in a WU or use raw `pnpm update`.

| Command                                  | Description                          |
| ---------------------------------------- | ------------------------------------ |
| `pnpm lumenflow:upgrade --version X.Y.Z` | Upgrade all @lumenflow/\* packages   |
| `pnpm lumenflow:upgrade --latest`        | Upgrade to latest version            |
| `pnpm config:set --key <k> --value <v>`  | Set workspace.yaml config            |
| `pnpm cloud:connect`                     | Configure cloud control-plane access |
| `pnpm docs:sync`                         | Sync agent docs after upgrade        |

> **CLI reference (100+ commands):** See [quick-ref-commands.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md). Always run `<command> --help` for the authoritative option list.

### Context-Aware Validation (WU-1090)

Commands now include context-aware validation that checks:

- **Location**: Detects main checkout vs worktree
- **WU Status**: Validates required status for each command
- **Git State**: Checks for dirty files, commits ahead/behind

When validation fails, commands provide copy-paste fix commands:

```bash
# Example: Running wu:done from worktree shows fix command
ERROR: WRONG_LOCATION - wu:done must be run from main checkout
FIX: cd /home/user/repo && pnpm wu:done --id WU-1090
```

Configure validation in `workspace.yaml`:

```yaml
software_delivery:
  experimental:
    context_validation: true # Enable validation (default: true)
    validation_mode: 'warn' # 'off' | 'warn' | 'error'
    show_next_steps: true # Show guidance after success
```

### Enforcement Hooks (WU-1367)

Claude Code hooks can enforce LumenFlow workflow compliance at the tool level.
When enabled, hooks block non-compliant operations instead of relying on agents
to remember workflow rules.

Configure in `workspace.yaml`:

```yaml
software_delivery:
  agents:
    clients:
      claude-code:
        enforcement:
          hooks: true # Enable enforcement hooks
          block_outside_worktree: true # Block Write/Edit outside worktree
          require_wu_for_edits: true # Require claimed WU for edits
          warn_on_stop_without_wu_done: true # Warn on session end without wu:done
```

Generate hooks after configuration:

```bash
pnpm lumenflow:integrate --client claude-code
```

Hooks implement graceful degradation: if LumenFlow state cannot be determined,
operations are allowed to prevent blocking legitimate work.

---

## Known Bootstrap Issues

1. **Worktree CLI**: Fresh worktrees don't have CLI built. Run `pnpm bootstrap` after `wu:claim` to build `@lumenflow/cli` with its full dependency closure (core, memory, metrics, initiatives, agent). This enables dist-backed commands like `lane:health` and `gates`. For bootstrap WUs where even `pnpm bootstrap` cannot run, use `--skip-gates` with `--reason`.

2. **Missing tool scripts**: Some gates expect ExampleApp-specific tools. Stubs exist in `tools/` and `packages/linters/`.

---

## Definition of Done

- Acceptance criteria satisfied
- Gates green (`pnpm gates` or `pnpm gates --docs-only`)
- WU YAML status = `done`
- `.lumenflow/stamps/WU-<id>.done` exists
- **wu:done has been run** (not just documented)

---

## Documentation Structure

This repo follows the vendor-agnostic LumenFlow documentation structure:

- **LUMENFLOW.md** - Main workflow entry point
- **.lumenflow/constraints.md** - Non-negotiable rules
- **.lumenflow/rules/** - Workflow rules
- **docs/04-operations/\_frameworks/lumenflow/agent/onboarding/** - Agent onboarding docs
- **apps/docs/src/content/docs/kernel/** - Kernel docs source
- **apps/docs/src/content/docs/packs/software-delivery/** - Software Delivery Pack docs source
- **apps/docs/src/content/docs/packs/software-delivery/languages/** - Pack-scoped language guides
- **apps/docs/src/data/version-policy.yaml** - Stable version truth file
- **apps/docs/src/data/language-support.yaml** - Language support truth file
- **apps/docs/src/data/example-repos.yaml** - Example repo truth file
- **.claude/** - Claude Code-specific configuration

---

## References

- [LUMENFLOW.md](LUMENFLOW.md) - Main workflow documentation
- [.lumenflow/constraints.md](.lumenflow/constraints.md) - Constraints capsule
- [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/](docs/04-operations/_frameworks/lumenflow/agent/onboarding/) - Agent onboarding
- [LumenFlow Complete Guide](docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md)
- [Release Process](docs/04-operations/_frameworks/lumenflow/agent/onboarding/release-process.md) - Versioning, npm publish, Starlight docs
