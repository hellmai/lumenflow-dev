# Rapid Prototyping with LumenFlow

**Last updated:** {{DATE}}

This guide explains how to move fast WITHIN the LumenFlow workflow, not by bypassing it.

---

## The Wrong Way: Skipping the Workflow

When asked to "prototype quickly" or "just get something working," agents often:

1. Skip WU creation ("let's just commit directly")
2. Work on main branch ("worktrees slow us down")
3. Skip tests ("we'll add them later")
4. Bypass gates ("pre-commit hooks are annoying")

**This creates technical debt, breaks workflow tracking, and causes merge conflicts.**

---

## The Right Way: Speed Through Parallelism

LumenFlow enables speed through **parallel WUs across lanes**, not by skipping steps.

### Speed Strategy 1: Multiple Small WUs

Instead of one large WU, create multiple focused WUs:

```bash
# SLOW: One massive WU
pnpm wu:create --lane "Framework: Core" --title "Build entire auth system"
# Takes 4 hours, blocks the lane

# FAST: Multiple parallel WUs
pnpm wu:create --lane "Framework: Core" --title "Add user model"
pnpm wu:create --lane "Framework: API" --title "Add auth endpoints"
pnpm wu:create --lane "Experience: UI" --title "Add login form"
# Each takes 1 hour, run in parallel across 3 lanes
```

### Speed Strategy 2: Spawn Sub-Agents

For complex work, spawn sub-agents to work in parallel:

```bash
# Generate handoff prompt for parallel agent
pnpm wu:brief --id WU-123 --client claude-code
```

Sub-agents work on different aspects simultaneously:

- Agent 1: Core business logic
- Agent 2: API endpoints
- Agent 3: UI components
- Agent 4: Tests

### Speed Strategy 3: Wave-Based Execution

Orchestrate initiatives in waves:

```bash
# View what can run in parallel
pnpm orchestrate:init-status --id INIT-001

# Spawn wave of WUs
pnpm orchestrate:initiative --id INIT-001 --wave 1
```

### Speed Strategy 4: Docs-Only Fast Path

For documentation changes, use the fast path:

```bash
# Skip lint/typecheck/tests for docs
pnpm gates --docs-only
```

---

## Time Comparison

| Approach        | Perceived Speed | Actual Time             | Technical Debt |
| --------------- | --------------- | ----------------------- | -------------- |
| Skip workflow   | "Instant"       | +2h later fixing issues | High           |
| Single large WU | Slow            | 4h blocked              | Low            |
| Parallel WUs    | Fast            | 1h each, parallel       | None           |

---

## Quick Reference: Fast But Safe

```bash
# Fast: Create focused WU
pnpm wu:create --lane "Framework: Core" --title "Specific task"

# Fast: Claim and work
pnpm wu:claim --id WU-XXX --lane "Framework: Core"
cd worktrees/framework-core-wu-xxx

# Fast: Minimal viable implementation
# Write ONE test, implement, pass

# Fast: Complete
pnpm wu:prep --id WU-XXX
cd /path/to/main && pnpm wu:done --id WU-XXX
```

---

## What to Say When Asked to "Skip the Workflow"

When a user says "just prototype this quickly":

1. **Acknowledge the urgency**: "I understand you want this fast."
2. **Explain the approach**: "I'll create focused WUs that can run in parallel."
3. **Deliver value quickly**: "Here's the first deliverable in 30 minutes."

**Never say**: "Let me skip the workflow to save time."

---

## Anti-Patterns to Avoid

| Anti-Pattern           | Why It's Slow                 | Better Alternative      |
| ---------------------- | ----------------------------- | ----------------------- |
| Direct commits to main | Merge conflicts, broken gates | Use worktrees           |
| One massive WU         | Blocks lane for hours         | Split into parallel WUs |
| Skip tests             | Bugs found late, rework       | TDD from start          |
| "We'll document later" | Context lost, debt            | Capture as you go       |

---

## Summary

**Speed in LumenFlow comes from parallelism, not shortcuts.**

- Multiple small WUs across lanes
- Sub-agents for complex work
- Wave-based orchestration
- Docs-only fast path when applicable

The workflow exists to prevent the slowdowns that come from technical debt, merge conflicts, and broken builds.
