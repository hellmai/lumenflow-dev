# Work Unit Sizing & Strategy Guide

**Purpose:** Decision framework for agents to determine execution strategy based on task complexity.

**Effective Date:** 2025-11-24 (Post-WU-1215 Analysis)

**Status:** Active (thresholds are starting heuristics based on WU-1215; will be revised using data from future telemetry WUs)

---

## 1. Complexity Assessment Matrix

Before claiming a WU, estimate its "weight" using these heuristics.

| Complexity    | Files | Tool Calls | Context Budget | Strategy                                     |
| :------------ | :---- | :--------- | :------------- | :------------------------------------------- |
| **Simple**    | <20   | <50        | <30%           | **Single Session** (Tier 2 Context)          |
| **Medium**    | 20-50 | 50-100     | 30-50%         | **Checkpoint-Resume** (Standard Handoff)     |
| **Complex**   | 50+   | 100+       | >50%           | **Orchestrator-Worker** OR **Decomposition** |
| **Oversized** | 100+  | 200+       | —              | **MUST Split** (See Patterns below)          |

**Note:** These thresholds are starting heuristics based on WU-1215 failure analysis (80k tokens consumed on analysis alone, zero implementation). We will revise them using data from future telemetry WUs. Agents operate in context windows and tool calls, not clock time.

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

**Deviation protocol:** If you believe a trigger is not applicable to your specific WU (e.g., docs-only WU touching 25 small files), document the justification in WU notes and proceed with caution. Monitor for performance degradation symptoms listed above.

---

## 5. Quick Reference

| Scenario                                         | Strategy            | Action                                                        |
| :----------------------------------------------- | :------------------ | :------------------------------------------------------------ |
| Bug fix, single file, <20 tool calls             | Simple              | Claim, fix, commit, `wu:done`                                 |
| Feature spanning 50-100 tool calls, clear phases | Checkpoint-Resume   | Phase 1 → checkpoint → Phase 2 → checkpoint → done            |
| Multi-domain feature, must land atomically       | Orchestrator-Worker | Main agent coordinates, spawns test-engineer, beacon-guardian |
| Large refactor 100+ tool calls                   | Feature Flag Split  | WU-A: New behind flag → WU-B: Remove flag + old code          |
| New integration, uncertain complexity            | Tracer Bullet       | WU-A: Prove skeleton works → WU-B: Real implementation        |

---

## 6. Case Study: WU-1215 (Learning from Failure)

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

## 7. Related Documentation

- [session-handoff.md](./agent/onboarding/session-handoff.md) — Mid-WU checkpoint protocol
- [agent-safety-card.md](./agent/onboarding/agent-safety-card.md) — Quick reference safety thresholds
- [parallel-session-optimization.md](./agent/onboarding/parallel-session-optimization.md) — Running 4-6 WUs concurrently
- [agent-invocation-guide.md](./agent/onboarding/agent-invocation-guide.md) — Orchestrator-worker patterns
- [lumenflow-complete.md](./lumenflow-complete.md) — Full LumenFlow framework

---

**Version:** 1.1 (2026-01-17)
**Last Updated:** 2026-01-19
**Contributors:** Claude (research), Codex (pragmatic framing), Gemini (trigger enforcement)

**Changelog:**

- v1.1 (2026-01-17): Removed time-based estimates (hours); replaced with tool-call and context-budget heuristics. Agents operate in context windows, not clock time.
- v1.0 (2025-11-24): Initial version based on WU-1215 post-mortem.
