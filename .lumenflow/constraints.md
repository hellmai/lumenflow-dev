# LumenFlow Constraints Capsule

**Version:** 1.0
**Last updated:** 2026-01-19

This document contains the 6 non-negotiable constraints that every agent must keep "in working memory" from first plan through `wu:done`.

---

## The 6 Non-Negotiable Constraints

### 1. Worktree Discipline and Git Safety

**Rule:** Work only in worktrees, treat main as read-only, never run destructive git commands on main.

**Enforcement:**

- After `pnpm wu:claim`, immediately `cd worktrees/<lane>-wu-xxx`
- Hooks block WU commits from main checkout
- Forbidden commands on main: `git reset --hard`, `git stash`, `git clean -fd`, `git push --force`

**Why:** Worktree isolation prevents cross-contamination between parallel WUs and protects the main branch.

---

### 2. WUs Are Specs, Not Code

**Rule:** Respect code_paths boundaries, no feature creep, no code blocks in WU YAML files.

**Enforcement:**

- Only modify files listed in `code_paths`
- WU YAML contains acceptance criteria, not implementation code
- Scope discipline: implement only what the spec requires

**Why:** WUs define WHAT to build, not HOW. Implementation decisions belong in code, not specs.

---

### 3. Docs-Only vs Code WUs

**Rule:** Documentation WUs use `--docs-only` gates, code WUs run full gates.

**Enforcement:**

- `type: documentation` in WU YAML triggers docs-only mode
- `pnpm gates --docs-only` skips lint/typecheck/tests
- Path validation prevents code files in docs WUs

**Why:** Docs changes shouldn't require full test suite. Code changes must pass all gates.

---

### 4. LLM-First, Zero-Fallback Inference

**Rule:** Use LLMs for semantic tasks, fall back to safe defaults (never regex/keywords).

**Enforcement:**

- Prompt-based classification for ambiguous inputs
- Structured output parsing for LLM responses
- No brittle keyword matching for semantic decisions

**Why:** Regex and keyword matching are brittle. LLMs handle edge cases better.

---

### 5. Gates and Skip-Gates

**Rule:** Complete via `pnpm wu:done`; skip-gates only for pre-existing failures with `--reason` and `--fix-wu`.

**Enforcement:**

- `pnpm wu:done` runs gates before merge
- `--skip-gates` requires both `--reason` and `--fix-wu`
- Skip events logged to `.lumenflow/skip-gates-audit.log`

**Why:** Gates ensure quality. Skipping requires accountability and a fix plan.

---

### 6. Safety and Governance

**Rule:** Respect privacy rules, approved sources, security policies; when uncertain, choose safer path.

**Enforcement:**

- No hardcoded secrets (gitleaks scanning)
- RLS policies on sensitive data
- Redaction before sending to LLMs
- Stop-and-ask for auth/PII/spend changes

**Why:** Safety first. Some mistakes are irreversible.

---

## Mini Audit Checklist

Before running `wu:done`, verify:

- [ ] Working in worktree (not main)
- [ ] Only modified files in `code_paths`
- [ ] Gates pass (`pnpm gates` or `pnpm gates --docs-only`)
- [ ] No forbidden git commands used
- [ ] No secrets committed
- [ ] Acceptance criteria satisfied

---

## Quick Reference: Forbidden Commands

These commands are blocked on main checkout:

```bash
# Data destruction
git reset --hard
git clean -fd

# Hidden work
git stash

# History rewrite
git push --force
git push -f
git rebase -i main

# Bypass safety
--no-verify
HUSKY=0

# Worktree manipulation (agents must not delete worktrees)
git worktree remove
git worktree prune
```

**Allowed in worktrees:** Most commands are safe in isolated worktrees on lane branches.

---

## Agent LUMENFLOW_FORCE Usage Policy (WU-1070)

**Rule:** AI agents MUST NOT use LUMENFLOW_FORCE without explicit user approval.

**Rationale:** LUMENFLOW_FORCE bypasses all git hook protections (pre-commit, pre-push, commit-msg). While legitimate for emergency human interventions, agents using it autonomously undermines the entire workflow enforcement model.

**Enforcement:**

- All LUMENFLOW_FORCE usage is logged to `.beacon/force-bypasses.log` (git-tracked)
- Log format: `ISO_TIMESTAMP | HOOK_NAME | USER | BRANCH | REASON | CWD`
- Missing `LUMENFLOW_FORCE_REASON` triggers stderr warning

**Agent Escalation Path:**

1. **Detect need:** Agent encounters hook blocking operation
2. **Stop and ask:** Present situation to user with context
3. **Get approval:** User must explicitly approve bypass with reason
4. **Execute with audit:** Use `LUMENFLOW_FORCE_REASON="user-approved: <reason>" LUMENFLOW_FORCE=1`
5. **Document:** Note the bypass in commit message or WU notes

**Legitimate bypass scenarios:**

- Fixing YAML parsing bugs in WU specs (spec infrastructure issue)
- Emergency production hotfixes (with user present)
- Recovering from corrupted workflow state
- Bootstrap operations when CLI not yet built

**Never bypass for:**

- Skipping failing tests
- Avoiding code review
- Working around gate failures
- Convenience or speed

---

## Escalation Triggers

Stop and ask a human when:

- Same error repeats 3 times
- Auth or permissions changes required
- PII/PHI/safety issues discovered
- Cloud spend or secrets involved
- Policy changes needed
