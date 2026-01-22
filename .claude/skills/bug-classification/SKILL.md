---
name: bug-classification
description: Classify bugs (P0-P3) and determine fix-in-place vs separate Bug WU. Use when bug discovered mid-WU, deciding bug priority, or handling production issues.
version: 1.0.0
source: docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md
source_sections: §8 (Bug Handling Mid-WU)
last_updated: 2026-01-22
allowed-tools: Read, Grep
---

# Bug Classification Skill

## Purpose

Classify bugs (P0/P1/P2/P3) and determine whether to fix-in-place or create separate Bug WU.

## When to Use

- Bug discovered while working on a WU
- Need to determine bug priority
- Deciding fix-in-place vs separate WU
- Production issues requiring immediate attention

## Bug Classification (Priority Levels)

### P0 (CRITICAL - Emergency Response)

**Criteria:**

- Production outage (service unavailable)
- Data loss or corruption
- Auth/security breakage (users can't login, data exposed)
- Payment processing failure
- Critical safety issue

**Response:**

1. Classify as P0 per this guide
2. Create Bug WU with failing test
3. May preempt ANY lane: `pnpm wu:block --id WU-<current> --reason "Preempted by P0 WU-###"`
4. Immediately claim P0 WU: `pnpm wu:claim --id WU-### --lane <lane>`
5. Fix via TDD → gates → `pnpm wu:done`
6. Commit with `fix(EMERGENCY): <description>` convention
7. Restore preempted WU: `pnpm wu:unblock --id WU-<previous>`

**SLA**: Fix within 1-4 hours

### P1 (HIGH - Fix This Sprint)

**Criteria:**

- Major feature broken (but service still available)
- Significant user impact (affects >50% of workflows)
- Performance degradation (2x+ slower than baseline)
- Security vulnerability (non-critical)
- Data integrity issue (recoverable)

**Response:**

- Create Bug WU if not fixable in current WU
- Schedule for current sprint
- May preempt P2/P3 work

**SLA**: Fix within 1-3 days

### P2 (MEDIUM - Fix Next Sprint)

**Criteria:**

- Minor feature broken (workarounds exist)
- Moderate user impact (affects <50% of workflows)
- UI/UX issues (confusing but functional)
- Performance issue (noticeable but not blocking)

**Response:**

- Create Bug WU
- Schedule for next sprint
- Does not preempt P0/P1 work

**SLA**: Fix within 1-2 weeks

### P3 (LOW - Backlog)

**Criteria:**

- Cosmetic issues (typos, minor visual bugs)
- Edge case failures (rare scenarios)
- Nice-to-have improvements
- Tech debt

**Response:**

- Add to backlog
- Fix when capacity allows
- Does not preempt P0/P1/P2 work

**SLA**: No specific timeline

## Fix-in-Place vs Bug WU Decision Tree

### Fix-in-Place (Expand Current WU Scope)

Use when ALL of the following are true:

- Bug is in code touched by current WU
- Fix is small (< 50 lines of code)
- Fix doesn't require new tests beyond current WU acceptance
- Bug is related to current WU's feature/refactor
- Fix won't delay current WU by >1 hour

**Process:**

1. Update current WU acceptance criteria (add fix to checklist)
2. Update `code_paths` to include bug fix
3. Update `notes` to document bug discovery and fix
4. Implement fix + tests
5. Commit with WU convention: `wu(wu-xxx): fix <description> + original work`
6. Complete via `pnpm wu:done` (includes both original work and bug fix)

### Create Bug WU

Use when ANY of the following are true:

- Bug is in unrelated code (different feature/module)
- Fix is large (> 50 lines of code)
- Fix requires significant new tests
- Bug is unrelated to current WU's feature
- Fix will delay current WU by >1 hour
- Bug is P0/P1 and current WU is P2/P3

**Process:**

1. Create Bug WU with:
   - Type: `bug`
   - Priority: P0/P1/P2/P3 (use classification above)
   - Context: Bug description, steps to reproduce
   - Acceptance: Failing test + fix + regression prevention
2. If P0/P1: Block current WU and claim Bug WU immediately
3. If P2/P3: Add to backlog, finish current WU first
4. Implement fix via TDD (failing test first)
5. Complete via `pnpm wu:done`

## Bug WU Template

```yaml
id: WU-XXX
title: 'BUG: <concise description>'
type: bug
lane: <affected-lane>
status: ready
priority: <P0|P1|P2|P3>
created: YYYY-MM-DD

context: |
  Bug discovered: <when and where>

  Symptoms:
  - <what's broken>
  - <user impact>

  Root cause: <why it's broken>

  Reproduction:
  1. <step 1>
  2. <step 2>
  3. <observe failure>

acceptance:
  - '[ ] Failing test demonstrates bug'
  - '[ ] Fix implements correct behavior'
  - '[ ] Regression test prevents recurrence'
  - '[ ] Related edge cases tested'

code_paths:
  - <file with bug>
  - <test file>

tests:
  - <test file path>

notes: |
  Discovered during: WU-YYY
  Affects: <list of affected features/workflows>

blocked_by: []
blocking: []
```

## Reference

See [lumenflow-complete.md §8](../../../docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md) for complete bug handling guide.
