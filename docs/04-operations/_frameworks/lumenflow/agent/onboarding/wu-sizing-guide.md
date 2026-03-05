# Work Unit Sizing Guide

**Last updated:** 2026-03-06

Use this summary when deciding whether a WU still fits in a single agent session.

---

## Baseline Heuristics

| Complexity | Files | Tool Calls | Suggested Strategy          |
| ---------- | ----- | ---------- | --------------------------- |
| Simple     | <20   | <50        | Single session              |
| Medium     | 20-50 | 50-100     | Checkpoint and resume       |
| Complex    | 50+   | 100+       | Decompose or orchestrate    |
| Oversized  | 100+  | 200+       | Split before implementation |

These are guardrails, not a license to keep pushing once context is clearly degrading.

---

## Context Safety Triggers

Checkpoint and hand off when any of these happen:

- Context usage approaches 50% and is still climbing
- Tool calls exceed roughly 50 in one session
- File churn keeps widening without clear closure
- You have to repeatedly rediscover the same repo rules

---

## Recovery Pattern

```bash
pnpm mem:checkpoint "state before handoff" --wu WU-XXX
pnpm wu:brief --id WU-XXX --client codex-cli
```

If the WU is clearly too large, split it instead of relying on a heroic handoff.

---

## Docs-Only Exception

Documentation WUs can tolerate broader file counts when the change pattern is shallow and mechanical, but they still need to stay understandable in one session.

If the docs work starts spilling into CLI, core, or packaging changes, treat it like a normal cross-code WU again.
