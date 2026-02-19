# Agent Safety Architecture

**Last updated:** 2026-02-19

This document describes the full protection landscape for AI agents working in LumenFlow projects. It covers all enforcement layers, their coverage per client, known gaps, and mitigation strategies.

---

## Overview

LumenFlow enforces agent safety through 8 layered protection mechanisms. No single layer provides complete coverage -- they work together in a defense-in-depth model. Understanding which layers apply to your agent client is essential for maintaining workflow integrity.

---

## The 8 Protection Layers

### Layer 1: Claude Code PreToolUse Hooks (Bash Command Blocking)

**File:** `.claude/hooks/block-bash-file-commands.sh`

**Scope:** Claude Code only

**What it does:** Intercepts Bash tool calls and blocks file-manipulation commands (`cat >`, `echo >`, `sed -i`, `tee`, etc.) that would bypass Write/Edit tool validation. Forces agents to use the proper Write/Edit tools where worktree path validation applies.

**Enforcement:** Yes (fail-closed). If the hook cannot determine whether a command is safe, it blocks the command.

**Limitation:** Only applies to Claude Code. Other clients (Cursor, Codex, Windsurf) do not have tool-level interception for Bash commands.

---

### Layer 2: Claude Code PreToolUse Hooks (Worktree Path Validation)

**File:** `.claude/hooks/validate-worktree-path.sh`

**Scope:** Claude Code only

**What it does:** Intercepts Write and Edit tool calls and validates that the target file path is either:

- Inside an active worktree (for WU implementation files), or
- In the allowlist (WU YAML specs, `.lumenflow/*` files, documentation paths)

**Enforcement:** Yes (fail-closed). If the hook cannot determine the worktree state, it blocks the operation.

**Allowlist:** The following paths are permitted even outside a worktree:

- `docs/04-operations/tasks/wu/*.yaml` (WU specifications)
- `.lumenflow/*` (workflow configuration and state)
- Files matching documentation patterns

**Known gap:** The allowlist means agents can raw-edit `.lumenflow.config.yaml` and WU YAML files without using `config:set` or `wu:edit`. See the [YAML Editing Policy](#yaml-editing-policy) section.

---

### Layer 3: Husky Pre-Commit Hook

**File:** `.husky/pre-commit.mjs`

**Scope:** All clients (git-level, universal)

**What it does:** Runs before every `git commit` and enforces:

- Format checking (Prettier)
- Blocks WU-scoped commits from the main checkout (must be in worktree)
- Validates commit message format

**Enforcement:** Yes. Applies to all clients that use `git commit` (Claude Code, Cursor, Codex, Windsurf, manual).

**Bypass vector:** `--no-verify` flag or `HUSKY=0` environment variable disables all Husky hooks. LumenFlow policy forbids these bypasses. `LUMENFLOW_FORCE=1` is the only sanctioned override and is audit-logged.

---

### Layer 4: Husky Pre-Push Hook

**File:** `.husky/pre-push.mjs`

**Scope:** All clients (git-level, universal)

**What it does:** Runs before every `git push` and enforces:

- Branch naming conventions
- Blocks force push to main
- Validates that `wu:done` workflow is being followed

**Enforcement:** Yes. Same universal coverage as pre-commit.

**Bypass vector:** Same as Layer 3 -- `--no-verify` or `HUSKY=0`.

---

### Layer 5: Safe-Git Wrapper Script

**File:** `scripts/safe-git`

**Scope:** Opt-in (recommended for Cursor, available for all clients)

**What it does:** Wraps `git` and blocks destructive commands:

- `git reset --hard`
- `git clean -fd`
- `git push --force`
- `git worktree remove`
- `git worktree prune`

Blocked actions are logged to `.lumenflow/safety-blocks.log`.

**Enforcement:** Optional. Must be explicitly configured by the user or agent client. Cursor's `.cursorrules` recommends using it.

---

### Layer 6: Policy Documents (.lumenflow/rules/)

**Path:** `.lumenflow/rules/*.md`

**Scope:** Advisory (all clients)

**What it does:** Defines workflow rules as human- and agent-readable markdown documents:

- `git-safety.md` -- Forbidden commands, merge strategy, hook enforcement
- `wu-workflow.md` -- WU lifecycle, claiming, completing, blocking
- `tdd-workflow.md` -- Test-driven development patterns
- `tool-usage.md` -- Tool usage guidelines
- `yaml-editing-policy.md` -- YAML file modification policy

**Enforcement:** No runtime enforcement. Agents are expected to read and follow these rules. Compliance depends on the agent's training and prompt context.

---

### Layer 7: Constraints Capsule (.lumenflow/constraints.md)

**File:** `.lumenflow/constraints.md`

**Scope:** Advisory + spawn prompt injection (all clients)

**What it does:** Defines the non-negotiable constraints that every agent must keep in working memory. These are injected into spawn prompts via `wu:brief` and `wu:delegate`, ensuring sub-agents receive them.

**Enforcement:** Soft. Agents are expected to audit against constraints before every action. Spawn prompt injection provides stronger coverage than standalone policy docs, but agents can still ignore constraints after context compaction.

---

### Layer 8: Configuration-Driven Enforcement (.lumenflow.config.yaml)

**File:** `.lumenflow.config.yaml`

**Scope:** Varies by setting and client

**What it does:** Provides configuration toggles for enforcement features:

```yaml
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
        require_wu_for_edits: true
        warn_on_stop_without_wu_done: true
experimental:
  context_validation: true
  validation_mode: 'warn' # 'off' | 'warn' | 'error'
```

**Enforcement:** Varies. Claude Code enforcement hooks are generated by `pnpm lumenflow:integrate --client claude-code` and are actively enforced. Context validation provides runtime warnings or errors. Settings for other clients are advisory.

---

## Coverage Matrix

| Layer | Mechanism                | Claude Code | Cursor      | Codex     | Windsurf  | Manual    |
| ----- | ------------------------ | ----------- | ----------- | --------- | --------- | --------- |
| 1     | Bash command blocking    | Enforced    | --          | --        | --        | --        |
| 2     | Worktree path validation | Enforced    | --          | --        | --        | --        |
| 3     | Pre-commit hook          | Enforced    | Enforced    | Enforced  | Enforced  | Enforced  |
| 4     | Pre-push hook            | Enforced    | Enforced    | Enforced  | Enforced  | Enforced  |
| 5     | Safe-git wrapper         | Available   | Recommended | Available | Available | Available |
| 6     | Policy documents         | Advisory    | Advisory    | Advisory  | Advisory  | Advisory  |
| 7     | Constraints capsule      | Injected    | Advisory    | Advisory  | Advisory  | Advisory  |
| 8     | Config enforcement       | Enforced    | Advisory    | Advisory  | Advisory  | N/A       |

**Legend:**

- **Enforced** -- Actively blocks non-compliant operations
- **Recommended** -- Configured but requires opt-in
- **Available** -- Can be used but not configured by default
- **Advisory** -- Documented policy, no runtime enforcement
- **Injected** -- Automatically included in spawn/delegation prompts
- **--** -- Not applicable to this client

---

## YAML Editing Policy

YAML configuration files (`.lumenflow.config.yaml`, WU specification files) are in the allowlist for worktree path validation (Layer 2). This means any agent -- including those with tool-level hooks -- can raw-edit these files using Write or Edit tools.

**Policy: Always use CLI tooling to modify YAML files. Never use raw Write/Edit.**

| File                     | Safe Command                                 | Unsafe Alternative                                      |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------- |
| `.lumenflow.config.yaml` | `pnpm config:set --key <path> --value <val>` | Write/Edit to `.lumenflow.config.yaml`                  |
| `.lumenflow.config.yaml` | `pnpm config:get --key <path>` (read)        | Read `.lumenflow.config.yaml` (acceptable for reading)  |
| WU YAML specs            | `pnpm wu:edit --id WU-XXX --field value`     | Write/Edit to `docs/04-operations/tasks/wu/WU-XXX.yaml` |
| WU YAML specs            | `pnpm wu:create ...` (creation)              | Write to create new YAML files                          |

**Why CLI tooling is required:**

1. **Schema validation** -- `config:set` validates against the Zod schema before writing. Raw edits can produce invalid configurations that break downstream commands.
2. **Atomic commits** -- `config:set` uses the micro-worktree pattern for atomic commits to `origin/main`. Raw edits may leave uncommitted changes or create conflicts.
3. **Audit trail** -- CLI commands produce structured log entries. Raw edits are invisible to the audit system.
4. **Type coercion** -- `config:set` handles boolean/number/array coercion automatically. Raw edits may introduce type mismatches (e.g., string `"true"` instead of boolean `true`).

For the full YAML editing policy, see [.lumenflow/rules/yaml-editing-policy.md](../../../../.lumenflow/rules/yaml-editing-policy.md).

---

## Known Protection Gaps

### Gap 1: YAML Files in Allowlist

**Risk:** Medium

The worktree path validation hook (Layer 2) explicitly allows writes to WU YAML files and `.lumenflow/*` paths. This means agents can bypass `config:set` and `wu:edit` by raw-editing these files.

**Mitigation:** Constraint 9 in `.lumenflow/constraints.md` establishes the policy. Future enforcement WU will add hook-level blocking for raw YAML edits with a redirect to CLI commands.

### Gap 2: Non-Claude-Code Agents Lack Tool-Level Enforcement

**Risk:** High

Cursor, Codex, and Windsurf have no equivalent to Claude Code's PreToolUse hooks. Their only enforcement comes from git hooks (Layers 3-4), which trigger at commit time -- not at write time. An agent can write files anywhere and only discover the violation when attempting to commit.

**Mitigation:**

- Cursor: `.cursorrules` recommends the safe-git wrapper and documents worktree discipline
- Codex: Uses `agent/*` branch patterns that bypass worktree requirements; git hooks still apply
- Windsurf: `.windsurf/rules/lumenflow.md` provides advisory guidance

### Gap 3: LUMENFLOW_FORCE Bypasses All Hooks

**Risk:** Medium

Setting `LUMENFLOW_FORCE=1` disables all git hook enforcement (Layers 3-4). While this is logged to `.lumenflow/force-bypasses.log`, the log is passive -- no alerting or escalation occurs.

**Mitigation:** Agent policy in `.lumenflow/constraints.md` requires explicit user approval before using `LUMENFLOW_FORCE`. See the LUMENFLOW_FORCE Usage Policy section.

### Gap 4: No GitHub Branch Protection

**Risk:** Medium

All enforcement is via local hooks. There is no server-side branch protection on GitHub. An agent that uses `--no-verify` or `HUSKY=0` can push directly to main.

**Mitigation:** Future enforcement WU will add GitHub branch protection rules requiring PR reviews and status checks.

### Gap 5: Audit Logging Is Passive

**Risk:** Low

Safety blocks, force bypasses, and hook violations are logged to `.lumenflow/audit/` and `.lumenflow/force-bypasses.log`, but these logs are not monitored in real-time. No alerting, no escalation.

**Mitigation:** Logs are git-tracked, so violations are visible in commit history. Future monitoring WU will add active alerting.

---

## Per-Client Safety Guidance

### Claude Code

Claude Code has the strongest protection of any client:

- **Layers 1-2**: Tool-level hooks block unsafe Bash commands and validate worktree paths
- **Layers 3-4**: Git hooks enforce at commit and push time
- **Layer 7**: Constraints are injected into spawn prompts via `wu:brief`
- **Layer 8**: Enforcement hooks are generated by `pnpm lumenflow:integrate --client claude-code`

**Setup:**

```bash
pnpm lumenflow:integrate --client claude-code
```

**YAML editing:** Use `pnpm config:set` and `pnpm wu:edit`. Do not use Write/Edit tools on YAML configuration files.

### Cursor

Cursor relies on advisory rules and git hooks:

- **Layers 3-4**: Git hooks enforce at commit and push time
- **Layer 5**: Safe-git wrapper is recommended in `.cursorrules`
- **Layer 6**: `.cursorrules` points to policy documents

**Setup:**

```bash
pnpm lumenflow:init --client cursor
```

**YAML editing:** Use `pnpm config:set` and `pnpm wu:edit`. The safe-git wrapper does not cover YAML edits -- discipline depends on the agent following `.cursorrules` guidance.

### Codex

Codex operates in cloud/branch-PR mode:

- **Layers 3-4**: Git hooks enforce at commit and push time
- Codex uses `agent/*` branch patterns and does not create local worktrees
- `wu:claim --cloud` sets `claimed_mode: branch-pr`

**Setup:**

```bash
pnpm wu:claim --id WU-XXX --lane "Lane" --cloud
```

**YAML editing:** Use `pnpm config:set` and `pnpm wu:edit`. Cloud mode does not change the YAML editing policy.

### Windsurf

Windsurf has minimal enforcement:

- **Layers 3-4**: Git hooks enforce at commit and push time
- **Layer 6**: `.windsurf/rules/lumenflow.md` provides advisory guidance

**Setup:**

```bash
pnpm lumenflow:init --client windsurf
```

**YAML editing:** Use `pnpm config:set` and `pnpm wu:edit`. No tool-level enforcement exists -- compliance depends entirely on the agent following advisory rules.

---

## Enforcement Roadmap

The following enforcement improvements are planned (documentation-first, then tooling):

1. **Hook-level YAML edit blocking** -- Extend Layer 2 to block raw Write/Edit to `.lumenflow.config.yaml` and redirect to `config:set`
2. **GitHub branch protection** -- Add server-side rules requiring PR reviews and status checks for main
3. **Active audit alerting** -- Monitor `.lumenflow/audit/` for violations and send alerts
4. **Cross-client enforcement hooks** -- Extend tool-level hooks to Cursor (via MCP) and other clients
5. **Permission-gated LUMENFLOW_FORCE** -- Require cryptographic approval for force bypasses

---

## References

- [.lumenflow/constraints.md](../../../../.lumenflow/constraints.md) -- Non-negotiable constraints (includes Constraint 9: YAML editing policy)
- [.lumenflow/rules/yaml-editing-policy.md](../../../../.lumenflow/rules/yaml-editing-policy.md) -- Full YAML editing policy
- [config:set and config:get](config-set-usage.md) -- CLI commands for safe config modification
- [LUMENFLOW.md](../../../../LUMENFLOW.md) -- Main workflow documentation
- [Agent onboarding](agent/onboarding/starting-prompt.md) -- Starting prompt for new agents
