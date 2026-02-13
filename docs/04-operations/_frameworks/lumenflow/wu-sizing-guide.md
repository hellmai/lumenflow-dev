# Work Unit Sizing & Strategy Guide

**Purpose:** Decision framework for agents to determine execution strategy based on task complexity.

**Effective Date:** 2025-11-24 (Post-WU-1215 Analysis)

**Status:** Active — Thresholds are **mandatory limits**, not guidelines.

---

## 1. Complexity Assessment Matrix

Before claiming a WU, estimate its "weight" using these heuristics.

| Complexity    | Files | Tool Calls | Context Budget | Strategy                                     |
| :------------ | :---- | :--------- | :------------- | :------------------------------------------- |
| **Simple**    | <20   | <50        | <30%           | **Single Session** (Tier 2 Context)          |
| **Medium**    | 20-50 | 50-100     | 30-50%         | **Checkpoint-Resume** (Standard Handoff)     |
| **Complex**   | 50+   | 100+       | >50%           | **Orchestrator-Worker** OR **Decomposition** |
| **Oversized** | 100+  | 200+       | —              | **MUST Split** (See Patterns below)          |

**These thresholds are mandatory.** Exceeding them leads to context exhaustion and rule loss (WU-1215 failure: 80k tokens consumed on analysis alone, zero implementation). Agents operate in context windows and tool calls, not clock time.

### 1.1 Documentation-Only Exception

Documentation WUs (`type: documentation`) have relaxed file count thresholds because:

- Doc files have lower cognitive complexity than code
- No test/type/lint dependencies to track
- Changes are typically additive, not structural

| Complexity  | Files (docs) | Tool Calls | Context Budget | Strategy          |
| :---------- | :----------- | :--------- | :------------- | :---------------- |
| **Simple**  | <40          | <50        | <30%           | Single Session    |
| **Medium**  | 40-80        | 50-100     | 30-50%         | Checkpoint-Resume |
| **Complex** | 80+          | 100+       | >50%           | Decomposition     |

**Applies when ALL true:**

- WU `type: documentation`
- Only modifies: `docs/**`, `*.md`, `.lumenflow/stamps/**`
- Does NOT touch: `apps/**`, `packages/**`, `tools/**` (code paths)

**Example: Docs-only WU touching 35 markdown files**

```yaml
# WU-XXX.yaml
id: WU-XXX
type: documentation
code_paths:
  - docs/04-operations/_frameworks/lumenflow/*.md
  - docs/01-product/*.md
```

This is allowed under docs exception: 35 files < 40 threshold for Simple.

---

### 1.2 Shallow Multi-File Exception

Some WUs touch many files but make shallow, uniform changes (e.g., renaming, search-replace, config updates). These may exceed file count thresholds while remaining low-complexity.

**Single-session override allowed when ALL true:**

1. **Uniform change pattern**: Same edit repeated across files (e.g., rename, import path update, config value change)
2. **No structural changes**: No new functions, classes, or control flow
3. **Low cognitive load**: Each file change is <=5 lines and mechanically identical
4. **Justification documented**: WU notes explain why thresholds are exceeded

**Example: Renaming a module across 45 files**

```yaml
# WU YAML notes field
notes: |
  Single-session override: 45 files modified but all are mechanical
  import path updates from '@old/path' to '@new/path'. Each change is
  1 line, pattern is identical across all files. No structural changes.
  Complexity: Low (uniform search-replace).
```

**Counter-example (NOT eligible for override):**

A WU touching 30 files where each requires unique logic changes, test updates, or structural modifications. This is Complex, not shallow multi-file - standard thresholds apply.

---

### 1.3 Examples Summary

| WU Type                     | Files | Eligible for Override? | Reasoning                                      |
| :-------------------------- | :---- | :--------------------- | :--------------------------------------------- |
| Docs: update 25 markdown    | 25    | Yes (docs exception)   | <40 files, docs-only, low complexity           |
| Docs: reorg 60 doc files    | 60    | Yes (docs exception)   | <80 files = Medium, checkpoint-resume strategy |
| Code: rename import in 45   | 45    | Yes (shallow override) | Uniform 1-line changes, no structural edits    |
| Code: refactor 30 files     | 30    | No                     | Each file has unique logic changes             |
| Code: add feature across 25 | 25    | No                     | Exceeds 20-file threshold, structural changes  |
| Docs + Code: mixed 15 files | 15    | No                     | Not docs-only, standard code thresholds apply  |

---

## 2. Strategy Decision Tree

Use this logic to select your approach. If `git status` ever shows >20 modified files, STOP and re-evaluate.

```
┌─────────────────────────┐
│   Start WU Analysis     │
└────────────┬────────────┘
             │
             ▼
      ┌──────────────┐
      │ Est. Tool    │
      │ Calls > 50?  │
      └──┬────────┬──┘
         │        │
        No       Yes
         │        │
         ▼        ▼
   ┌─────────┐  ┌────────────────┐
   │Standard │  │ Complexity     │
   │Strategy │  │ Type?          │
   │(Tier 2) │  └──┬──────────┬──┘
   └─────────┘     │          │
                   │          │
           Single Domain   Multi-Domain
           Clear Phases    High Coordination
                   │          │
                   ▼          ▼
         ┌──────────────┐  ┌────────────────┐
         │Checkpoint-   │  │ Must Land      │
         │Resume        │  │ Atomically?    │
         │• Investigate │  └──┬──────────┬──┘
         │• Implement   │     │          │
         │• Mid-WU      │    Yes        No
         │  Handoff     │     │          │
         └──────────────┘     ▼          ▼
                    ┌──────────────┐ ┌──────────────┐
                    │Orchestrator- │ │Decomposition │
                    │Worker        │ │• Split WUs   │
                    │• Main Agent  │ │• Feature     │
                    │  = Coord.    │ │  Flags       │
                    │• Spawns:     │ │• Dependencies│
                    │  Tester,     │ └──────────────┘
                    │  Guardian,   │
                    │  Coder       │
                    └──────────────┘
```

---

## 3. Splitting Patterns (Decomposition)

When a WU is Oversized or Complex (Non-Atomic), split it using one of these approved patterns.

### Pattern A: The Tracer Bullet (Risk Reduction)

**Best for:** New integrations, unproven libraries.

**Strategy:**

- **WU-1:** Define Ports, implement a hardcoded/mock Adapter, write the E2E test. Prove the "walking skeleton" works.
- **WU-2:** Implement the real infrastructure Adapter and logic.

**Example:** Integrating a new LLM provider

- WU-A: Create port interface + mock adapter returning fixed responses + E2E test proving UI can display results
- WU-B: Implement real API adapter with error handling, rate limiting, etc.

**Why:** De-risks unknowns early; proves integration works before investing in full implementation.

---

### Pattern B: The Layer Split (Architectural)

**Best for:** Large backend features following hexagonal architecture.

**Strategy:**

- **WU-1:** Core Domain (Ports + Application). Pure logic, fast unit tests.
- **WU-2:** Infrastructure Adapters + Integration Tests.

**Example:** New data export feature

- WU-A: Port definitions + application use case + unit tests (no external dependencies)
- WU-B: File system adapter + S3 adapter + integration tests

**Why:** Application logic can be reviewed/tested independently; adapters can be implemented in parallel lanes.

---

### Pattern C: The UI/Logic Split (Lane Separation)

**Best for:** Full-stack features requiring heavy frontend work.

**Strategy:**

- **WU-1 (Core Systems):** API endpoints, database schema, backend logic.
- **WU-2 (Experience):** Frontend components, UI state, integration with API.

**Example:** New patient dashboard widget

- WU-A (Core Systems lane): `/api/dashboard/summary` endpoint + DB queries + API tests
- WU-B (Experience lane): `DashboardSummaryCard` component + state management + E2E tests

**Why:** Enables parallel work across lanes; backend can be tested independently of UI.

---

### Pattern D: The Feature Flag (Phased Rollout)

**Best for:** High-risk refactoring (like WU-1215), breaking changes, gradual migrations.

**Strategy:**

- **WU-1:** Implement new logic behind a `ENABLE_NEW_FLOW=true` flag. Tests run against the flag.
- **WU-2:** Remove the flag and delete old code path.

**Example:** Refactoring a large function (WU-1215 case)

- WU-A: Extract new modular functions, call them behind `USE_NEW_WU_DONE=true`, preserve old `main()` as default
- WU-B: After validation, remove flag and old `main()` implementation

**Why:** Allows incremental delivery with rollback safety; can test new code in production without risk.

---

## 4. Context Safety Triggers

**Heading:** Default Triggers (Deviations require written justification in WU notes)

If you hit ANY of these triggers during a session, you MUST perform a Standard Session Handoff (see [session-handoff.md](./agent/onboarding/session-handoff.md)):

- **Token Limit:** Context usage hits **50% (Warning)** or **80% (Critical)**.
- **Tool Volume:** **50+ tool calls** in current session.
- **File Volume:** **20+ files** modified in `git status`.
- **Session Staleness:** Repeated redundant queries or forgotten context (performance degradation).

**Why these triggers matter:** Ignoring them led to the WU-1215 failure. An agent consumed 40% of context (80k tokens) on analysis alone, violated worktree discipline using absolute paths, and failed to deliver implementation. Preserve your reasoning capability by clearing context before you crash.

**Performance degradation symptoms:**

- Redundant tool calls (re-fetching already retrieved information)
- Lost worktree discipline (edits landing in main instead of worktree)
- Forgotten decisions or contradicting earlier conclusions
- Increased latency on similar operations

**When triggers fire:**

1. Update WU YAML `notes` field with progress, decisions, next steps
2. Commit work to lane branch (in worktree)
3. Push lane branch to origin
4. Use `/clear` command
5. Load Tier-1 context only (~500 tokens)
6. Resume from documented checkpoint

**Deviation protocol:** If a trigger fires but you believe an exception applies, check section 1.1 (Documentation-Only Exception) or section 1.2 (Shallow Multi-File Exception). If your WU qualifies:

1. Document the justification in WU notes (required)
2. Specify which exception applies and why
3. Monitor for performance degradation symptoms listed above
4. If symptoms appear, checkpoint and spawn fresh regardless of file count

---

## 5. Spawn Fresh, Don't Continue (Mandatory Policy)

**When approaching context limits, spawn a fresh agent instead of continuing after compaction.**

Context compaction (summarization) causes agents to lose critical rules. The recommended approach from [Anthropic's engineering guidance](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) is:

> "An initializer agent that sets up the environment, and a coding agent tasked with **making incremental progress in every session**, while leaving clear artifacts for the next session."

### When to Spawn Fresh

Spawn a fresh agent when ANY of these apply:

- Context usage exceeds 80%
- Tool calls exceed 50 in current session
- You notice performance degradation (redundant queries, forgotten context)
- You're about to run `/compact` or `/clear`

### Spawn Fresh Protocol

```bash
# 1. Checkpoint your progress
pnpm mem:checkpoint "Progress: completed X, next: Y" --wu WU-XXX

# 2. Commit and push work
git add -A && git commit -m "checkpoint: progress on X"
git push origin lane/<lane>/wu-xxx

# 3. Generate fresh agent prompt
pnpm wu:brief --id WU-XXX --client claude-code

# 4. EXIT current session (do NOT continue after compaction)

# 5. Start fresh agent with the generated prompt
```

### Why Not Continue After Compaction?

- Compaction summarizes conversation → rules get lost in summary
- Agent forgets worktree discipline, WU context, constraints
- Recovery mechanisms are complex and vendor-specific
- Prevention (fresh agent) is simpler and more reliable than recovery

**This is not failure—it's disciplined execution.** Each agent session makes bounded progress and leaves clear artifacts for the next session.

---

## 6. Quick Reference

| Scenario                                         | Strategy            | Action                                                        |
| :----------------------------------------------- | :------------------ | :------------------------------------------------------------ |
| Bug fix, single file, <20 tool calls             | Simple              | Claim, fix, commit, `wu:done`                                 |
| Feature spanning 50-100 tool calls, clear phases | Checkpoint-Resume   | Phase 1 → checkpoint → Phase 2 → checkpoint → done            |
| Multi-domain feature, must land atomically       | Orchestrator-Worker | Main agent coordinates, spawns test-engineer, beacon-guardian |
| Large refactor 100+ tool calls                   | Feature Flag Split  | WU-A: New behind flag → WU-B: Remove flag + old code          |
| New integration, uncertain complexity            | Tracer Bullet       | WU-A: Prove skeleton works → WU-B: Real implementation        |
| Docs-only, 30 markdown files                     | Simple (exception)  | Single session, document in notes, monitor for degradation    |
| Rename import across 45 files (uniform)          | Simple (override)   | Document justification, proceed if all 4 criteria met         |

---

## 7. Case Study: WU-1215 (Learning from Failure)

**WU:** Refactor wu-done.mjs 768-line `main()` function

**What went wrong:**

1. **Token exhaustion:** 80k/200k tokens (40%) consumed on analysis alone, zero implementation
2. **Worktree discipline violation:** Absolute paths (`/home/...`) in tool calls bypassed isolation, edits landed in main checkout
3. **Scope underestimation:** Spec said 708 LOC, actual was 768 LOC + 100 control flow statements (8% larger, significantly more complex)
4. **Single-session attempt for multi-phase work:** Extract → test → integrate phases require separate sessions

**What the agent did right (healthy recovery):**

- Self-detected violation via `git status` in main
- Immediately blocked WU with clear reason
- Documented root cause and next steps for handover
- Did not attempt to "power through" context exhaustion

**Lesson:** When scope exceeds session capacity, STOP and checkpoint. Document progress, commit, `/clear`, resume fresh. This is not failure—it's disciplined execution.

**Recommended strategy for WU-1215:** Feature Flag Split (Pattern D) with 3 WUs:

- WU-1: Extract validation modules + tests (~40 tool calls)
- WU-2: Extract orchestration logic + tests (~40 tool calls)
- WU-3: Final integration + cleanup (~30 tool calls)

---

## 8. Related Documentation

- [session-handoff.md](./agent/onboarding/session-handoff.md) — Mid-WU checkpoint protocol
- [agent-safety-card.md](./agent/onboarding/agent-safety-card.md) — Quick reference safety thresholds
- [parallel-session-optimization.md](./agent/onboarding/parallel-session-optimization.md) — Running 4-6 WUs concurrently
- [agent-invocation-guide.md](./agent/onboarding/agent-invocation-guide.md) — Orchestrator-worker patterns
- [lumenflow-complete.md](./lumenflow-complete.md) — Full LumenFlow framework
- [Canonical Lifecycle Map](./lumenflow-complete.md#26-canonical-lifecycle-map-wu-1635) — Command-mode matrix and handoff points
- [Failure-Mode Runbook](./lumenflow-complete.md#appendix-a-failure-mode-runbook-wu-1635) — Remediation for common operational failures

---

**Version:** 1.2 (2026-02-01)
**Last Updated:** 2026-02-01
**Contributors:** Claude (research), Codex (pragmatic framing), Gemini (trigger enforcement)

**Changelog:**

- v1.2 (2026-02-01): Added documentation-only exception (section 1.1), shallow multi-file exception with single-session override criteria (section 1.2), and examples summary table (section 1.3). Updated deviation protocol to reference exceptions.
- v1.1 (2026-01-17): Removed time-based estimates (hours); replaced with tool-call and context-budget heuristics. Agents operate in context windows, not clock time.
- v1.0 (2025-11-24): Initial version based on WU-1215 post-mortem.
